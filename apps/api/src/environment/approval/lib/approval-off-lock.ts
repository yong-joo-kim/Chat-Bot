/**
 * 2인 승인 끄기 잠금 판정(N36-1, ADR-0049 §2) — 단일 원천 순수 함수.
 * `ENV_APPROVAL_OFF_LOCKED`는 3상태(미설정 / true / false)이고 **명시값이 우선**한다.
 * 미설정이면 거버넌스 모드(`DATA_GOVERNANCE_MODE=ON`)일 때 기본 잠금이다. 잠금은 끄기(on → off)만 막는다.
 */
export type ApprovalOffLockedBy = 'SERVER_SETTING' | 'GOVERNANCE_MODE';

export interface ApprovalOffLockResult {
  readonly locked: boolean;
  /** 잠겼을 때만 채운다(잠금 아닌 응답은 키 자체가 없다). */
  readonly by?: ApprovalOffLockedBy;
}

export function resolveApprovalOffLock(explicit: boolean | undefined, governanceMode: 'ON' | 'OFF' | undefined): ApprovalOffLockResult {
  if (explicit === true) return { locked: true, by: 'SERVER_SETTING' };
  if (explicit === false) return { locked: false };
  if (governanceMode === 'ON') return { locked: true, by: 'GOVERNANCE_MODE' };
  return { locked: false };
}
