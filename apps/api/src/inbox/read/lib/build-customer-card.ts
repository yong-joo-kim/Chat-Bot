import type { CustomerCard } from '@chat-bot/shared-types';

export interface CustomerCardInput {
  conversationsTotal: number;
  byChannel: Array<{ type: string; label: string; count: number }>;
  byChatbot: Array<{ id: string; name: string; count: number }>;
  firstActivityAt: Date | null;
  lastActivityAt: Date | null;
  topMatches: Array<{ kind: 'INTENT' | 'FAQ'; id: string; name: string; count: number }>;
  unansweredTurns: number;
  handoffCount: number;
  lastEndReason?: string;
  lastAgentName?: string;
  lastEndedAt?: Date;
  surveysCompleted: number;
  negativeFeedbacks: number;
  tags: Array<{ id: string; name: string; color: string }>;
  latestNote?: { text: string; authorName: string; at: Date };
  truncated?: boolean;
}

/** [신규 No.42] 고객 카드 조립(§9.3 — 순수 · 텍스트 생성 0 · 사실 목록만). */
export function buildCustomerCard(input: CustomerCardInput): CustomerCard {
  return {
    conversations: { total: input.conversationsTotal, byChannel: input.byChannel, byChatbot: input.byChatbot },
    firstActivityAt: input.firstActivityAt,
    lastActivityAt: input.lastActivityAt,
    topMatches: input.topMatches.slice(0, 3),
    unansweredTurns: input.unansweredTurns,
    handoffs: {
      count: input.handoffCount,
      ...(input.lastEndReason ? { lastEndReason: input.lastEndReason } : {}),
      ...(input.lastAgentName ? { lastAgentName: input.lastAgentName } : {}),
      ...(input.lastEndedAt ? { lastEndedAt: input.lastEndedAt } : {}),
    },
    surveysCompleted: input.surveysCompleted,
    negativeFeedbacks: input.negativeFeedbacks,
    tags: input.tags,
    ...(input.latestNote ? { latestNote: input.latestNote } : {}),
    ...(input.truncated ? { truncated: true as const } : {}),
  };
}
