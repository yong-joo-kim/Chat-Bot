/**
 * [신규 No.43] 삭제·축소 감지(순수 — §8.3 · J-10 · FR-KB3-5). 연속 2회 규칙 — 일시 장애(5xx·타임아웃)는
 * 삭제로 세지 않는다.
 */
export type MissingObservation = 'SEEN_OK' | 'GONE_HTTP' | 'NOT_REDISCOVERED' | 'TRANSIENT' | 'ROBOTS_BLOCKED';

export interface MissingState {
  missingStreak: number;
  state: 'ACTIVE' | 'GONE' | 'EXCLUDED';
  cleanupReason: string | null;
}

export interface MissingContext {
  everIngested: boolean;
  /** R-21 — 삭제 감지를 셀 수 있는 실행인가(SYNC·FULL_RESEND ∧ 상한 미도달 ∧ 중단 아님 ∧ 호스트 제외 아님). */
  countable: boolean;
}

export function nextMissingState(prev: MissingState, observation: MissingObservation, ctx: MissingContext): MissingState {
  if (observation === 'SEEN_OK') {
    return { missingStreak: 0, state: 'ACTIVE', cleanupReason: prev.cleanupReason === 'GONE' ? null : prev.cleanupReason };
  }
  if (observation === 'TRANSIENT') {
    return prev;
  }
  if (observation === 'ROBOTS_BLOCKED') {
    return { missingStreak: prev.missingStreak, state: 'EXCLUDED', cleanupReason: ctx.everIngested ? 'ROBOTS_DISALLOWED' : prev.cleanupReason };
  }
  // GONE_HTTP | NOT_REDISCOVERED
  if (!ctx.countable) return prev;
  const streak = prev.missingStreak + 1;
  if (streak >= 2) {
    return { missingStreak: streak, state: 'GONE', cleanupReason: ctx.everIngested ? 'GONE' : null };
  }
  return { missingStreak: streak, state: prev.state, cleanupReason: prev.cleanupReason };
}
