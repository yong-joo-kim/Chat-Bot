/** [신규 No.41] 세션 상한 판정(§6.6) — 순수. DB 계수는 호출부가 조회한다. */
export function isSessionLimitExceeded(countInWindow: number, limit: number): boolean {
  return countInWindow >= limit;
}
