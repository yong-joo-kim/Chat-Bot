import type { ResponseSource } from '@chat-bot/shared-types';
import type { BucketKey } from './bucket';
import { classifyResponseSource } from './response-source';
import { computeResponseRates } from './dashboard-aggregator';

/**
 * No.14 요약/분포의 조립 로직을 순수 함수로 추출한 것(FR-0-89, `integrated-stats-설계.md` §5.2).
 * `stats.service.ts:185-216`(버킷 루프+총계)·`:229`(turnsPerSession)·`:287-312`(출처/채널 비율)에서
 * 이동 — 계산식은 한 곳(여기)뿐이며 챗봇 스코프(`StatsService`)와 통합 스코프(`IntegratedStatsService`)가
 * 함께 호출한다. DB·Nest 무의존 순수 함수.
 */

export interface DayCountRow {
  dayBucket: string;
  isAnswered: boolean;
  blockedByFilter: boolean;
  count: number;
}

export interface AssembledBucket {
  key: string;
  label: string;
  start: Date;
  end: Date;
  turnCount: number;
  answeredCount: number;
  unansweredCount: number;
  blockedCount: number;
  responseRate: number;
  sessionCount: number;
}

export interface AssembledSummaryTotals {
  turnCount: number;
  answeredCount: number;
  unansweredCount: number;
  blockedCount: number;
  responseRate: number;
  noResponseRate: number;
}

export interface AssembledSummary {
  bucketResults: AssembledBucket[];
  totals: AssembledSummaryTotals;
}

/** 버킷별 턴/응답/차단 집계 + 총계 조립. */
export function assembleSummaryBuckets(
  buckets: BucketKey[],
  foldedDayRows: Map<string, DayCountRow[]>,
  sessionCountsByBucket: Map<string, number>,
): AssembledSummary {
  let totalTurn = 0;
  let totalAnswered = 0;
  let totalUnanswered = 0;
  let totalBlocked = 0;

  const bucketResults = buckets.map((bucket) => {
    const rows = foldedDayRows.get(bucket.key) ?? [];
    let turnCount = 0;
    let answeredCount = 0;
    let blockedCount = 0;
    for (const row of rows) {
      turnCount += row.count;
      if (row.isAnswered) answeredCount += row.count;
      if (row.blockedByFilter) blockedCount += row.count;
    }
    const unansweredCount = turnCount - answeredCount;
    totalTurn += turnCount;
    totalAnswered += answeredCount;
    totalUnanswered += unansweredCount;
    totalBlocked += blockedCount;
    const { responseRate } = computeResponseRates({ answeredCount, totalCount: turnCount });

    return {
      key: bucket.key,
      label: bucket.label,
      start: bucket.start,
      end: bucket.end,
      turnCount,
      answeredCount,
      unansweredCount,
      blockedCount,
      responseRate,
      sessionCount: sessionCountsByBucket.get(bucket.key) ?? 0,
    };
  });

  const { responseRate, noResponseRate } = computeResponseRates({ answeredCount: totalAnswered, totalCount: totalTurn });

  return {
    bucketResults,
    totals: {
      turnCount: totalTurn,
      answeredCount: totalAnswered,
      unansweredCount: totalUnanswered,
      blockedCount: totalBlocked,
      responseRate,
      noResponseRate,
    },
  };
}

/** 세션당 평균 턴 수, 소수 첫째 자리(FR-14-14). 세션 0건이면 0(NaN 금지). */
export function computeTurnsPerSession(turnCount: number, visitCount: number): number {
  return visitCount === 0 ? 0 : Math.round((turnCount / visitCount) * 10) / 10;
}

export interface SourceCountRow {
  matchedNodeId: string | null;
  matchedFaqId: string | null;
  isAnswered: boolean;
  answeredByRag: boolean;
  count: number;
}

/** 응답 출처 비율 조립(FR-14-20). */
export function assembleBySource(rows: SourceCountRow[]): Array<{ source: ResponseSource; count: number; ratio: number }> {
  const sourceCounts = new Map<string, number>();
  let sourceTotal = 0;
  for (const row of rows) {
    const source = classifyResponseSource({
      matchedNodeId: row.matchedNodeId,
      matchedFaqId: row.matchedFaqId,
      isAnswered: row.isAnswered,
      answeredByRag: row.answeredByRag,
    });
    sourceCounts.set(source, (sourceCounts.get(source) ?? 0) + row.count);
    sourceTotal += row.count;
  }
  return (['NODE', 'FAQ', 'RAG', 'OTHER', 'FALLBACK'] as const).map((source) => {
    const count = sourceCounts.get(source) ?? 0;
    return { source, count, ratio: sourceTotal === 0 ? 0 : Math.round((count / sourceTotal) * 10000) / 10000 };
  });
}

/** 채널별 세션 비율 조립(FR-14-15). */
export function assembleByChannel(sessionCountsByChannel: Map<string, number>): Array<{ channelType: string; sessionCount: number; ratio: number }> {
  const channelTotal = Array.from(sessionCountsByChannel.values()).reduce((sum, v) => sum + v, 0);
  return Array.from(sessionCountsByChannel.entries()).map(([channelType, sessionCount]) => ({
    channelType,
    sessionCount,
    ratio: channelTotal === 0 ? 0 : Math.round((sessionCount / channelTotal) * 10000) / 10000,
  }));
}
