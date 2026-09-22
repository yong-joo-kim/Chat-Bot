import { toKstDayBucket } from '@chat-bot/shared-types';

/**
 * 발생 추이 파생(FR-15-13, DD-67) — `variants[]` 기반 `groupBy(dayBucket)` 결과를 최근 N일
 * (오늘 포함, KST)로 0 채움한다. 순수 함수 — `now`를 인자로 받아 DB·Nest 무의존(NFR-M1).
 */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface TrendRow {
  dayBucket: string;
  count: number;
}

export function foldTrend(rows: TrendRow[], days: number, now: Date): Array<{ dayBucket: string; count: number }> {
  const countsByBucket = new Map<string, number>();
  for (const row of rows) {
    countsByBucket.set(row.dayBucket, (countsByBucket.get(row.dayBucket) ?? 0) + row.count);
  }

  const result: Array<{ dayBucket: string; count: number }> = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const bucket = toKstDayBucket(new Date(now.getTime() - i * MS_PER_DAY));
    result.push({ dayBucket: bucket, count: countsByBucket.get(bucket) ?? 0 });
  }
  return result;
}

/** 최근 N일의 시작 `dayBucket`(질의 `gte` 경계). */
export function trendStartDayBucket(days: number, now: Date): string {
  return toKstDayBucket(new Date(now.getTime() - (days - 1) * MS_PER_DAY));
}
