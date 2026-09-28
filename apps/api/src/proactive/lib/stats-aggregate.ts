/**
 * [신규 No.35] 선제 안내 통계 합계·비율(분자 ≤ 분모 상한)·"자주 닫힘" 판정. 순수 — DB·Nest 무의존.
 */

export interface ProactiveDailyStatRow {
  ruleId: string;
  ruleName: string;
  dayBucket: string;
  shown: number;
  clicked: number;
  dismissed: number;
  optedOut: number;
}

export interface ProactiveRuleTotal {
  ruleId: string;
  name: string;
  deleted: boolean;
  shown: number;
  clicked: number;
  dismissed: number;
  optedOut: number;
  clickRate: number | null;
  dismissRate: number | null;
  optOutRate: number | null;
  frequentlyDismissed: boolean;
}

export interface ProactiveDailyPoint {
  day: string;
  ruleId: string;
  shown: number;
  clicked: number;
  dismissed: number;
  optedOut: number;
}

export interface FrequentDismissThreshold {
  ratio: number;
  minShown: number;
}

/** `SHOWN` 없이 온 `CLICKED`/`DISMISSED`/`OPTED_OUT`이 분모를 넘지 않게 `min(1, 분자/표시)`로 상한한다
 * (FR-PA5-6). 표시 0이면 `null`. */
function rate(numerator: number, shown: number): number | null {
  if (shown <= 0) return null;
  return Math.min(1, numerator / shown);
}

export function isFrequentlyDismissed(shown: number, dismissed: number, optedOut: number, threshold: FrequentDismissThreshold): boolean {
  if (shown < threshold.minShown) return false;
  return (dismissed + optedOut) / shown >= threshold.ratio;
}

export function aggregateProactiveStats(
  rows: readonly ProactiveDailyStatRow[],
  existingRuleIds: ReadonlySet<string>,
  threshold: FrequentDismissThreshold,
): { totals: ProactiveRuleTotal[]; daily: ProactiveDailyPoint[] } {
  const byRule = new Map<string, { name: string; shown: number; clicked: number; dismissed: number; optedOut: number }>();

  for (const row of rows) {
    const acc = byRule.get(row.ruleId) ?? { name: row.ruleName, shown: 0, clicked: 0, dismissed: 0, optedOut: 0 };
    acc.name = row.ruleName; // 마지막 증가 시점 스냅샷(최신값으로 갱신)
    acc.shown += row.shown;
    acc.clicked += row.clicked;
    acc.dismissed += row.dismissed;
    acc.optedOut += row.optedOut;
    byRule.set(row.ruleId, acc);
  }

  const totals: ProactiveRuleTotal[] = [...byRule.entries()]
    .map(([ruleId, acc]) => ({
      ruleId,
      name: acc.name,
      deleted: !existingRuleIds.has(ruleId),
      shown: acc.shown,
      clicked: acc.clicked,
      dismissed: acc.dismissed,
      optedOut: acc.optedOut,
      clickRate: rate(acc.clicked, acc.shown),
      dismissRate: rate(acc.dismissed, acc.shown),
      optOutRate: rate(acc.optedOut, acc.shown),
      frequentlyDismissed: isFrequentlyDismissed(acc.shown, acc.dismissed, acc.optedOut, threshold),
    }))
    .sort((a, b) => a.ruleId.localeCompare(b.ruleId));

  const daily: ProactiveDailyPoint[] = rows
    .map((r) => ({ day: r.dayBucket, ruleId: r.ruleId, shown: r.shown, clicked: r.clicked, dismissed: r.dismissed, optedOut: r.optedOut }))
    .sort((a, b) => (a.day === b.day ? a.ruleId.localeCompare(b.ruleId) : a.day.localeCompare(b.day)));

  return { totals, daily };
}
