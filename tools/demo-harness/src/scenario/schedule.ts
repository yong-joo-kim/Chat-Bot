// 시간 관리 계산(설계 §11.2 · AC-DH4-2·4-3의 계산부 · H-T3) — 순수 함수. 늦으면 생략 가능 단계를 구간 생략 순서대로 건너뛰고, 핵심 단계는 절대 생략하지 않는다.

export interface SkipCandidate {
  id: string;
  budgetSec: number;
}

/**
 * 단계 시작 전 지연(lag = 경과 - 이 단계 앞까지 실행한 단계의 예산 누계)을 만회하도록 생략할 단계를 고른다.
 * - `candidates`: 현재 구간의 생략 가능 단계를 **생략 순서대로**(이미 한 것·이미 생략한 것은 뺀다).
 * - `alreadyRecoveredSec`: 앞서 생략해서 이미 만회한 예산 합.
 * 만회량이 lag 이상이 될 때까지 앞에서부터 고른다. lag <= 0이거나 후보가 없으면 빈 배열.
 */
export function selectSkips(lagSec: number, alreadyRecoveredSec: number, candidates: readonly SkipCandidate[]): string[] {
  let need = lagSec - alreadyRecoveredSec;
  const out: string[] = [];
  for (const c of candidates) {
    if (need <= 0) break;
    out.push(c.id);
    need -= c.budgetSec;
  }
  return out;
}

/** 단계가 끝난 뒤 화면을 유지할 시간(ms) — 예산이 남았을 때만(늦으면 즉시 다음 단계). 일시정지 시간은 호출자가 elapsed에서 뺀다. */
export function dwellMs(budgetSec: number, actualMs: number): number {
  return Math.max(0, Math.round(budgetSec * 1000 - actualMs));
}

/** 지연 표식(ui-spec §2.3·§2.4): 통과이면서 실측 > 예산 + max(3초, 예산의 20%)이면 `지연 +m:ss`. 아니면 null. */
export function delayLabel(budgetSec: number, actualSec: number): string | null {
  const over = actualSec - budgetSec;
  if (over <= Math.max(3, budgetSec * 0.2)) return null;
  const s = Math.round(over);
  return `지연 +${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** 시작 시 총 예산에서 남은 시간(초) — 0 이하로 내려가지 않는다(무대는 `예정 시간 초과`로 바꿔 표시). */
export function remainingSec(totalSec: number, elapsedSec: number): number {
  return Math.max(0, totalSec - elapsedSec);
}
