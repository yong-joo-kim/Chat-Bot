/**
 * [신규 No.43 — 항목⑤] `Retry-After` 해석(순수) — 초 또는 HTTP-date. 과거·파싱 실패는 `null`
 * (호출부가 고정 백오프로 대체한다). 상한은 설계서의 백오프 최댓값(30분 — §9.5)과 같다.
 */
const MAX_RETRY_AFTER_MS = 30 * 60 * 1000;

export function parseRetryAfterMs(value: string | undefined | null, now: Date): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    const seconds = Number(trimmed);
    if (!Number.isFinite(seconds) || seconds <= 0) return null;
    return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
  }
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) return null;
  const ms = date.getTime() - now.getTime();
  if (ms <= 0) return null;
  return Math.min(ms, MAX_RETRY_AFTER_MS);
}
