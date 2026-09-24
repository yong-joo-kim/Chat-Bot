import { CHATBOT_STATUS_TRANSITIONS, ChatbotStatus } from '@chat-bot/shared-types';

export type StatusTransitionEvaluation = { kind: 'noop' } | { kind: 'allowed' } | { kind: 'denied' };

/**
 * 허용 전이 판정(FR-1-17, AC-1-13). 동일 상태로의 요청은 'noop'(200 no-op, NFR-A3 멱등성)으로 처리한다.
 * 순수 함수 — `CHATBOT_STATUS_TRANSITIONS`(shared-types, FE/BE 공용 상수)를 그대로 사용한다.
 */
export function evaluateStatusTransition(from: ChatbotStatus, to: ChatbotStatus): StatusTransitionEvaluation {
  if (from === to) return { kind: 'noop' };
  return CHATBOT_STATUS_TRANSITIONS[from].includes(to) ? { kind: 'allowed' } : { kind: 'denied' };
}

/**
 * [신규 No.29] `Chatbot.archivedAt` 동기화 규칙(§3.5, ADR-0033) — `status='ARCHIVED'` ⇔
 * `archivedAt != null` 불변식을 지킨다. 호출부 2곳(`archive()`·`updateStatus()`)이 공유하는 순수 함수.
 */
export function archivedAtPatch(prev: ChatbotStatus, next: ChatbotStatus, now: Date): { archivedAt?: Date | null } {
  if (next === 'ARCHIVED' && prev !== 'ARCHIVED') return { archivedAt: now };
  if (prev === 'ARCHIVED' && next !== 'ARCHIVED') return { archivedAt: null };
  return {};
}
