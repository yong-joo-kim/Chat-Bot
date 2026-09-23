/**
 * [신규 2026-09-23 No.28] 임대(lease) 판정 순수 함수 — 도메인 무관(NFR-DM3, No.45 재사용 가능).
 * `now`를 인자로 받는다(시계 직접 호출 금지, NFR-DM4).
 */
export function isLeaseExpired(claimedAt: Date, now: Date, leaseMs: number): boolean {
  return now.getTime() - claimedAt.getTime() > leaseMs;
}

export function secondsBetween(from: Date, to: Date): number {
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / 1000));
}
