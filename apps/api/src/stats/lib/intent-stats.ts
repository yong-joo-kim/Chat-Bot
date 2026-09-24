import { computeResponseRates } from './dashboard-aggregator';

/**
 * No.29 챗봇 스코프 의도별 매칭 통계(J-13, P-6, `integrated-stats-설계.md` §6). DB·Nest 무의존 순수 함수.
 */
export interface IntentCountRow {
  matchedIntentId: string | null;
  isAnswered: boolean;
  count: number;
}

export interface IntentNameLookup {
  id: string;
  name: string;
}

export interface IntentStatsItemResult {
  intentId: string;
  name: string | null;
  deleted: boolean;
  turnCount: number;
  answeredCount: number;
  responseRate: number;
  shareOfAll: number;
  shareOfIntentMatched: number;
}

export interface FoldedIntentStats {
  totalTurnCount: number;
  matchedTurnCount: number;
  unmatchedTurnCount: number;
  othersTurnCount: number;
  distinctIntentCount: number;
  items: IntentStatsItemResult[];
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

/** 의도별 폴딩 · 삭제 의도 표시 · 두 분모 비율. 정렬 `turnCount desc → intentId asc`, 상위 `topN`. */
export function foldIntentStats(rows: IntentCountRow[], names: IntentNameLookup[], topN: number): FoldedIntentStats {
  const nameById = new Map(names.map((n) => [n.id, n.name]));
  const perIntent = new Map<string, { turnCount: number; answeredCount: number }>();
  let totalTurnCount = 0;
  let unmatchedTurnCount = 0;

  for (const row of rows) {
    totalTurnCount += row.count;
    if (row.matchedIntentId === null) {
      unmatchedTurnCount += row.count;
      continue;
    }
    const entry = perIntent.get(row.matchedIntentId) ?? { turnCount: 0, answeredCount: 0 };
    entry.turnCount += row.count;
    if (row.isAnswered) entry.answeredCount += row.count;
    perIntent.set(row.matchedIntentId, entry);
  }

  const matchedTurnCount = totalTurnCount - unmatchedTurnCount;
  const sorted = Array.from(perIntent.entries())
    .map(([intentId, v]) => ({ intentId, ...v }))
    .sort((a, b) => (b.turnCount !== a.turnCount ? b.turnCount - a.turnCount : a.intentId.localeCompare(b.intentId)));

  const top = sorted.slice(0, topN);
  const rest = sorted.slice(topN);
  const othersTurnCount = rest.reduce((sum, r) => sum + r.turnCount, 0);

  const items: IntentStatsItemResult[] = top.map((entry) => {
    const name = nameById.get(entry.intentId) ?? null;
    const { responseRate } = computeResponseRates({ answeredCount: entry.answeredCount, totalCount: entry.turnCount });
    return {
      intentId: entry.intentId,
      name,
      deleted: name === null,
      turnCount: entry.turnCount,
      answeredCount: entry.answeredCount,
      responseRate,
      shareOfAll: totalTurnCount === 0 ? 0 : round4(entry.turnCount / totalTurnCount),
      shareOfIntentMatched: matchedTurnCount === 0 ? 0 : round4(entry.turnCount / matchedTurnCount),
    };
  });

  return { totalTurnCount, matchedTurnCount, unmatchedTurnCount, othersTurnCount, distinctIntentCount: perIntent.size, items };
}
