import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  CopyDialogNodeDto,
  CreateDialogNodeDto,
  DesignValidationReport,
  DialogNode,
  DialogNodeCopyResponse,
  DialogNodeListItem,
  DialogNodeListQuery,
  DialogNodeType,
  DialogOutput,
  FlowTree,
  Paginated,
  UpdateDialogNodeDto,
  findLegacyApiOutputIndexes,
  findLegacySurveyOutputIndexes,
  isApiConditionV2,
  isSurveyV2,
  normalizeText,
} from '@chat-bot/shared-types';
import { buildFlowTree, computeIncomingCounts, validateDialogueDesign } from '@chat-bot/dialogue-engine';
import { PrismaService } from '../prisma/prisma.service';
import { ApiException, ApiExceptionDetail } from '../common/api.exception';
import { toPaginated } from '../common/pagination';
import { AuditLogService } from '../audit-logs/audit-log.service';
import { ChatbotScopeService } from '../chatbots/chatbot-scope.service';
import { ReferenceCheckService } from '../dialogue-common/reference-check.service';
import { DialogueBundleService } from '../dialogue-common/dialogue-bundle.service';
import { collectAssetRefs } from '../dialogue-common/lib/asset-ref-graph';
import { ApiConnectionCatalogService } from '../api-connections/catalog/api-connection-catalog.service';
import { WorkflowCatalogService } from '../workflow/catalog/workflow-catalog.service';
import { NodeRowWithLinks, parseOutputs, toDialogNodeEntity, toDialogNodeResponse } from './dialog-node.mapper';
import { dedupeIds } from './lib/node-links';
import { buildConditionSummary, extractOutputTypes } from './lib/node-condition-summary';
import { collectNodeTargetRefs } from './lib/node-target-refs';
import { TopicLookupService } from '../topics/topic-lookup.service';
import { validateTopicBoundaries } from '../topics/lib/topic-boundary';
import { buildTopicIdsWhere } from '../topics/lib/topic-query-filter';

const NOT_FOUND_MESSAGE = '요청하신 대화 노드를 찾을 수 없습니다.';

interface ReferenceValidationInput {
  intentIds: string[];
  keywordIds: string[];
  contextVariableId?: string;
  outputs: DialogOutput[];
}

@Injectable()
export class DialogNodesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ChatbotScopeService,
    private readonly referenceCheck: ReferenceCheckService,
    private readonly bundleService: DialogueBundleService,
    private readonly auditLogService: AuditLogService,
    private readonly apiConnectionCatalog: ApiConnectionCatalogService,
    private readonly topicLookup: TopicLookupService,
    private readonly workflowCatalog: WorkflowCatalogService,
  ) {}

  /** [신규 No.41] 노드당 `WORKFLOW` 아웃풋 ≤3(§4.1 · FR-WF2-8). */
  private assertWorkflowOutputLimit(outputs: DialogOutput[]): void {
    const count = outputs.filter((o) => o.type === 'WORKFLOW').length;
    if (count > 3) {
      throw new ApiException('OUTPUT_PAYLOAD_INVALID', 400, '노드 하나에 업무 요청 보내기 아웃풋은 최대 3개까지 등록할 수 있습니다.');
    }
  }

  /** [신규 No.22] START/FALLBACK 노드는 항상 공통이다 — 생성·수정·유형 변경 전부(§5.2). */
  private assertNotSystemNodeWithTopic(nodeType: DialogNodeType, topicId: string | null | undefined): void {
    if ((nodeType === 'START' || nodeType === 'FALLBACK') && topicId) {
      throw new ApiException('TOPIC_SYSTEM_NODE_LOCKED', 400, '시작·폴백 노드는 항상 공통입니다. 토픽을 지정할 수 없습니다.');
    }
  }

  /** [No.26] 쓰기 = v2만 — v1 `API_CONDITION`이 있으면 400으로 거부한다(FR-L1-4, §4.2). */
  private assertNoLegacyApiOutputs(outputs: DialogOutput[]): void {
    const indexes = findLegacyApiOutputIndexes(outputs);
    if (indexes.length > 0) {
      throw new ApiException(
        'API_OUTPUT_LEGACY_FORMAT',
        400,
        'API 조건을 연결 방식으로 전환해야 저장할 수 있습니다.',
        indexes.map((i) => ({ field: `outputs[${i}]`, message: '이전 형식 API 조건은 저장할 수 없습니다.' })),
      );
    }
  }

  /** [No.27] 쓰기 = v2만 — v1 `SURVEY`가 있으면 400으로 거부한다(§4.2, 기존 API 가드 뒤에 검사). */
  private assertNoLegacySurveyOutputs(outputs: DialogOutput[]): void {
    const indexes = findLegacySurveyOutputIndexes(outputs);
    if (indexes.length > 0) {
      throw new ApiException(
        'SURVEY_OUTPUT_LEGACY_FORMAT',
        400,
        '설문 연결을 새 방식으로 바꿔야 저장할 수 있습니다. 설문을 선택해 주세요.',
        indexes.map((i) => ({ field: `outputs[${i}]`, message: '이전 형식 설문 연결은 저장할 수 없습니다.' })),
      );
    }
  }

  private toAuditSnapshot(row: NodeRowWithLinks) {
    const entity = toDialogNodeEntity(row);
    return { ...entity, outputCount: entity.outputs.length };
  }

  private async assertNameFree(chatbotId: string, nameNormalized: string, excludeId?: string): Promise<void> {
    const existing = await this.prisma.dialogNode.findFirst({
      where: { chatbotId, nameNormalized, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { id: true },
    });
    if (existing) throw new ApiException('DUPLICATE_NAME', 409, '이미 같은 이름의 노드가 있습니다.');
  }

  private async assertNodeTypeSingleton(chatbotId: string, nodeType: DialogNodeType, excludeId?: string): Promise<void> {
    if (nodeType !== 'START' && nodeType !== 'FALLBACK') return;
    const existing = await this.prisma.dialogNode.findFirst({
      where: { chatbotId, nodeType, ...(excludeId ? { id: { not: excludeId } } : {}) },
    });
    if (existing) {
      const code = nodeType === 'START' ? 'START_NODE_EXISTS' : 'FALLBACK_NODE_EXISTS';
      const label = nodeType === 'START' ? '시작' : '폴백';
      throw new ApiException(code, 409, `${label} 노드는 챗봇당 1개만 지정할 수 있습니다(현재: ${existing.name}).`);
    }
  }

  /** FR-5-5, FR-5-20 — 조건/아웃풋이 가리키는 모든 참조 ID가 같은 챗봇에 실존하는지 검사한다. */
  private async validateReferences(chatbotId: string, input: ReferenceValidationInput): Promise<void> {
    const details: ApiExceptionDetail[] = [];

    if (input.intentIds.length > 0) {
      const found = await this.prisma.intent.findMany({ where: { chatbotId, id: { in: input.intentIds } }, select: { id: true } });
      const foundSet = new Set(found.map((f) => f.id));
      input.intentIds.filter((id) => !foundSet.has(id)).forEach((id) => details.push({ field: 'intentIds', message: id }));
    }
    if (input.keywordIds.length > 0) {
      const found = await this.prisma.keyword.findMany({ where: { chatbotId, id: { in: input.keywordIds } }, select: { id: true } });
      const foundSet = new Set(found.map((f) => f.id));
      input.keywordIds.filter((id) => !foundSet.has(id)).forEach((id) => details.push({ field: 'keywordIds', message: id }));
    }
    if (input.contextVariableId) {
      const found = await this.prisma.contextVariable.findFirst({ where: { chatbotId, id: input.contextVariableId }, select: { id: true } });
      if (!found) details.push({ field: 'contextVariableId', message: input.contextVariableId });
    }

    // [No.26 M2-2] 누락 참조를 "어느 아웃풋의 어느 필드"인지 알 수 있도록 위치(zod 경로)를 보존한다.
    // DB 조회는 여전히 id 집합으로 1회만 하되, 상세 보고는 위치별로 하나씩 만든다(같은 id가 여러
    // 위치에서 참조되면 위치 수만큼 detail이 생긴다).
    // [신규 No.22 — K-2] 노드→노드 참조 수집은 `node-target-refs.ts`로 추출했다(동작 불변).
    const nodeTargetRefs = collectNodeTargetRefs(input.outputs);
    const contextFormIds = new Set<string>();
    const surveyRefs: Array<{ id: string; field: string }> = [];
    input.outputs.forEach((o, i) => {
      if (o.type === 'CONTEXT_FORM') contextFormIds.add(o.payload.contextVariableId);
      // [No.27] v2 SURVEY의 surveyId(같은 챗봇 Survey 참조, J-20).
      if (o.type === 'SURVEY' && isSurveyV2(o.payload)) {
        surveyRefs.push({ id: o.payload.surveyId, field: `outputs.${i}.payload.surveyId` });
      }
    });
    const nodeTargetIds = new Set(nodeTargetRefs.map((r) => r.id));
    if (nodeTargetIds.size > 0) {
      const found = await this.prisma.dialogNode.findMany({ where: { chatbotId, id: { in: [...nodeTargetIds] } }, select: { id: true } });
      const foundSet = new Set(found.map((f) => f.id));
      nodeTargetRefs.filter((r) => !foundSet.has(r.id)).forEach((r) => details.push({ field: r.field, message: r.id }));
    }
    if (contextFormIds.size > 0) {
      const found = await this.prisma.contextVariable.findMany({ where: { chatbotId, id: { in: [...contextFormIds] } }, select: { id: true } });
      const foundSet = new Set(found.map((f) => f.id));
      [...contextFormIds].filter((id) => !foundSet.has(id)).forEach((id) => details.push({ field: 'outputs.contextVariableId', message: id }));
    }
    if (surveyRefs.length > 0) {
      const surveyIds = new Set(surveyRefs.map((r) => r.id));
      const found = await this.prisma.survey.findMany({ where: { chatbotId, id: { in: [...surveyIds] } }, select: { id: true } });
      const foundSet = new Set(found.map((f) => f.id));
      surveyRefs.filter((r) => !foundSet.has(r.id)).forEach((r) => details.push({ field: r.field, message: r.id }));
    }

    // [신규 No.41] `WORKFLOW`의 `targetId`(전역 자원 — 챗봇 스코프 아님, §12.5).
    const workflowRefs: Array<{ id: string; field: string }> = [];
    input.outputs.forEach((o, i) => {
      if (o.type === 'WORKFLOW') workflowRefs.push({ id: o.payload.targetId, field: `outputs.${i}.payload.targetId` });
    });
    if (workflowRefs.length > 0) {
      const targetIds = new Set(workflowRefs.map((r) => r.id));
      const found = await this.workflowCatalog.findForEnqueue([...targetIds]);
      workflowRefs.filter((r) => !found.has(r.id)).forEach((r) => details.push({ field: r.field, message: r.id }));
    }

    if (details.length > 0) {
      throw new ApiException('INVALID_REFERENCE', 404, '선택한 항목 중 존재하지 않는 참조가 있습니다.', details);
    }
  }

  async create(chatbotId: string, dto: CreateDialogNodeDto): Promise<DialogNode> {
    await this.scope.assertWritable(chatbotId);
    const name = dto.name.trim();
    const nameNormalized = normalizeText(name);
    this.assertNoLegacyApiOutputs(dto.outputs);
    this.assertNoLegacySurveyOutputs(dto.outputs);
    this.assertWorkflowOutputLimit(dto.outputs);
    await this.assertNameFree(chatbotId, nameNormalized);
    await this.assertNodeTypeSingleton(chatbotId, dto.nodeType);
    await this.validateReferences(chatbotId, dto);
    this.assertNotSystemNodeWithTopic(dto.nodeType, dto.topicId);
    if (dto.topicId) await this.topicLookup.assertTopicInChatbot(chatbotId, dto.topicId);

    const intentIds = dedupeIds(dto.intentIds);
    const keywordIds = dedupeIds(dto.keywordIds);

    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.dialogNode.create({
        data: {
          chatbotId,
          name,
          nameNormalized,
          description: dto.description,
          nodeType: dto.nodeType,
          matchMode: dto.matchMode,
          enabled: dto.enabled,
          priority: dto.priority,
          contextVariableId: dto.contextVariableId,
          outputs: JSON.stringify(dto.outputs),
          topicId: dto.topicId ?? undefined,
        },
      });
      if (intentIds.length > 0) await tx.dialogNodeIntent.createMany({ data: intentIds.map((intentId) => ({ nodeId: created.id, intentId })) });
      if (keywordIds.length > 0) await tx.dialogNodeKeyword.createMany({ data: keywordIds.map((keywordId) => ({ nodeId: created.id, keywordId })) });
      return tx.dialogNode.findUniqueOrThrow({ where: { id: created.id }, include: { intentLinks: true, keywordLinks: true } });
    });
    this.bundleService.invalidate(chatbotId);
    await this.auditLogService.record({
      action: 'CREATE',
      targetType: 'DialogNode',
      targetId: row.id,
      targetName: row.name,
      chatbotId,
      after: this.toAuditSnapshot(row),
    });

    return toDialogNodeResponse(row);
  }

  async list(chatbotId: string, query: DialogNodeListQuery): Promise<Paginated<DialogNodeListItem>> {
    await this.scope.assertReadable(chatbotId);
    const where: Prisma.DialogNodeWhereInput = { chatbotId };
    const andConditions: Prisma.DialogNodeWhereInput[] = [];
    if (query.q) andConditions.push({ OR: [{ name: { contains: query.q } }, { description: { contains: query.q } }] });
    if (query.nodeType && query.nodeType.length > 0) where.nodeType = { in: query.nodeType };
    if (query.enabled !== undefined) where.enabled = query.enabled;
    const topicWhere = buildTopicIdsWhere(query.topicIds);
    if (topicWhere) andConditions.push(topicWhere as Prisma.DialogNodeWhereInput);
    if (andConditions.length > 0) where.AND = andConditions;
    const orderBy = { [query.sort]: query.order } as Prisma.DialogNodeOrderByWithRelationInput;

    // [신규 No.22 — FR-TP4-5] "다른 토픽 참조 n" 배지 — 기존 전체 노드/의도/키워드/컨텍스트 조회에
    // topicId select만 추가한다. **쿼리 수 불변**(6개 그대로) — 노드는 동음이의어·FAQ를 직접 참조하지
    // 않으므로(§7.1) 그 두 종류는 이 계산에 필요 없다.
    const [rows, total, allNodes, intents, keywords, contexts] = await Promise.all([
      this.prisma.dialogNode.findMany({
        where,
        include: { intentLinks: true, keywordLinks: true },
        orderBy,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.dialogNode.count({ where }),
      this.prisma.dialogNode.findMany({ where: { chatbotId }, include: { intentLinks: true, keywordLinks: true } }),
      this.prisma.intent.findMany({ where: { chatbotId }, select: { id: true, name: true, topicId: true } }),
      this.prisma.keyword.findMany({ where: { chatbotId }, select: { id: true, name: true, topicId: true } }),
      this.prisma.contextVariable.findMany({ where: { chatbotId }, select: { id: true, name: true, topicId: true } }),
    ]);

    const incomingCounts = computeIncomingCounts(
      allNodes.map((n) => ({ id: n.id, outputs: parseOutputs(n.outputs, n.id) })) as unknown as Parameters<typeof computeIncomingCounts>[0],
    );
    const intentNames = new Map(intents.map((i) => [i.id, i.name]));
    const keywordNames = new Map(keywords.map((k) => [k.id, k.name]));
    const contextNames = new Map(contexts.map((c) => [c.id, c.name]));

    // 노드가 나가는 방향으로 가리킬 수 있는 대상(의도·키워드·컨텍스트·다른 노드)만 담은 최소 번들 —
    // 동음이의어·FAQ·설문은 노드의 나가는 참조 대상이 아니므로 빈 배열이다(collectAssetRefs 입력 형태만 충족).
    const badgeBundle = {
      intents: intents.map((i) => ({ id: i.id, chatbotId, name: i.name, examples: [], topicId: i.topicId ?? undefined, createdAt: new Date(0), updatedAt: new Date(0) })),
      keywords: keywords.map((k) => ({ id: k.id, chatbotId, name: k.name, synonyms: [], topicId: k.topicId ?? undefined, createdAt: new Date(0), updatedAt: new Date(0) })),
      homonyms: [],
      dialogNodes: allNodes.map((n) => toDialogNodeResponse(n)),
      contexts: contexts.map((c) => ({
        id: c.id,
        chatbotId,
        name: c.name,
        slots: [],
        cancelKeywords: [],
        sessionTimeoutMinutes: 30,
        topicId: c.topicId ?? undefined,
        createdAt: new Date(0),
        updatedAt: new Date(0),
      })),
      faqs: [],
    };
    const topicKeyById = new Map<string, string | null>();
    for (const n of allNodes) topicKeyById.set(n.id, n.topicId);
    for (const i of intents) topicKeyById.set(i.id, i.topicId);
    for (const k of keywords) topicKeyById.set(k.id, k.topicId);
    for (const c of contexts) topicKeyById.set(c.id, c.topicId);

    const hasAnyTopic = [...topicKeyById.values()].some((v) => v !== null);
    const crossTopicRefCounts = new Map<string, number>();
    if (hasAnyTopic) {
      for (const ref of collectAssetRefs(badgeBundle)) {
        if (ref.fromKind !== 'NODE') continue;
        const fromTopic = topicKeyById.get(ref.fromId) ?? null;
        const toTopic = topicKeyById.get(ref.toId) ?? null;
        if (fromTopic === toTopic) continue;
        if (toTopic === null) continue; // 공통으로의 참조는 배지에서 제외(§5.3)
        crossTopicRefCounts.set(ref.fromId, (crossTopicRefCounts.get(ref.fromId) ?? 0) + 1);
      }
    }

    const items = rows.map((row) => {
      const entity = toDialogNodeResponse(row);
      return {
        ...entity,
        conditionSummary: buildConditionSummary(entity, intentNames, keywordNames, contextNames),
        outputTypes: extractOutputTypes(entity.outputs),
        incomingCount: incomingCounts.get(entity.id) ?? 0,
        topicId: row.topicId ?? null,
        crossTopicRefCount: crossTopicRefCounts.get(row.id) ?? 0,
      };
    });

    return toPaginated(items, total, query.page, query.pageSize);
  }

  private async findRowOrThrow(chatbotId: string, id: string): Promise<NodeRowWithLinks> {
    const row = await this.prisma.dialogNode.findFirst({ where: { id, chatbotId }, include: { intentLinks: true, keywordLinks: true } });
    if (!row) throw new ApiException('NOT_FOUND', 404, NOT_FOUND_MESSAGE);
    return row;
  }

  async findOne(chatbotId: string, id: string): Promise<DialogNode> {
    await this.scope.assertReadable(chatbotId);
    return toDialogNodeResponse(await this.findRowOrThrow(chatbotId, id));
  }

  async update(chatbotId: string, id: string, dto: UpdateDialogNodeDto): Promise<DialogNode> {
    await this.scope.assertWritable(chatbotId);
    const current = await this.findRowOrThrow(chatbotId, id);
    // [No.26] outputs가 없으면 기존 v1을 그대로 둔다(자동 삭제 없음, P-4 · §21 D-16).
    if (dto.outputs !== undefined) {
      this.assertNoLegacyApiOutputs(dto.outputs);
      this.assertNoLegacySurveyOutputs(dto.outputs);
      this.assertWorkflowOutputLimit(dto.outputs);
    }

    let name = current.name;
    let nameNormalized = current.nameNormalized;
    if (dto.name !== undefined) {
      name = dto.name.trim();
      nameNormalized = normalizeText(name);
      await this.assertNameFree(chatbotId, nameNormalized, id);
    }

    const nodeType = dto.nodeType ?? (current.nodeType as DialogNodeType);
    if (dto.nodeType !== undefined && dto.nodeType !== current.nodeType) {
      await this.assertNodeTypeSingleton(chatbotId, dto.nodeType, id);
    }

    const intentIds = dto.intentIds !== undefined ? dedupeIds(dto.intentIds) : current.intentLinks.map((l) => l.intentId);
    const keywordIds = dto.keywordIds !== undefined ? dedupeIds(dto.keywordIds) : current.keywordLinks.map((l) => l.keywordId);
    const contextVariableId =
      dto.contextVariableId !== undefined ? (dto.contextVariableId ?? undefined) : (current.contextVariableId ?? undefined);
    const outputs = dto.outputs !== undefined ? dto.outputs : parseOutputs(current.outputs, id);
    const enabled = dto.enabled ?? current.enabled;

    const conditionCount = intentIds.length + keywordIds.length + (contextVariableId ? 1 : 0);
    if (nodeType === 'NORMAL' && conditionCount === 0) {
      throw new ApiException('VALIDATION_FAILED', 400, '조건을 1개 이상 지정하거나 시작/폴백 노드로 지정해 주세요.');
    }
    if (enabled && outputs.length === 0) {
      throw new ApiException('VALIDATION_FAILED', 400, '활성화된 노드는 아웃풋을 1개 이상 등록해야 합니다.');
    }

    await this.validateReferences(chatbotId, { intentIds, keywordIds, contextVariableId, outputs });

    const finalTopicId = dto.topicId !== undefined ? dto.topicId : (current.topicId ?? undefined);
    this.assertNotSystemNodeWithTopic(nodeType, finalTopicId);
    if (dto.topicId !== undefined && dto.topicId !== null) {
      await this.topicLookup.assertTopicInChatbot(chatbotId, dto.topicId);
    }
    const onlyTopicIdChanged =
      dto.topicId !== undefined &&
      dto.name === undefined &&
      dto.description === undefined &&
      dto.nodeType === undefined &&
      dto.matchMode === undefined &&
      dto.enabled === undefined &&
      dto.priority === undefined &&
      dto.intentIds === undefined &&
      dto.keywordIds === undefined &&
      dto.contextVariableId === undefined &&
      dto.outputs === undefined;

    const row = await this.prisma.$transaction(async (tx) => {
      await tx.dialogNode.update({
        where: { id },
        data: {
          name,
          nameNormalized,
          ...(dto.description !== undefined ? { description: dto.description } : {}),
          nodeType,
          matchMode: dto.matchMode ?? current.matchMode,
          enabled,
          priority: dto.priority ?? current.priority,
          contextVariableId: contextVariableId ?? null,
          ...(dto.outputs !== undefined ? { outputs: JSON.stringify(outputs) } : {}),
          ...(dto.topicId !== undefined ? { topicId: dto.topicId } : {}),
          ...(onlyTopicIdChanged ? { updatedAt: current.updatedAt } : {}),
        },
      });
      if (dto.intentIds !== undefined) {
        await tx.dialogNodeIntent.deleteMany({ where: { nodeId: id } });
        if (intentIds.length > 0) await tx.dialogNodeIntent.createMany({ data: intentIds.map((intentId) => ({ nodeId: id, intentId })) });
      }
      if (dto.keywordIds !== undefined) {
        await tx.dialogNodeKeyword.deleteMany({ where: { nodeId: id } });
        if (keywordIds.length > 0) await tx.dialogNodeKeyword.createMany({ data: keywordIds.map((keywordId) => ({ nodeId: id, keywordId })) });
      }
      return tx.dialogNode.findUniqueOrThrow({ where: { id }, include: { intentLinks: true, keywordLinks: true } });
    });
    this.bundleService.invalidate(chatbotId);
    await this.auditLogService.record({
      action: 'UPDATE',
      targetType: 'DialogNode',
      targetId: row.id,
      targetName: row.name,
      chatbotId,
      before: this.toAuditSnapshot(current),
      after: this.toAuditSnapshot(row),
    });

    return toDialogNodeResponse(row);
  }

  async copy(chatbotId: string, id: string, dto: CopyDialogNodeDto): Promise<DialogNodeCopyResponse> {
    await this.scope.assertWritable(chatbotId);
    const original = await this.findRowOrThrow(chatbotId, id);
    const name = dto.name?.trim() || `${original.name} (사본)`;
    const nameNormalized = normalizeText(name);
    await this.assertNameFree(chatbotId, nameNormalized);

    // 복사본은 enabled=false로 생성된다(FR-5-9). START/FALLBACK은 단일성 제약과 충돌하므로 NORMAL로 낮춘다.
    const nodeType: DialogNodeType = original.nodeType === 'START' || original.nodeType === 'FALLBACK' ? 'NORMAL' : (original.nodeType as DialogNodeType);

    const intentIds = original.intentLinks.map((l) => l.intentId);
    const keywordIds = original.keywordLinks.map((l) => l.keywordId);

    // [No.26] 원본의 v1 `API_CONDITION`은 사본에서 제외한다(헤더 토큰 복제 차단 — FR-L1-4). v2는
    // 시크릿이 없으므로 그대로 복사한다(FR-L3-5).
    // [No.27] 원본의 v1 `SURVEY`도 사본에서 제외한다(FR-SV1-5 — 사본이 곧바로 저장 불가 노드가 되는 것을 막는다). v2는 그대로 복사한다.
    const originalOutputs = parseOutputs(original.outputs, id);
    const legacyIndexes = new Set(findLegacyApiOutputIndexes(originalOutputs));
    const legacySurveyIndexes = new Set(findLegacySurveyOutputIndexes(originalOutputs));
    const filteredOutputs = originalOutputs.filter((_, i) => !legacyIndexes.has(i) && !legacySurveyIndexes.has(i));
    const excludedLegacyApiOutputCount = legacyIndexes.size;
    const excludedLegacySurveyOutputCount = legacySurveyIndexes.size;

    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.dialogNode.create({
        data: {
          chatbotId,
          name,
          nameNormalized,
          description: original.description,
          nodeType,
          matchMode: original.matchMode,
          enabled: false,
          priority: original.priority,
          contextVariableId: original.contextVariableId,
          outputs: JSON.stringify(filteredOutputs),
          // [신규 No.22] 복사본이 원본 topicId를 승계한다(§16.2). 원본이 START/FALLBACK이면 항상 null이다.
          topicId: original.topicId,
        },
      });
      if (intentIds.length > 0) await tx.dialogNodeIntent.createMany({ data: intentIds.map((intentId) => ({ nodeId: created.id, intentId })) });
      if (keywordIds.length > 0) await tx.dialogNodeKeyword.createMany({ data: keywordIds.map((keywordId) => ({ nodeId: created.id, keywordId })) });
      return tx.dialogNode.findUniqueOrThrow({ where: { id: created.id }, include: { intentLinks: true, keywordLinks: true } });
    });
    this.bundleService.invalidate(chatbotId);
    await this.auditLogService.record({
      action: 'COPY',
      targetType: 'DialogNode',
      targetId: row.id,
      targetName: row.name,
      chatbotId,
      after: this.toAuditSnapshot(row),
    });

    return { ...toDialogNodeResponse(row), excludedLegacyApiOutputCount, excludedLegacySurveyOutputCount };
  }

  async remove(chatbotId: string, id: string): Promise<void> {
    await this.scope.assertWritable(chatbotId);
    const current = await this.findRowOrThrow(chatbotId, id);
    await this.referenceCheck.assertNodeDeletable(chatbotId, id);
    await this.prisma.$transaction(async (tx) => {
      await tx.dialogNodeIntent.deleteMany({ where: { nodeId: id } });
      await tx.dialogNodeKeyword.deleteMany({ where: { nodeId: id } });
      await tx.dialogNode.delete({ where: { id } });
    });
    this.bundleService.invalidate(chatbotId);
    await this.auditLogService.record({
      action: 'DELETE',
      targetType: 'DialogNode',
      targetId: current.id,
      targetName: current.name,
      chatbotId,
      before: this.toAuditSnapshot(current),
    });
  }

  async validate(chatbotId: string): Promise<DesignValidationReport> {
    await this.scope.assertReadable(chatbotId);
    const bundle = await this.bundleService.build(chatbotId);

    // [No.26] v2 API_CONDITION이 참조하는 연결 id를 모아 1회 조회해 설계 점검 컨텍스트로 주입한다
    // (§5.9 ⑧~⑪ — 엔진 순수성 유지, 데이터는 서비스가 조회한다).
    const connectionIds = new Set<string>();
    for (const node of bundle.dialogNodes) {
      for (const output of node.outputs) {
        if (output.type === 'API_CONDITION' && isApiConditionV2(output.payload)) connectionIds.add(output.payload.connectionId);
      }
    }
    const apiConnections = await this.apiConnectionCatalog.designInfo([...connectionIds]);

    // [신규 No.41] `WORKFLOW`가 있을 때만 카탈로그 1회 조회(엔진 순수성 · 추가 조회 0 — §5.7).
    const workflowTargetIds = new Set<string>();
    for (const node of bundle.dialogNodes) {
      for (const output of node.outputs) {
        if (output.type === 'WORKFLOW') workflowTargetIds.add(output.payload.targetId);
      }
    }
    const workflowTargets = workflowTargetIds.size > 0 ? await this.workflowCatalog.designInfo([...workflowTargetIds]) : undefined;

    const engineReport = validateDialogueDesign(bundle, new Date(), { apiConnections, ...(workflowTargets ? { workflowTargets } : {}) });

    // [신규 No.22 — §7.3] 토픽 규칙 4종을 엔진 결과 뒤에 합친다(엔진 코드 변경 0). 토픽이 없는
    // 챗봇은 +1 조회만 하고 결과는 바이트 동일이다(AC-TP4-4).
    const topics = await this.topicLookup.listForChatbot(chatbotId);
    if (topics.length === 0) return engineReport;

    const handoffSetting = await this.prisma.chatbotHandoffSetting.findUnique({ where: { chatbotId }, select: { endButtonNodeId: true } });
    const { issues: topicIssues, ruleTotals } = validateTopicBoundaries(bundle, topics, { handoffEndButtonNodeId: handoffSetting?.endButtonNodeId ?? null });

    const issues = [...engineReport.issues, ...topicIssues];
    const summary = {
      error: issues.filter((i) => i.severity === 'ERROR').length,
      warning: issues.filter((i) => i.severity === 'WARNING').length,
      info: issues.filter((i) => i.severity === 'INFO').length,
    };
    return { issues, summary, checkedAt: engineReport.checkedAt, ...(ruleTotals ? { ruleTotals } : {}) };
  }

  async flow(chatbotId: string): Promise<FlowTree> {
    await this.scope.assertReadable(chatbotId);
    const bundle = await this.bundleService.build(chatbotId);
    return buildFlowTree(bundle);
  }
}
