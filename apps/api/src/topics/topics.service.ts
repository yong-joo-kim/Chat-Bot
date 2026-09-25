import { Injectable } from '@nestjs/common';
import type { CreateTopicDto, DeleteTopicQuery, MoveTopicDto, Topic, UpdateTopicDto } from '@chat-bot/shared-types';
import { TOPIC_LIMITS, normalizeText } from '@chat-bot/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { ApiException } from '../common/api.exception';
import { ChatbotScopeService } from '../chatbots/chatbot-scope.service';
import { AuditLogService } from '../audit-logs/audit-log.service';
import { DialogueBundleService } from '../dialogue-common/dialogue-bundle.service';
import { toTopicDto } from './topic.mapper';
import { findAdjacentForSwap, nextSortOrder } from './lib/topic-order';
import { TopicAssignmentService } from './topic-assignment.service';

const NOT_FOUND_MESSAGE = '요청하신 토픽을 찾을 수 없습니다.';

/**
 * ★ `Topic` 쓰기 유일 파일(topic-system-설계.md §2.1 · §17 T-8) — 생성·이름/설명·이동·활성/비활성·
 * 삭제(+공통으로 옮기기). 자산 소속 일괄 쓰기는 `topic-assignment.service.ts`가 전담한다.
 */
@Injectable()
export class TopicsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ChatbotScopeService,
    private readonly bundleService: DialogueBundleService,
    private readonly auditLogService: AuditLogService,
    private readonly assignmentService: TopicAssignmentService,
  ) {}

  private async findRowOrThrow(chatbotId: string, topicId: string) {
    const row = await this.prisma.topic.findFirst({ where: { id: topicId, chatbotId } });
    if (!row) throw new ApiException('NOT_FOUND', 404, NOT_FOUND_MESSAGE);
    return row;
  }

  private async assertNameFree(chatbotId: string, nameNormalized: string, excludeId?: string): Promise<void> {
    const existing = await this.prisma.topic.findFirst({
      where: { chatbotId, nameNormalized, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { id: true },
    });
    if (existing) throw new ApiException('DUPLICATE_NAME', 409, '이미 같은 이름의 토픽이 있습니다.');
  }

  async create(chatbotId: string, dto: CreateTopicDto): Promise<Topic> {
    await this.scope.assertWritable(chatbotId);
    const name = dto.name.trim();
    const nameNormalized = normalizeText(name);
    await this.assertNameFree(chatbotId, nameNormalized);

    const count = await this.prisma.topic.count({ where: { chatbotId } });
    if (count >= TOPIC_LIMITS.maxPerChatbot) {
      throw new ApiException('LIMIT_EXCEEDED', 409, `토픽은 챗봇당 최대 ${TOPIC_LIMITS.maxPerChatbot}개까지 등록할 수 있습니다.`);
    }

    const existing = await this.prisma.topic.findMany({ where: { chatbotId }, select: { sortOrder: true } });
    const sortOrder = nextSortOrder(existing);

    const row = await this.prisma.topic.create({
      data: { chatbotId, name, nameNormalized, description: dto.description, sortOrder, enabled: dto.enabled },
    });
    // 소속 자산 0건 — 번들 무효화 불필요(§5.1).
    await this.auditLogService.record({
      action: 'CREATE',
      targetType: 'Topic',
      targetId: row.id,
      targetName: row.name,
      chatbotId,
      after: { name: row.name, description: row.description, sortOrder: row.sortOrder, enabled: row.enabled },
    });
    return toTopicDto(row);
  }

  async update(chatbotId: string, topicId: string, dto: UpdateTopicDto): Promise<Topic> {
    await this.scope.assertWritable(chatbotId);
    const current = await this.findRowOrThrow(chatbotId, topicId);

    let name = current.name;
    let nameNormalized = current.nameNormalized;
    if (dto.name !== undefined) {
      name = dto.name.trim();
      nameNormalized = normalizeText(name);
      await this.assertNameFree(chatbotId, nameNormalized, topicId);
    }

    const row = await this.prisma.topic.update({
      where: { id: topicId },
      data: { name, nameNormalized, ...(dto.description !== undefined ? { description: dto.description } : {}) },
    });
    // 번들은 id만 본다 — 이름/설명 변경은 무효화 불필요(FR-TP1-6).
    await this.auditLogService.record({
      action: 'UPDATE',
      targetType: 'Topic',
      targetId: row.id,
      targetName: row.name,
      chatbotId,
      before: { name: current.name, description: current.description, sortOrder: current.sortOrder, enabled: current.enabled },
      after: { name: row.name, description: row.description, sortOrder: row.sortOrder, enabled: row.enabled },
    });
    return toTopicDto(row);
  }

  async move(chatbotId: string, topicId: string, dto: MoveTopicDto): Promise<Topic[]> {
    await this.scope.assertWritable(chatbotId);
    const all = await this.prisma.topic.findMany({ where: { chatbotId }, orderBy: { sortOrder: 'asc' } });
    if (!all.some((t) => t.id === topicId)) throw new ApiException('NOT_FOUND', 404, NOT_FOUND_MESSAGE);

    const adjacent = findAdjacentForSwap(all, topicId, dto.direction);
    if (adjacent) {
      const target = all.find((t) => t.id === topicId)!;
      await this.prisma.$transaction([
        this.prisma.topic.update({ where: { id: target.id }, data: { sortOrder: adjacent.sortOrder } }),
        this.prisma.topic.update({ where: { id: adjacent.id }, data: { sortOrder: target.sortOrder } }),
      ]);
      await this.auditLogService.record({
        action: 'UPDATE',
        targetType: 'Topic',
        targetId: target.id,
        targetName: target.name,
        chatbotId,
        summary: '순서 변경',
      });
    }

    const rows = await this.prisma.topic.findMany({ where: { chatbotId }, orderBy: { sortOrder: 'asc' } });
    return rows.map(toTopicDto);
  }

  private async setEnabled(chatbotId: string, topicId: string, enabled: boolean): Promise<Topic> {
    await this.scope.assertWritable(chatbotId);
    const current = await this.findRowOrThrow(chatbotId, topicId);
    if (current.enabled === enabled) return toTopicDto(current); // 멱등 — 감사·무효화 0

    const row = await this.prisma.topic.update({ where: { id: topicId }, data: { enabled } });
    this.bundleService.invalidate(chatbotId);
    await this.auditLogService.record({
      action: 'STATUS_CHANGE',
      targetType: 'Topic',
      targetId: row.id,
      targetName: row.name,
      chatbotId,
      before: { enabled: current.enabled },
      after: { enabled: row.enabled },
      summary: enabled ? '활성화' : '비활성화',
    });
    return toTopicDto(row);
  }

  enable(chatbotId: string, topicId: string): Promise<Topic> {
    return this.setEnabled(chatbotId, topicId, true);
  }

  disable(chatbotId: string, topicId: string): Promise<Topic> {
    return this.setEnabled(chatbotId, topicId, false);
  }

  async remove(chatbotId: string, topicId: string, query: DeleteTopicQuery): Promise<void> {
    await this.scope.assertWritable(chatbotId);
    const current = await this.findRowOrThrow(chatbotId, topicId);

    const [intents, keywords, homonyms, contexts, dialogNodes, faqs] = await Promise.all([
      this.prisma.intent.count({ where: { chatbotId, topicId } }),
      this.prisma.keyword.count({ where: { chatbotId, topicId } }),
      this.prisma.homonymDictionary.count({ where: { chatbotId, topicId } }),
      this.prisma.contextVariable.count({ where: { chatbotId, topicId } }),
      this.prisma.dialogNode.count({ where: { chatbotId, topicId } }),
      this.prisma.faqEntry.count({ where: { chatbotId, topicId } }),
    ]);
    const counts: Record<string, number> = { intents, keywords, homonyms, contexts, dialogNodes, faqs };
    const nonZero = Object.entries(counts).filter(([, c]) => c > 0);

    if (nonZero.length > 0) {
      if (!query.moveToCommon) {
        throw new ApiException(
          'TOPIC_NOT_EMPTY',
          409,
          '토픽에 속한 자산이 있어 삭제할 수 없습니다.',
          nonZero.map(([key, c]) => ({ field: key, message: String(c) })),
        );
      }

      const moved = await this.prisma.$transaction(async (tx) => {
        const count = await this.assignmentService.clearTopicInTx(tx, chatbotId, topicId);
        await tx.topic.delete({ where: { id: topicId } });
        return count;
      });
      this.bundleService.invalidate(chatbotId);
      await this.auditLogService.record({
        action: 'UPDATE',
        targetType: 'Topic',
        targetId: topicId,
        targetName: current.name,
        chatbotId,
        summary: `공통으로 옮김 ${moved}건`,
      });
      await this.auditLogService.record({
        action: 'DELETE',
        targetType: 'Topic',
        targetId: topicId,
        targetName: current.name,
        chatbotId,
        before: { name: current.name },
      });
      return;
    }

    await this.prisma.topic.delete({ where: { id: topicId } });
    await this.auditLogService.record({
      action: 'DELETE',
      targetType: 'Topic',
      targetId: current.id,
      targetName: current.name,
      chatbotId,
      before: { name: current.name },
    });
  }
}
