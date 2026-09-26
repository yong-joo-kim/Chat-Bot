/** [신규 No.41] 선점 계획(§7.2 step④) — 순수. DB 조회 결과를 받아 각 후보의 처리를 결정한다. */

export interface ClaimCandidate {
  id: string;
  targetId: string;
}

export interface TargetState {
  enabled: boolean;
  paused: boolean;
  /** 이미 `SENDING`인 이 대상의 행 수(이번 tick 시작 시점). */
  sendingCount: number;
  /** 최근 60초 시도 수(근사, K-3). */
  recentAttempts: number;
}

export type ClaimAction = 'CLAIM' | 'HELD' | 'SKIPPED' | 'DEFER';

export interface ClaimPlanOptions {
  batch: number;
  targetConcurrentSending: number;
  targetRatePerMin: number;
  instanceConcurrentSends: number;
}

/**
 * 대상 정지 → `HELD` · 대상 없음/꺼짐 → `SKIPPED` · 대상 동시 상한·분당 상한·인스턴스 동시 상한·
 * 배치 상한 초과분 → `DEFER`(다음 tick — 실패 아님) · 그 외 → `CLAIM`.
 */
export function planClaims(candidates: readonly ClaimCandidate[], targets: ReadonlyMap<string, TargetState>, opts: ClaimPlanOptions): Map<string, ClaimAction> {
  const plan = new Map<string, ClaimAction>();
  const claimedThisTickByTarget = new Map<string, number>();
  let claimedTotal = 0;

  for (const c of candidates) {
    if (claimedTotal >= opts.batch || claimedTotal >= opts.instanceConcurrentSends) {
      plan.set(c.id, 'DEFER');
      continue;
    }
    const target = targets.get(c.targetId);
    if (!target || !target.enabled) {
      plan.set(c.id, 'SKIPPED');
      continue;
    }
    if (target.paused) {
      plan.set(c.id, 'HELD');
      continue;
    }
    const alreadyClaimed = claimedThisTickByTarget.get(c.targetId) ?? 0;
    if (target.sendingCount + alreadyClaimed >= opts.targetConcurrentSending) {
      plan.set(c.id, 'DEFER');
      continue;
    }
    if (target.recentAttempts + alreadyClaimed >= opts.targetRatePerMin) {
      plan.set(c.id, 'DEFER');
      continue;
    }
    plan.set(c.id, 'CLAIM');
    claimedTotal += 1;
    claimedThisTickByTarget.set(c.targetId, alreadyClaimed + 1);
  }

  return plan;
}
