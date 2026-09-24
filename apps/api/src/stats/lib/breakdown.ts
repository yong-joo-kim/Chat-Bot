import { computeResponseRates } from './dashboard-aggregator';

/**
 * No.29 기여 표 조립(J-7, FR-I3-5/6, `integrated-stats-설계.md` §5.5). DB·Nest 무의존 순수 함수.
 */

/** 최대 잔여법(Hamilton apportionment). `total=0`이면 전부 0. 결과 합 = `scale` 정확히(AC-I2-6). */
export function allocateShares(counts: number[], scale = 10_000): number[] {
  const total = counts.reduce((sum, c) => sum + c, 0);
  if (total === 0) return counts.map(() => 0);

  const raw = counts.map((c) => (c / total) * scale);
  const floors = raw.map((r) => Math.floor(r));
  const allocated = floors.reduce((sum, f) => sum + f, 0);
  let remaining = scale - allocated;

  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => (b.frac !== a.frac ? b.frac - a.frac : a.i - b.i));

  const result = [...floors];
  for (let k = 0; k < order.length && remaining > 0; k += 1) {
    result[order[k].i] += 1;
    remaining -= 1;
  }
  return result;
}

export interface BreakdownSourceRow<T> {
  id: string;
  name: string;
  turnCount: number;
  answeredCount: number;
  sessionCount: number;
  extra: T;
}

export interface BreakdownRow<T> extends BreakdownSourceRow<T> {
  unansweredCount: number;
  responseRate: number;
  share: number;
}

export interface BreakdownMetrics {
  turnCount: number;
  answeredCount: number;
  unansweredCount: number;
  sessionCount: number;
  responseRate: number;
  share: number;
}

export interface AssembledBreakdown<T> {
  items: BreakdownRow<T>[];
  othersRow: (BreakdownMetrics & { count: number }) | null;
  unassignedRow: BreakdownMetrics | null;
}

function toMetrics(agg: { turnCount: number; answeredCount: number; sessionCount: number }, shareUnits: number): BreakdownMetrics {
  const { responseRate } = computeResponseRates({ answeredCount: agg.answeredCount, totalCount: agg.turnCount });
  return {
    turnCount: agg.turnCount,
    answeredCount: agg.answeredCount,
    unansweredCount: agg.turnCount - agg.answeredCount,
    sessionCount: agg.sessionCount,
    responseRate,
    share: shareUnits / 10_000,
  };
}

/**
 * 정렬(`turnCount desc → name asc → id asc`, 결정론) → 상한 `maxRows` 초과분은 `othersRow`로 합산 →
 * `unassignedRow`(옵션, ALL 스코프의 `groupId=''` 백필 대기분)까지 포함해 `allocateShares`로 비중을
 * 배분한다(합 = 1, AC-I2-7).
 */
export function assembleBreakdown<T>(
  rows: BreakdownSourceRow<T>[],
  opts: { maxRows: number; unassigned?: { turnCount: number; answeredCount: number; sessionCount: number } },
): AssembledBreakdown<T> {
  const sorted = [...rows].sort(
    (a, b) => b.turnCount - a.turnCount || a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
  );
  const head = sorted.slice(0, opts.maxRows);
  const tail = sorted.slice(opts.maxRows);

  const tailAgg = tail.reduce(
    (acc, r) => ({
      turnCount: acc.turnCount + r.turnCount,
      answeredCount: acc.answeredCount + r.answeredCount,
      sessionCount: acc.sessionCount + r.sessionCount,
    }),
    { turnCount: 0, answeredCount: 0, sessionCount: 0 },
  );

  const shareCounts = [
    ...head.map((r) => r.turnCount),
    ...(tail.length > 0 ? [tailAgg.turnCount] : []),
    ...(opts.unassigned ? [opts.unassigned.turnCount] : []),
  ];
  const units = allocateShares(shareCounts);

  let cursor = 0;
  const items: BreakdownRow<T>[] = head.map((r) => {
    const metrics = toMetrics(r, units[cursor]);
    cursor += 1;
    return { ...r, ...metrics };
  });

  let othersRow: (BreakdownMetrics & { count: number }) | null = null;
  if (tail.length > 0) {
    othersRow = { count: tail.length, ...toMetrics(tailAgg, units[cursor]) };
    cursor += 1;
  }

  let unassignedRow: BreakdownMetrics | null = null;
  if (opts.unassigned) {
    unassignedRow = toMetrics(opts.unassigned, units[cursor]);
    cursor += 1;
  }

  return { items, othersRow, unassignedRow };
}
