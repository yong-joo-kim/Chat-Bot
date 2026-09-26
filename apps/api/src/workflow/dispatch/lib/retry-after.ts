/**
 * [신규 No.41] `Retry-After` 해석(§7.5) — 순수. 초 또는 HTTP-date. 과거·파싱 실패·상한 초과는
 * `null`(호출부가 백오프로 대체한다). 상한 = 2시간(AC-WF4-3).
 */
const MAX_RETRY_AFTER_MS = 2 * 60 * 60 * 1000;

export function parseRetryAfterMs(value: string | undefined, now: Date): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    const seconds = Number(trimmed);
    if (!Number.isFinite(seconds) || seconds <= 0) return null;
    const ms = seconds * 1000;
    return ms > MAX_RETRY_AFTER_MS ? MAX_RETRY_AFTER_MS : ms;
  }
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) return null;
  const ms = date.getTime() - now.getTime();
  if (ms <= 0) return null;
  return ms > MAX_RETRY_AFTER_MS ? MAX_RETRY_AFTER_MS : ms;
}
