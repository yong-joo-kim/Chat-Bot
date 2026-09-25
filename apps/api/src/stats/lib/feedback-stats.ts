import type { FeedbackStatsBucket, FeedbackTargetKind } from '@chat-bot/shared-types';
import { buildBuckets } from './bucket';

export interface FeedbackStatsFoldInput {
  fromDayBucket: string;
  toDayBucket: string;
  ratingByDay: Array<{ turnDayBucket: string; rating: string; count: number }>;
  offeredByDay: Array<{ dayBucket: string; count: number }>;
  targetRatingRows: Array<{ targetKind: string; targetId: string | null; rating: string; count: number }>;
  topN: number;
  lowSampleThreshold: number;
}

export interface FeedbackStatsTotals {
  upCount: number;
  downCount: number;
  ratedCount: number;
  offeredCount: number;
  positiveRate: number | null;
  participationRate: number | null;
  lowSample: boolean;
}

export interface FeedbackStatsTopTargetRaw {
  kind: FeedbackTargetKind;
  targetId?: string;
  downCount: number;
  upCount: number;
}

export interface FoldedFeedbackStats {
  totals: FeedbackStatsTotals;
  buckets: FeedbackStatsBucket[];
  topNegativeTargetsRaw: FeedbackStatsTopTargetRaw[];
}

function rate(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

/**
 * 만족도 지표 순수 조립(FR-FB8-\*, ADR-0038 §7) — DB·Nest 무의존(NFR-FBM1). 이름 해석(대상 존재
 * 확인)은 서비스 계층이 이 함수의 결과(topN raw)만 가지고 최소 조회로 수행한다.
 */
export function foldFeedbackStats(input: FeedbackStatsFoldInput): FoldedFeedbackStats {
  const bucketKeys = buildBuckets(input.fromDayBucket, input.toDayBucket, 'DAY');

  const upByDay = new Map<string, number>();
  const downByDay = new Map<string, number>();
  let upCount = 0;
  let downCount = 0;
  for (const row of input.ratingByDay) {
    if (row.rating === 'UP') {
      upByDay.set(row.turnDayBucket, (upByDay.get(row.turnDayBucket) ?? 0) + row.count);
      upCount += row.count;
    } else if (row.rating === 'DOWN') {
      downByDay.set(row.turnDayBucket, (downByDay.get(row.turnDayBucket) ?? 0) + row.count);
      downCount += row.count;
    }
  }

  const offeredByDay = new Map<string, number>();
  let offeredCount = 0;
  for (const row of input.offeredByDay) {
    offeredByDay.set(row.dayBucket, (offeredByDay.get(row.dayBucket) ?? 0) + row.count);
    offeredCount += row.count;
  }

  const buckets: FeedbackStatsBucket[] = bucketKeys.map((b) => {
    const up = upByDay.get(b.key) ?? 0;
    const down = downByDay.get(b.key) ?? 0;
    return {
      dayBucket: b.key,
      upCount: up,
      downCount: down,
      offeredCount: offeredByDay.get(b.key) ?? 0,
      positiveRate: rate(up, up + down),
    };
  });

  const ratedCount = upCount + downCount;
  const totals: FeedbackStatsTotals = {
    upCount,
    downCount,
    ratedCount,
    offeredCount,
    positiveRate: rate(upCount, ratedCount),
    participationRate: rate(ratedCount, offeredCount),
    lowSample: ratedCount < input.lowSampleThreshold,
  };

  // 👎 상위 대상 — (kind, targetId)별 집계 → 👎 desc, 👍 asc, kind, targetId 순 정렬(결정적).
  const byTarget = new Map<string, FeedbackStatsTopTargetRaw>();
  for (const row of input.targetRatingRows) {
    const kind = row.targetKind as FeedbackTargetKind;
    const targetId = row.targetId ?? undefined;
    const key = `${kind}:${targetId ?? ''}`;
    const existing = byTarget.get(key) ?? { kind, targetId, downCount: 0, upCount: 0 };
    if (row.rating === 'DOWN') existing.downCount += row.count;
    else if (row.rating === 'UP') existing.upCount += row.count;
    byTarget.set(key, existing);
  }
  const topNegativeTargetsRaw = Array.from(byTarget.values())
    .sort((a, b) => {
      if (b.downCount !== a.downCount) return b.downCount - a.downCount;
      if (a.upCount !== b.upCount) return a.upCount - b.upCount;
      if (a.kind !== b.kind) return a.kind.localeCompare(b.kind);
      return (a.targetId ?? '').localeCompare(b.targetId ?? '');
    })
    .slice(0, input.topN);

  return { totals, buckets, topNegativeTargetsRaw };
}
