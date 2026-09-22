import type { UnansweredQuestion as PrismaUnansweredQuestion } from '@prisma/client';
import type { IntentSuggestion, UnansweredQuestionListItem, UnansweredQuestionStatus } from '@chat-bot/shared-types';

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
  opts: { resolvedIntentName?: string; suggestions?: IntentSuggestion[] } = {},
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
  };
}
