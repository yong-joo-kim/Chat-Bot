/**
 * [신규 2026-09-23 No.28] 임대 만료 RUNNING 행의 실제 상태 판정(§7.8, FR-D3-15) — 순수 함수.
 * DB 조회(백업 흔적·현재 해시·현재 상태)는 호출자(`engine/deploy-schedule.repository.ts`가 실행기의
 * `judgeRecovery`를 통해)가 하고, 이 파일은 그 결과를 받아 판정만 한다. **재실행하지 않는다**
 * (at-most-once) — 판정 결과는 종단 상태로만 쓰인다.
 */

export type RecoveryVerdict = { kind: 'RECOVERED' } | { kind: 'NOOP' } | { kind: 'INTERRUPTED' };

/**
 * `RESTORE_VERSION` — 이 예약이 남긴 `BEFORE_RESTORE` 백업 흔적이 있으면 커밋된 것이다(백업은 복원과
 * 같은 트랜잭션). 흔적이 없으면 현재 해시가 대상과 같은지로 NOOP(우리가 쓰지 않음)을 가른다.
 */
export function judgeRestoreRecovery(backupTraceExists: boolean, currentHashEqualsTarget: boolean): RecoveryVerdict {
  if (backupTraceExists) return { kind: 'RECOVERED' };
  return currentHashEqualsTarget ? { kind: 'NOOP' } : { kind: 'INTERRUPTED' };
}

/** `PUBLISH` — 목표 상태(ACTIVE AND (채널 활성화를 요구하지 않거나 이미 활성)) 도달 여부. */
export function judgePublishRecovery(statusIsActive: boolean, channelRequirementSatisfied: boolean): RecoveryVerdict {
  return statusIsActive && channelRequirementSatisfied ? { kind: 'RECOVERED' } : { kind: 'INTERRUPTED' };
}

/** `SET_WEB_CHANNEL` — 현재 값이 목표 값과 같은가. */
export function judgeSetWebChannelRecovery(currentEnabled: boolean, targetEnabled: boolean): RecoveryVerdict {
  return currentEnabled === targetEnabled ? { kind: 'RECOVERED' } : { kind: 'INTERRUPTED' };
}
