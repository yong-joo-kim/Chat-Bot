import type { FeedbackRating } from '@chat-bot/shared-types';

export type FeedbackWriteDecision = 'CREATE' | 'NOOP' | 'CHANGE' | 'CLOSED';

/**
 * 멱등·변경·기한 판정(FR-FB4-\*, ADR-0038 §7.3) — 순수 함수. 같은 값 재요청은 기한이 지나도
 * `NOOP`(멱등이 기한보다 우선 — D-17, 재전송 안전). `changeCount`는 CAS로 정확히 센다(D-22).
 */
export function decideFeedbackWrite(i: {
  existing: { rating: FeedbackRating; changeCount: number } | null;
  requested: FeedbackRating;
  turnCreatedAt: Date;
  now: Date;
  windowHours: number;
  maxChanges: number;
}): FeedbackWriteDecision {
  if (i.existing && i.existing.rating === i.requested) return 'NOOP';
  const withinWindow = i.now.getTime() <= i.turnCreatedAt.getTime() + i.windowHours * 3_600_000;
  if (!withinWindow) return 'CLOSED';
  if (!i.existing) return 'CREATE';
  return i.existing.changeCount >= i.maxChanges ? 'CLOSED' : 'CHANGE';
}
