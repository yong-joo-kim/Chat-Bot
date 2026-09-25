import type { ActiveSwitchSibling } from '../executors/deploy-action-executor';

export type SwitchBinding = { base: 'CURRENT' } | { base: 'SCHEDULE'; scheduleId: string; targetVersionId: string };

/**
 * [신규 No.40 — §11.2] 새 `SWITCH_PROD_VERSION` 예약의 체인 기준 — RESTORE_VERSION 체인(`chain-rules.ts`
 * `findPredecessor`)과 같은 규칙: 이 예약보다 이른 활성 전환 예약 중 가장 늦은 것을 기준으로 삼는다.
 * 없으면(또는 그 예약의 대상 버전이 비어 있으면) 현재 운영을 기준으로 삼는다. DB·Nest 무의존 순수 함수.
 */
export function resolveSwitchBinding(siblings: readonly ActiveSwitchSibling[], scheduledAt: Date): SwitchBinding {
  const earlier = siblings.filter((s) => s.scheduledAt.getTime() < scheduledAt.getTime());
  if (earlier.length === 0) return { base: 'CURRENT' };
  const pred = earlier.reduce((latest, s) => (s.scheduledAt.getTime() > latest.scheduledAt.getTime() ? s : latest));
  if (!pred.targetVersionId) return { base: 'CURRENT' };
  return { base: 'SCHEDULE', scheduleId: pred.id, targetVersionId: pred.targetVersionId };
}

/** R2와 같은 규칙 — 복원 체인처럼 전환 체인도 뒤에만 붙는다. */
export function hasLaterActiveSwitch(siblings: readonly { scheduledAt: Date }[], scheduledAt: Date): boolean {
  return siblings.some((s) => s.scheduledAt.getTime() > scheduledAt.getTime());
}
