/**
 * [신규 No.43 — pass 5 · RG-4] 크롤 단계 429·503 재시도 지연(순수 — §6.8). `Retry-After`(초 또는 HTTP 날짜)가 있으면 그 값,
 * 없으면 소스 간격의 4배. 어느 쪽이든 정상 간격보다 짧아지지 않고 최대 60초다.
 */
export const THROTTLE_MAX_DELAY_MS = 60_000;
export const HOST_THROTTLE_ABORT_STREAK = 5;

export function throttleDelayMs(retryAfter: string | undefined | null, baseIntervalMs: number, now: Date): number {
  let delay = baseIntervalMs * 4;
  const trimmed = retryAfter?.trim();
  if (trimmed) {
    if (/^\d+$/.test(trimmed)) {
      delay = Number(trimmed) * 1000;
    } else {
      const at = new Date(trimmed).getTime();
      if (!Number.isNaN(at)) delay = at - now.getTime();
    }
  }
  if (!Number.isFinite(delay)) delay = baseIntervalMs * 4;
  return Math.min(Math.max(delay, baseIntervalMs), THROTTLE_MAX_DELAY_MS);
}
