/**
 * [신규 No.43] 적재 재시도 백오프(순수 — §9.5). 1분 · 5분 · 30분 · 3회 초과 = 소진(FAILED).
 */
const SCHEDULE_MS = [60_000, 5 * 60_000, 30 * 60_000];

/** `attemptCount`는 방금 실패를 반영해 증가된 값(1부터 시작). 소진되면 `null`. */
export function computeIngestBackoffMs(attemptCount: number): number | null {
  const idx = attemptCount - 1;
  if (idx < 0 || idx >= SCHEDULE_MS.length) return null;
  return SCHEDULE_MS[idx];
}

export function isIngestRetryExhausted(attemptCount: number): boolean {
  return attemptCount > SCHEDULE_MS.length;
}
