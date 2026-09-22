/**
 * 세션 수명주기 순수 함수(NFR-M1, ADR-0014 §7.3). DB·Nest 무의존.
 */

export function computeInitialExpiry(
  now: Date,
  idleTimeoutMin: number,
  absoluteTimeoutHours: number,
): { expiresAt: Date; absoluteExpiresAt: Date } {
  return {
    expiresAt: new Date(now.getTime() + idleTimeoutMin * 60_000),
    absoluteExpiresAt: new Date(now.getTime() + absoluteTimeoutHours * 3_600_000),
  };
}

export interface SessionValidityInput {
  createdAt: Date;
  expiresAt: Date;
  absoluteExpiresAt: Date;
  revokedAt: Date | null;
}

/** 유효 세션 판정(AC-12A-6/7/8) — 무효화·유휴 만료·절대 만료·시계 역행(EX-12-10)을 검사한다. */
export function isSessionValid(session: SessionValidityInput, now: Date): boolean {
  if (session.revokedAt) return false;
  if (session.createdAt.getTime() > now.getTime()) return false;
  if (now.getTime() >= session.expiresAt.getTime()) return false;
  if (now.getTime() >= session.absoluteExpiresAt.getTime()) return false;
  return true;
}

/** 슬라이딩 갱신 — 절대 만료를 넘지 않는다(AC-12A-7). */
export function nextSlidingExpiry(now: Date, idleTimeoutMin: number, absoluteExpiresAt: Date): Date {
  const candidateMs = now.getTime() + idleTimeoutMin * 60_000;
  return new Date(Math.min(candidateMs, absoluteExpiresAt.getTime()));
}

/** 쓰기 증폭 방지 — 마지막 갱신 후 `idle/10`(기본 12분) 경과 시에만 갱신한다(§7.3). */
export function shouldRefresh(lastSeenAt: Date, now: Date, idleTimeoutMin: number): boolean {
  const refreshIntervalMs = (idleTimeoutMin * 60_000) / 10;
  return now.getTime() - lastSeenAt.getTime() >= refreshIntervalMs;
}
