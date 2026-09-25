import type { UnansweredQuestion as PrismaUnansweredQuestion } from '@prisma/client';
import type { FeedbackTargetRef, IntentSuggestion, UnansweredQuestionListItem, UnansweredQuestionStatus, UnansweredSource } from '@chat-bot/shared-types';

export function parseVariantsJson(json: string): string[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

/** Prisma row → 목록/상세 공통 DTO(NFR-M3, JSON ↔ 객체 변환은 mapper에서만). */
export function toUnansweredQuestionListItem(
  row: PrismaUnansweredQuestion,
  opts: {
    resolvedIntentName?: string;
    suggestions?: IntentSuggestion[];
    /** [신규 No.44] NEGATIVE_FEEDBACK 행만 — 최근 👎 턴의 답변 대상. */
    lastFeedbackTarget?: FeedbackTargetRef;
    lastFeedbackMatchedIntentId?: string;
  } = {},
): UnansweredQuestionListItem {
  return {
    id: row.id,
    chatbotId: row.chatbotId,
    questionText: row.questionText,
    occurredCount: row.occurredCount,
    status: row.status as UnansweredQuestionStatus,
    firstOccurredAt: row.createdAt,
    lastOccurredAt: row.lastOccurredAt,
    recurredCount: row.recurredCount,
    recurredAfterAt: row.recurredAfterAt ?? undefined,
    channelType: row.channelType ?? undefined,
    resolvedIntentId: row.resolvedIntentId ?? undefined,
    resolvedIntentName: opts.resolvedIntentName,
    resolvedAt: row.resolvedAt ?? undefined,
    suggestions: opts.suggestions ?? [],
    // [신규 No.44] source는 서버가 항상 싣는다(기본값 UNANSWERED — DB 기본값과 동치).
    source: (row.source as UnansweredSource | undefined) ?? 'UNANSWERED',
    lastFeedbackTarget: opts.lastFeedbackTarget,
    lastFeedbackMatchedIntentId: opts.lastFeedbackMatchedIntentId,
    // "직접 수정 완료" = RESOLVED인데 resolvedIntentId가 없다(반영 흐름은 항상 값을 채운다 — 파생 판정, 컬럼 추가 0).
    resolvedDirectly: row.status === 'RESOLVED' && row.resolvedIntentId == null ? true : undefined,
  };
}
