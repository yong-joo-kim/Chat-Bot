/** [신규 No.40] §9.3 — 순수 함수. DB·Nest 무의존. */

export interface ProdHistoryEntry {
  toVersionId: string | null;
  fromVersionId: string | null;
}

/** 대상 ∈ {현재 스테이징} ∪ {운영 이력 버전 전부}. 롤백은 이력 버전만(스테이징도 이력에 있으면 허용). */
export function isSwitchTargetAllowed(input: {
  target: string;
  staging: string | null;
  prodHistoryIds: ReadonlySet<string>;
  kind: 'SWITCH' | 'ROLLBACK';
}): boolean {
  if (input.kind === 'ROLLBACK') return input.prodHistoryIds.has(input.target);
  return input.target === input.staging || input.prodHistoryIds.has(input.target);
}

/**
 * 가장 최근 `PROD` 이력 중 `toVersionId = currentProd`인 행의 `fromVersionId`. 없거나 그 버전이
 * 사라졌으면(호출자가 `existingVersionIds`로 검증) `currentProd`가 아닌 가장 최근 `toVersionId`.
 * `historyDesc`는 `createdAt desc`(최신 먼저)로 정렬된 PROD 이력.
 */
export function pickRollbackTarget(historyDesc: readonly ProdHistoryEntry[], currentProd: string, existingVersionIds: ReadonlySet<string>): string | null {
  const lastSwitchToCurrentProd = historyDesc.find((h) => h.toVersionId === currentProd);
  if (lastSwitchToCurrentProd?.fromVersionId && existingVersionIds.has(lastSwitchToCurrentProd.fromVersionId)) {
    return lastSwitchToCurrentProd.fromVersionId;
  }
  const fallback = historyDesc.find((h) => h.toVersionId && h.toVersionId !== currentProd && existingVersionIds.has(h.toVersionId));
  return fallback?.toVersionId ?? null;
}

/** 대상이 현재 운영과 같으면 NOOP(쓰기·이력·감사 0, EX-EN-16). */
export function classifySwitch(target: string, currentProd: string): 'NOOP' | 'SWITCHABLE' {
  return target === currentProd ? 'NOOP' : 'SWITCHABLE';
}
