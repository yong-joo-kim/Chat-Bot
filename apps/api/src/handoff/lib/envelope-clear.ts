import { ConversationStateSchema } from '@chat-bot/shared-types';
import type { ConversationState } from '@chat-bot/shared-types';

/**
 * 상담이 연결된 시각 이전에 시작된 진행 상태를 비운다(J-16, §5.4). **새 키·새 값 0** — 유효한
 * 봉투 값을 줄이는 방향으로만 동작하는 순수 함수다(엔진 밖, DB·Nest 무의존, NFR-CSM1). 멱등 —
 * 이미 비어 있으면 입력과 동일한 형태를 반환한다.
 *
 * 검증 실패(`safeParse` 실패)면 원본을 그대로 돌려준다 — 엔진의 기존 `sanitizeConversationState`가
 * 처리하게 둔다(이 함수는 상담 관점의 정리만 책임진다).
 */
export function clearEnvelopeForHandoff(raw: unknown, connectedAt: Date): unknown {
  const parsed = ConversationStateSchema.safeParse(raw);
  if (!parsed.success) return raw;

  const state = parsed.data;
  const next: ConversationState = { ...state };

  if (state.contextSession && state.contextSession.startedAt < connectedAt) {
    next.contextSession = null;
  }
  if (state.surveySession && state.surveySession.startedAt < connectedAt) {
    delete next.surveySession;
  }
  if (state.pendingClarify && state.pendingClarify.askedAt < connectedAt) {
    delete next.pendingClarify;
  }

  return next;
}
