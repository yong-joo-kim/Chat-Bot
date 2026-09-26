import type { InboxThreadStatus } from '@chat-bot/shared-types';

export interface EffectiveStatusInput {
  status: InboxThreadStatus;
  snoozeUntil: Date | null;
}

export interface EffectiveStatusResult {
  status: InboxThreadStatus;
  snoozeExpired: boolean;
}

/**
 * [신규 No.42] 보류 해제 — 조회 시점 판정(§8.2, 새 루프 0). `PENDING`인데 `snoozeUntil`이 지났으면
 * 조회 결과는 `OPEN`으로 보이고(`snoozeExpired: true`), 확정은 그 스레드의 다음 쓰기가 담당한다.
 */
export function effectiveStatus(row: EffectiveStatusInput, now: Date): EffectiveStatusResult {
  if (row.status === 'PENDING' && row.snoozeUntil && row.snoozeUntil.getTime() <= now.getTime()) {
    return { status: 'OPEN', snoozeExpired: true };
  }
  return { status: row.status, snoozeExpired: false };
}
