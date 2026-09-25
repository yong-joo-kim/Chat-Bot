import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ContextListItem,
  ContextListQuery,
  ContextVariable,
  CreateContextDto,
  Paginated,
  UpdateContextDto,
  normalizeText,
} from '@chat-bot/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { ApiException } from '../common/api.exception';
import { toPaginated } from '../common/pagination';
import { AuditLogService } from '../audit-logs/audit-log.service';
import { ChatbotScopeService } from '../chatbots/chatbot-scope.service';
import { ReferenceCheckService } from '../dialogue-common/reference-check.service';
import { DialogueBundleService } from '../dialogue-common/dialogue-bundle.service';
import { toContextEntity, toContextListItem } from './context.mapper';
import { findInvalidKeywordIds } from './lib/slot-definition';
import { TopicLookupService } from '../topics/topic-lookup.service';
import { buildTopicIdsWhere } from '../topics/lib/topic-query-filter';

const NOT_FOUND_MESSAGE = '요청하신 컨텍스트를 찾을 수 없습니다.';

@Injectable()
export class ContextsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ChatbotScopeService,
    private readonly referenceCheck: ReferenceCheckService,
    private readonly bundleService: DialogueBundleService,
    private readonly auditLogService: AuditLogService,
    private readonly topicLookup: TopicLookupService,
  ) {}

  private toAuditSnapshot(row: { id: string; name: string; slots: string; cancelKeywords: string; sessionTimeoutMinutes: number; topicId?: string | null }) {
    let slotCount = 0;
    try {
      const parsed = JSON.parse(row.slots);
      slotCount = Array.isArray(parsed) ? parsed.length : 0;
    } catch {
      slotCount = 0;
    }
    const { topicId, ...rest } = row;
    return { ...rest, slotCount, ...(topicId ? { topicId } : {}) };
  }

  private async assertNameFree(chatbotId: string, nameNormalized: string, excludeId?: string): Promise<void> {
    const existing = await this.prisma.contextVariable.findFirst({
      where: { chatbotId, nameNormalized, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { id: true, topic: { select: { name: true } } },
    });
    if (existing) {
      const suffix = existing.topic ? `(토픽: ${existing.topic.name})` : '';
      throw new ApiException('DUPLICATE_NAME', 409, `이미 같은 이름의 컨텍스트가 있습니다.${suffix}`);
    }
  }

  private async assertKeywordRefsValid(chatbotId: string, slots: CreateContextDto['slots']): Promise<void> {
    const keywordIds = slots.map((s) => s.keywordId).filter((id): id is string => !!id);
    if (keywordIds.length === 0) return;
    const found = await this.prisma.keyword.findMany({ where: { chatbotId, id: { in: keywordIds } }, select: { id: true } });
    const invalid = findInvalidKeywordIds(slots, new Set(found.map((f) => f.id)));
    if (invalid.length > 0) {
      throw new ApiException(
        'INVALID_REFERENCE',
        404,
        '선택한 키워드를 찾을 수 없습니다.',
        invalid.map((id) => ({ field: 'slots.keywordId', message: id })),
      );
    }
  }

  async create(chatbotId: string, dto: CreateContextDto): Promise<ContextVariable> {
    await this.scope.assertWritable(chatbotId);
    const trimmedName = dto.name.trim();
    const nameNormalized = normalizeText(trimmedName);
    await this.assertNameFree(chatbotId, nameNormalized);
    await this.assertKeywordRefsValid(chatbotId, dto.slots);
    if (dto.topicId) await this.topicLookup.assertTopicInChatbot(chatbotId, dto.topicId);

    const row = await this.prisma.contextVariable.create({
      data: {
        chatbotId,
        name: trimmedName,
        nameNormalized,
        description: dto.description,
        slots: JSON.stringify(dto.slots),
        completionMessage: dto.completionMessage,
        cancelKeywords: JSON.stringify(dto.cancelKeywords ?? ['취소', '그만', '처음으로']),
        sessionTimeoutMinutes: dto.sessionTimeoutMinutes ?? 30,
        topicId: dto.topicId ?? undefined,
      },
    });
    this.bundleService.invalidate(chatbotId);
    await this.auditLogService.record({
      action: 'CREATE',
      targetType: 'ContextVariable',
      targetId: row.id,
      targetName: row.name,
      chatbotId,
      after: this.toAuditSnapshot(row),
    });
    return toContextEntity(row);
  }

  async list(chatbotId: string, query: ContextListQuery): Promise<Paginated<ContextListItem>> {
    await this.scope.assertReadable(chatbotId);
    const where: Prisma.ContextVariableWhereInput = { chatbotId };
    const andConditions: Prisma.ContextVariableWhereInput[] = [];
    if (query.q) andConditions.push({ OR: [{ name: { contains: query.q } }, { description: { contains: query.q } }] });
    const topicWhere = buildTopicIdsWhere(query.topicIds);
    if (topicWhere) andConditions.push(topicWhere as Prisma.ContextVariableWhereInput);
    if (andConditions.length > 0) where.AND = andConditions;
    const orderBy = { [query.sort]: query.order } as Prisma.ContextVariableOrderByWithRelationInput;

    const [rows, total] = await Promise.all([
      this.prisma.contextVariable.findMany({ where, orderBy, skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
      this.prisma.contextVariable.count({ where }),
    ]);
    return toPaginated(rows.map(toContextListItem), total, query.page, query.pageSize);
  }

  private async findRowOrThrow(chatbotId: string, id: string) {
    const row = await this.prisma.contextVariable.findFirst({ where: { id, chatbotId } });
    if (!row) throw new ApiException('NOT_FOUND', 404, NOT_FOUND_MESSAGE);
    return row;
  }

  async findOne(chatbotId: string, id: string): Promise<ContextVariable> {
    await this.scope.assertReadable(chatbotId);
    return toContextEntity(await this.findRowOrThrow(chatbotId, id));
  }

  async update(chatbotId: string, id: string, dto: UpdateContextDto): Promise<ContextVariable> {
    await this.scope.assertWritable(chatbotId);
    const current = await this.findRowOrThrow(chatbotId, id);

    let name = current.name;
    let nameNormalized = current.nameNormalized;
    if (dto.name !== undefined) {
      name = dto.name.trim();
      nameNormalized = normalizeText(name);
      await this.assertNameFree(chatbotId, nameNormalized, id);
    }
    if (dto.slots !== undefined) {
      await this.assertKeywordRefsValid(chatbotId, dto.slots);
    }
    if (dto.topicId !== undefined && dto.topicId !== null) {
      await this.topicLookup.assertTopicInChatbot(chatbotId, dto.topicId);
    }
    const onlyTopicIdChanged =
      dto.topicId !== undefined &&
      dto.name === undefined &&
      dto.description === undefined &&
      dto.slots === undefined &&
      dto.completionMessage === undefined &&
      dto.cancelKeywords === undefined &&
      dto.sessionTimeoutMinutes === undefined;

    const row = await this.prisma.contextVariable.update({
      where: { id },
      data: {
        name,
        nameNormalized,
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.slots !== undefined ? { slots: JSON.stringify(dto.slots) } : {}),
        ...(dto.completionMessage !== undefined ? { completionMessage: dto.completionMessage } : {}),
        ...(dto.cancelKeywords !== undefined ? { cancelKeywords: JSON.stringify(dto.cancelKeywords) } : {}),
        ...(dto.sessionTimeoutMinutes !== undefined ? { sessionTimeoutMinutes: dto.sessionTimeoutMinutes } : {}),
        ...(dto.topicId !== undefined ? { topicId: dto.topicId } : {}),
        ...(onlyTopicIdChanged ? { updatedAt: current.updatedAt } : {}),
      },
    });
    this.bundleService.invalidate(chatbotId);
    await this.auditLogService.record({
      action: 'UPDATE',
      targetType: 'ContextVariable',
      targetId: row.id,
      targetName: row.name,
      chatbotId,
      before: this.toAuditSnapshot(current),
      after: this.toAuditSnapshot(row),
    });
    return toContextEntity(row);
  }

  async remove(chatbotId: string, id: string): Promise<void> {
    await this.scope.assertWritable(chatbotId);
    const current = await this.findRowOrThrow(chatbotId, id);
    await this.referenceCheck.assertContextDeletable(chatbotId, id);
    await this.prisma.contextVariable.delete({ where: { id } });
    this.bundleService.invalidate(chatbotId);
    await this.auditLogService.record({
      action: 'DELETE',
      targetType: 'ContextVariable',
      targetId: current.id,
      targetName: current.name,
      chatbotId,
      before: this.toAuditSnapshot(current),
    });
  }
}
