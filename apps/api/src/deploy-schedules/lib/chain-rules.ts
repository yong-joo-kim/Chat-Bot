import type { DeployScheduleAction } from '@chat-bot/shared-types';

/**
 * [신규 2026-09-23 No.28] 체인 규칙(J-5, §6.2) — DB·Nest·시계 무의존 순수 함수. 호출자(서비스·엔진·
 * repository)가 조회한 행을 넘긴다. 기준 해시 결정(R1) · append-only(R2) · 순서 보존(R3) ·
 * 후속 보류 대상(R6, §7.7) · 공개 중복(R7)을 다룬다.
 */

export interface RestoreScheduleRef {
  id: string;
  scheduledAt: Date;
  targetContentHash: string | null;
}

/** R1 — 새 RESTORE_VERSION 예약의 기준(선행) — 이보다 이른 활성 복원 예약 중 가장 늦은 것. 없으면 null(=현재 상태 기준). */
export function findPredecessor(activeRestores: readonly RestoreScheduleRef[], scheduledAt: Date): RestoreScheduleRef | null {
  const earlier = activeRestores.filter((r) => r.scheduledAt.getTime() < scheduledAt.getTime());
  if (earlier.length === 0) return null;
  return earlier.reduce((latest, r) => (r.scheduledAt.getTime() > latest.scheduledAt.getTime() ? r : latest));
}

/** R2 — 복원 체인은 뒤에만 붙는다. 새 예약보다 "늦은" 활성 복원 예약이 이미 있으면 위반(true). */
export function hasLaterActiveRestore(activeRestores: readonly { scheduledAt: Date }[], scheduledAt: Date): boolean {
  return activeRestores.some((r) => r.scheduledAt.getTime() > scheduledAt.getTime());
}

/**
 * R3 — 시각 수정(PATCH)이 같은 챗봇 활성 예약 전체의 상대 순서를 바꾸지 않는 범위인지 판정한다.
 * `others`는 자기 자신을 제외한 활성 예약(동작 무관) 목록이다.
 */
export function preservesOrder(currentScheduledAt: Date, newScheduledAt: Date, others: readonly { scheduledAt: Date }[]): boolean {
  const beforeOthers = others.filter((o) => o.scheduledAt.getTime() < currentScheduledAt.getTime());
  const afterOthers = others.filter((o) => o.scheduledAt.getTime() > currentScheduledAt.getTime());
  const staysAfterAllBefore = beforeOthers.every((o) => newScheduledAt.getTime() > o.scheduledAt.getTime());
  const staysBeforeAllAfter = afterOthers.every((o) => newScheduledAt.getTime() < o.scheduledAt.getTime());
  return staysAfterAllBefore && staysBeforeAllAfter;
}

export interface PendingScheduleRef {
  id: string;
  action: DeployScheduleAction;
  scheduledAt: Date;
}

/**
 * §7.7 — 후속 보류 대상. `restoreOnly: true`면 R6(취소 트리거 — RESTORE_VERSION만), 기본(false)이면
 * FAILED/MISSED 트리거(동작 무관, 같은 챗봇의 `scheduledAt > trigger`인 PENDING 전부).
 */
export function successorsToHold(pending: readonly PendingScheduleRef[], triggerScheduledAt: Date, opts: { restoreOnly?: boolean } = {}): string[] {
  return pending
    .filter((r) => r.scheduledAt.getTime() > triggerScheduledAt.getTime())
    .filter((r) => !opts.restoreOnly || r.action === 'RESTORE_VERSION')
    .map((r) => r.id);
}

/** R7 — 한 챗봇에 활성 PUBLISH는 1건. */
export function hasActivePublish(activeRows: readonly { action: DeployScheduleAction }[]): boolean {
  return activeRows.some((r) => r.action === 'PUBLISH');
}
