import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  CopyDialogNodeDto,
  CreateDialogNodeDto,
  DesignValidationReport,
  DialogNode,
  DialogNodeListItem,
  DialogNodeListQuery,
  DialogNodeType,
  DialogOutput,
  FlowTree,
  Paginated,
  UpdateDialogNodeDto,
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
import { NodeRowWithLinks, parseOutputs, toDialogNodeEntity } from './dialog-node.mapper';
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
  ) {}

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

    const nodeTargetIds = new Set<string>();
    const contextFormIds = new Set<string>();
    for (const o of input.outputs) {
      if (o.type === 'DIALOG_MOVE') nodeTargetIds.add(o.payload.targetNodeId);
      if (o.type === 'CONTEXT_FORM') contextFormIds.add(o.payload.contextVariableId);
      if (o.type === 'BUTTON') o.payload.buttons.forEach((b) => b.action === 'NODE' && nodeTargetIds.add(b.value));
      if (o.type === 'CARD' && o.payload.buttons) o.payload.buttons.forEach((b) => b.action === 'NODE' && nodeTargetIds.add(b.value));
    }
    if (nodeTargetIds.size > 0) {
      const found = await this.prisma.dialogNode.findMany({ where: { chatbotId, id: { in: [...nodeTargetIds] } }, select: { id: true } });
      const foundSet = new Set(found.map((f) => f.id));
      [...nodeTargetIds].filter((id) => !foundSet.has(id)).forEach((id) => details.push({ field: 'outputs.targetNodeId', message: id }));
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

    return toDialogNodeEntity(row);
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
      const entity = toDialogNodeEntity(row);
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
    return toDialogNodeEntity(await this.findRowOrThrow(chatbotId, id));
  }

  async update(chatbotId: string, id: string, dto: UpdateDialogNodeDto): Promise<DialogNode> {
    await this.scope.assertWritable(chatbotId);
    const current = await this.findRowOrThrow(chatbotId, id);

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

    return toDialogNodeEntity(row);
  }

  async copy(chatbotId: string, id: string, dto: CopyDialogNodeDto): Promise<DialogNode> {
    await this.scope.assertWritable(chatbotId);
    const original = await this.findRowOrThrow(chatbotId, id);
    const name = dto.name?.trim() || `${original.name} (사본)`;
    const nameNormalized = normalizeText(name);
    await this.assertNameFree(chatbotId, nameNormalized);

    // 복사본은 enabled=false로 생성된다(FR-5-9). START/FALLBACK은 단일성 제약과 충돌하므로 NORMAL로 낮춘다.
    const nodeType: DialogNodeType = original.nodeType === 'START' || original.nodeType === 'FALLBACK' ? 'NORMAL' : (original.nodeType as DialogNodeType);

    const intentIds = original.intentLinks.map((l) => l.intentId);
    const keywordIds = original.keywordLinks.map((l) => l.keywordId);

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
          outputs: original.outputs,
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

    return toDialogNodeEntity(row);
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
    return validateDialogueDesign(bundle, new Date());
  }

  async flow(chatbotId: string): Promise<FlowTree> {
    await this.scope.assertReadable(chatbotId);
    const bundle = await this.bundleService.build(chatbotId);
    return buildFlowTree(bundle);
  }
}
