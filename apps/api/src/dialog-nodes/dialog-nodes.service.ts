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
  isApiConditionV2,
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
import { ApiConnectionCatalogService } from '../api-connections/catalog/api-connection-catalog.service';
import { NodeRowWithLinks, parseOutputs, toDialogNodeEntity, toDialogNodeResponse } from './dialog-node.mapper';
import { dedupeIds } from './lib/node-links';
import { buildConditionSummary, extractOutputTypes } from './lib/node-condition-summary';

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
  ) {}

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
    const nodeTargetRefs: Array<{ id: string; field: string }> = [];
    const contextFormIds = new Set<string>();
    input.outputs.forEach((o, i) => {
      if (o.type === 'DIALOG_MOVE') nodeTargetRefs.push({ id: o.payload.targetNodeId, field: `outputs.${i}.payload.targetNodeId` });
      if (o.type === 'CONTEXT_FORM') contextFormIds.add(o.payload.contextVariableId);
      if (o.type === 'BUTTON') {
        o.payload.buttons.forEach((b, k) => {
          if (b.action === 'NODE') nodeTargetRefs.push({ id: b.value, field: `outputs.${i}.payload.buttons.${k}.value` });
        });
      }
      if (o.type === 'CARD' && o.payload.buttons) {
        o.payload.buttons.forEach((b, k) => {
          if (b.action === 'NODE') nodeTargetRefs.push({ id: b.value, field: `outputs.${i}.payload.buttons.${k}.value` });
        });
      }
      // [No.26] API 조건분기(v1·v2 모두)의 분기 대상 노드도 참조 검증 대상이다(J-17, FR-L3-1/2).
      if (o.type === 'API_CONDITION') {
        o.payload.conditions.forEach((c, j) => {
          nodeTargetRefs.push({ id: c.nextNodeId, field: `outputs.${i}.payload.conditions.${j}.nextNodeId` });
        });
        if (isApiConditionV2(o.payload)) {
          if (o.payload.defaultNodeId) nodeTargetRefs.push({ id: o.payload.defaultNodeId, field: `outputs.${i}.payload.defaultNodeId` });
          if (o.payload.failureNodeId) nodeTargetRefs.push({ id: o.payload.failureNodeId, field: `outputs.${i}.payload.failureNodeId` });
        }
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

    if (details.length > 0) {
      throw new ApiException('INVALID_REFERENCE', 404, '선택한 항목 중 존재하지 않는 참조가 있습니다.', details);
    }
  }

  async create(chatbotId: string, dto: CreateDialogNodeDto): Promise<DialogNode> {
    await this.scope.assertWritable(chatbotId);
    const name = dto.name.trim();
    const nameNormalized = normalizeText(name);
    this.assertNoLegacyApiOutputs(dto.outputs);
    await this.assertNameFree(chatbotId, nameNormalized);
    await this.assertNodeTypeSingleton(chatbotId, dto.nodeType);
    await this.validateReferences(chatbotId, dto);

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
    if (query.q) where.OR = [{ name: { contains: query.q } }, { description: { contains: query.q } }];
    if (query.nodeType && query.nodeType.length > 0) where.nodeType = { in: query.nodeType };
    if (query.enabled !== undefined) where.enabled = query.enabled;
    const orderBy = { [query.sort]: query.order } as Prisma.DialogNodeOrderByWithRelationInput;

    const [rows, total, allNodes, intents, keywords, contexts] = await Promise.all([
      this.prisma.dialogNode.findMany({
        where,
        include: { intentLinks: true, keywordLinks: true },
        orderBy,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.dialogNode.count({ where }),
      this.prisma.dialogNode.findMany({ where: { chatbotId }, select: { id: true, outputs: true } }),
      this.prisma.intent.findMany({ where: { chatbotId }, select: { id: true, name: true } }),
      this.prisma.keyword.findMany({ where: { chatbotId }, select: { id: true, name: true } }),
      this.prisma.contextVariable.findMany({ where: { chatbotId }, select: { id: true, name: true } }),
    ]);

    const incomingCounts = computeIncomingCounts(
      allNodes.map((n) => ({ id: n.id, outputs: parseOutputs(n.outputs, n.id) })) as unknown as Parameters<typeof computeIncomingCounts>[0],
    );
    const intentNames = new Map(intents.map((i) => [i.id, i.name]));
    const keywordNames = new Map(keywords.map((k) => [k.id, k.name]));
    const contextNames = new Map(contexts.map((c) => [c.id, c.name]));

    const items = rows.map((row) => {
      const entity = toDialogNodeResponse(row);
      return {
        ...entity,
        conditionSummary: buildConditionSummary(entity, intentNames, keywordNames, contextNames),
        outputTypes: extractOutputTypes(entity.outputs),
        incomingCount: incomingCounts.get(entity.id) ?? 0,
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
    if (dto.outputs !== undefined) this.assertNoLegacyApiOutputs(dto.outputs);

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
    const originalOutputs = parseOutputs(original.outputs, id);
    const legacyIndexes = new Set(findLegacyApiOutputIndexes(originalOutputs));
    const filteredOutputs = originalOutputs.filter((_, i) => !legacyIndexes.has(i));
    const excludedLegacyApiOutputCount = legacyIndexes.size;

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

    return { ...toDialogNodeResponse(row), excludedLegacyApiOutputCount };
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

    return validateDialogueDesign(bundle, new Date(), { apiConnections });
  }

  async flow(chatbotId: string): Promise<FlowTree> {
    await this.scope.assertReadable(chatbotId);
    const bundle = await this.bundleService.build(chatbotId);
    return buildFlowTree(bundle);
  }
}
