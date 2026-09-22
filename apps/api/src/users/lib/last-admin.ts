/**
 * 마지막 관리자 보호·자기수정 판정 순수 함수(FR-12-31, FR-12-32, NFR-M1).
 * C-2(설계서 §2.3) — 두 조건이 동시에 성립하면 LAST_ADMIN을 먼저 판정한다.
 */
export interface AdminGuardTarget {
  id: string;
  role: string;
  status: string;
}

export function isSelfModification(actorId: string, targetId: string): boolean {
  return actorId === targetId;
}

/** `activeAdminCount`는 대상 자신을 포함해 현재 ACTIVE인 ADMIN 총원이다. */
export function isLastActiveAdmin(target: AdminGuardTarget, activeAdminCount: number): boolean {
  return target.role === 'ADMIN' && target.status === 'ACTIVE' && activeAdminCount <= 1;
}
