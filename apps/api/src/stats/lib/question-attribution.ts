import { normalizeQuestion } from './dashboard-aggregator';

/**
 * No.29 질문별 최다 챗봇 귀속(J-9, FR-I3-8/9, `integrated-stats-설계.md` §5.6). DB·Nest 무의존 순수 함수.
 * 후보 500행(원문 변형)을 `normalizeQuestion`으로 최종 topN 질문에 병합한 뒤, 챗봇별 합산 최댓값을
 * 고른다 — 동률은 최근 발생 → `chatbotId` 오름차순.
 */
export interface RawChatbotQuestionRow {
  userMessage: string;
  chatbotId: string;
  count: number;
  lastOccurredAt: Date;
}

export interface TopChatbotAttribution {
  chatbotId: string;
  count: number;
}

export function attributeTopChatbot(topQuestions: string[], rows: RawChatbotQuestionRow[]): Map<string, TopChatbotAttribution> {
  const topSet = new Set(topQuestions);
  const byQuestion = new Map<string, Map<string, { count: number; lastOccurredAt: number }>>();

  for (const row of rows) {
    const normalized = normalizeQuestion(row.userMessage);
    if (!topSet.has(normalized)) continue;

    let perChatbot = byQuestion.get(normalized);
    if (!perChatbot) {
      perChatbot = new Map();
      byQuestion.set(normalized, perChatbot);
    }
    const lastOccurredAt = row.lastOccurredAt.getTime();
    const existing = perChatbot.get(row.chatbotId);
    if (existing) {
      existing.count += row.count;
      existing.lastOccurredAt = Math.max(existing.lastOccurredAt, lastOccurredAt);
    } else {
      perChatbot.set(row.chatbotId, { count: row.count, lastOccurredAt });
    }
  }

  const result = new Map<string, TopChatbotAttribution>();
  for (const [question, perChatbot] of byQuestion) {
    const [best] = Array.from(perChatbot.entries())
      .map(([chatbotId, v]) => ({ chatbotId, ...v }))
      .sort((a, b) => (b.count !== a.count ? b.count - a.count : b.lastOccurredAt !== a.lastOccurredAt ? b.lastOccurredAt - a.lastOccurredAt : a.chatbotId.localeCompare(b.chatbotId)));
    if (best) result.set(question, { chatbotId: best.chatbotId, count: best.count });
  }
  return result;
}
