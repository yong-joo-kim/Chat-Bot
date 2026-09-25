import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { TopicAssignRequestDto, TopicAssignResult, TopicAssetKind } from '@chat-bot/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { ApiException } from '../common/api.exception';
import { ChatbotScopeService } from '../chatbots/chatbot-scope.service';
import { AuditLogService } from '../audit-logs/audit-log.service';
import { DialogueBundleService } from '../dialogue-common/dialogue-bundle.service';
import { TopicLookupService } from './topic-lookup.service';

const KIND_LABELS: Record<TopicAssetKind, string> = {
  INTENT: '의도',
  KEYWORD: '키워드',
  HOMONYM: '동음이의어',
  CONTEXT: '컨텍스트',
  NODE: '노드',
  FAQ: 'FAQ',
};

interface AssignRow {
  id: string;
  topicId: string | null;
  updatedAt: Date;
  nodeType?: string;
}

/** `updatedAt` 값별로 묶는다(§5.2 — 같은 값끼리 `updateMany` 1회). */
function groupByUpdatedAt(rows: readonly { id: string; updatedAt: Date }[]): Array<{ updatedAt: Date; ids: string[] }> {
  const groups = new Map<number, { updatedAt: Date; ids: string[] }>();
  for (const row of rows) {
    const key = row.updatedAt.getTime();
    const group = groups.get(key) ?? { updatedAt: row.updatedAt, ids: [] };
    group.ids.push(row.id);
    groups.set(key, group);
  }
  return [...groups.values()];
}

/**
 * 자산 6종 `topicId` **일괄 쓰기의 유일한 파일**(§17 T-7). 검증·감사·자동 스냅샷 훅을 타지 않는
 * 분류 전용 경로다 — `updateMany`의 `data` 키는 항상 `{topicId, updatedAt}`뿐이다(내용 불변, FR-TP2-6).
 * kind별로 리터럴 Prisma 호출을 명시한다(제네릭 델리게이트 대신 — 정적 검사(T-7)가 소스 문자열을
 * 그대로 스캔하므로 `tx.intent.updateMany(` 형태가 실제로 나타나야 한다).
 */
@Injectable()
export class TopicAssignmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ChatbotScopeService,
    private readonly auditLogService: AuditLogService,
    private readonly bundleService: DialogueBundleService,
    private readonly topicLookup: TopicLookupService,
  ) {}

  private async findRowsForKind(tx: Prisma.TransactionClient, kind: TopicAssetKind, chatbotId: string, ids: string[]): Promise<AssignRow[]> {
    switch (kind) {
      case 'INTENT':
        return tx.intent.findMany({ where: { chatbotId, id: { in: ids } }, select: { id: true, topicId: true, updatedAt: true } });
      case 'KEYWORD':
        return tx.keyword.findMany({ where: { chatbotId, id: { in: ids } }, select: { id: true, topicId: true, updatedAt: true } });
      case 'HOMONYM':
        return tx.homonymDictionary.findMany({ where: { chatbotId, id: { in: ids } }, select: { id: true, topicId: true, updatedAt: true } });
      case 'CONTEXT':
        return tx.contextVariable.findMany({ where: { chatbotId, id: { in: ids } }, select: { id: true, topicId: true, updatedAt: true } });
      case 'NODE':
        return tx.dialogNode.findMany({ where: { chatbotId, id: { in: ids } }, select: { id: true, topicId: true, updatedAt: true, nodeType: true } });
      case 'FAQ':
        return tx.faqEntry.findMany({ where: { chatbotId, id: { in: ids } }, select: { id: true, topicId: true, updatedAt: true } });
    }
  }

  private async updateManyForKind(tx: Prisma.TransactionClient, kind: TopicAssetKind, ids: string[], topicId: string | null, updatedAt: Date): Promise<void> {
    switch (kind) {
      case 'INTENT':
        await tx.intent.updateMany({ where: { id: { in: ids } }, data: { topicId, updatedAt } });
        return;
      case 'KEYWORD':
        await tx.keyword.updateMany({ where: { id: { in: ids } }, data: { topicId, updatedAt } });
        return;
      case 'HOMONYM':
        await tx.homonymDictionary.updateMany({ where: { id: { in: ids } }, data: { topicId, updatedAt } });
        return;
      case 'CONTEXT':
        await tx.contextVariable.updateMany({ where: { id: { in: ids } }, data: { topicId, updatedAt } });
        return;
      case 'NODE':
        await tx.dialogNode.updateMany({ where: { id: { in: ids } }, data: { topicId, updatedAt } });
        return;
      case 'FAQ':
        await tx.faqEntry.updateMany({ where: { id: { in: ids } }, data: { topicId, updatedAt } });
        return;
    }
  }

  private async findAllInTopicForKind(tx: Prisma.TransactionClient, kind: TopicAssetKind, chatbotId: string, topicId: string): Promise<Array<{ id: string; updatedAt: Date }>> {
    switch (kind) {
      case 'INTENT':
        return tx.intent.findMany({ where: { chatbotId, topicId }, select: { id: true, updatedAt: true } });
      case 'KEYWORD':
        return tx.keyword.findMany({ where: { chatbotId, topicId }, select: { id: true, updatedAt: true } });
      case 'HOMONYM':
        return tx.homonymDictionary.findMany({ where: { chatbotId, topicId }, select: { id: true, updatedAt: true } });
      case 'CONTEXT':
        return tx.contextVariable.findMany({ where: { chatbotId, topicId }, select: { id: true, updatedAt: true } });
      case 'NODE':
        return tx.dialogNode.findMany({ where: { chatbotId, topicId }, select: { id: true, updatedAt: true } });
      case 'FAQ':
        return tx.faqEntry.findMany({ where: { chatbotId, topicId }, select: { id: true, updatedAt: true } });
    }
  }

  async assign(chatbotId: string, dto: TopicAssignRequestDto): Promise<TopicAssignResult> {
    await this.scope.assertWritable(chatbotId);

    let targetTopicEnabled: boolean | null = null;
    if (dto.topicId !== null) {
      await this.topicLookup.assertTopicInChatbot(chatbotId, dto.topicId);
      const topic = await this.prisma.topic.findUnique({ where: { id: dto.topicId }, select: { enabled: true } });
      targetTopicEnabled = topic?.enabled ?? null;
    }

    const changed = await this.prisma.$transaction(async (tx) => {
      const rows = await this.findRowsForKind(tx, dto.kind, chatbotId, dto.ids);
      if (rows.length !== dto.ids.length) {
        const foundIds = new Set(rows.map((r) => r.id));
        const missing = dto.ids.filter((id) => !foundIds.has(id));
        throw new ApiException(
          'INVALID_REFERENCE',
          404,
          `일부 ${KIND_LABELS[dto.kind]}을(를) 찾을 수 없습니다.`,
          missing.map((id) => ({ field: 'ids', message: id })),
        );
      }

      if (dto.kind === 'NODE' && dto.topicId !== null) {
        const locked = rows.filter((r) => r.nodeType === 'START' || r.nodeType === 'FALLBACK');
        if (locked.length > 0) {
          throw new ApiException(
            'TOPIC_SYSTEM_NODE_LOCKED',
            400,
            '시작·폴백 노드는 항상 공통입니다. 선택에서 제외해 주세요.',
            locked.map((r) => ({ field: 'ids', message: r.id })),
          );
        }
      }

      const changedRows = rows.filter((r) => r.topicId !== dto.topicId);
      // ⚠ tx 안에서 Promise.all 금지 — 순차 await(§17 T-14와 같은 규약).
      for (const g of groupByUpdatedAt(changedRows)) {
        await this.updateManyForKind(tx, dto.kind, g.ids, dto.topicId, g.updatedAt);
      }
      return changedRows.length;
    });
    const unchanged = dto.ids.length - changed;

    if (changed > 0) {
      this.bundleService.invalidate(chatbotId);
      // [신규 — M-1 코드리뷰 대응] 대상이 "공통"(topicId=null)이면 Topic 행이 없다 — targetType을
      // 'Chatbot'으로, targetId를 chatbotId로 기록한다(§15 D-14 "대상 토픽(공통이면 챗봇)"). 이 호출은
      // before/after를 넘기지 않는 요약 전용 기록이라 AUDIT_FIELDS 화이트리스트(Topic·Chatbot 어느
      // 쪽이든)를 타지 않는다 — summary 문자열만 남는다(§15 — 요약 액션 분기를 늘리지 않는 규약).
      await this.auditLogService.record({
        action: 'UPDATE',
        targetType: dto.topicId !== null ? 'Topic' : 'Chatbot',
        targetId: dto.topicId ?? chatbotId,
        chatbotId,
        summary: `토픽 지정(${KIND_LABELS[dto.kind]}) ${changed}건 — 대상: ${dto.topicId ? '토픽' : '공통'}`,
      });
    }

    return { kind: dto.kind, requested: dto.ids.length, updated: changed, unchanged, targetTopicEnabled };
  }

  /**
   * 토픽 삭제(§5.4 `moveToCommon=true`)에서만 쓴다 — 트랜잭션 안에서 6종 전부를 공통으로 비운다.
   * `data` 키는 `{topicId: null, updatedAt}`뿐(같은 `updatedAt` 보존 규칙).
   */
  async clearTopicInTx(tx: Prisma.TransactionClient, chatbotId: string, topicId: string): Promise<number> {
    const kinds: TopicAssetKind[] = ['INTENT', 'KEYWORD', 'HOMONYM', 'CONTEXT', 'NODE', 'FAQ'];
    let total = 0;
    for (const kind of kinds) {
      const rows = await this.findAllInTopicForKind(tx, kind, chatbotId, topicId);
      for (const g of groupByUpdatedAt(rows)) {
        await this.updateManyForKind(tx, kind, g.ids, null, g.updatedAt);
        total += g.ids.length;
      }
    }
    return total;
  }
}
