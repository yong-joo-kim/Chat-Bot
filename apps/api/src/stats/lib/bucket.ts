import type { StatsGranularity } from '@chat-bot/shared-types';
import {
  KstDateOnly,
  addDaysKst,
  addMonthsKst,
  formatDayBucket,
  formatMonthDayLabel,
  isoWeekInfo,
  kstDateOnlyToUtc,
  mondayOf,
  monthIndex,
  parseDayBucket,
} from './kst-date';

/**
 * No.14 버킷 경계·라벨 생성 + 빈 버킷 채우기(FR-14-5/6/9/11, J-3, ADR-0017).
 * DB·Nest 무의존 순수 함수 — 단위 테스트 1차 대상(NFR-M1).
 */

export interface BucketKey {
  key: string;
  label: string;
  start: Date;
  end: Date;
}

function lastDayOfMonthKst(kst: KstDateOnly): KstDateOnly {
  const nextMonthFirst = addMonthsKst(kst, 1); // d=1
  return addDaysKst(nextMonthFirst, -1);
}

function formatShortDate(kst: KstDateOnly): string {
  return `${String(kst.m + 1).padStart(2, '0')}/${String(kst.d).padStart(2, '0')}`;
}

function isoWeekKey(monday: KstDateOnly): string {
  const { isoYear, week } = isoWeekInfo(monday);
  return `${isoYear}-W${String(week).padStart(2, '0')}`;
}

/**
 * `[fromDayBucket, toDayBucket]`(양끝 포함, KST) 구간을 단위별 버킷 배열로 만든다(FR-14-9).
 * 버킷 배열을 먼저 만들고 행을 부어 넣는 구조라 누락 구간이 생길 수 없다(합계 보존, AC-14A-2).
 * - DAY: key='2026-09-22', label='09/22(화)'
 * - WEEK: 월요일 시작(ISO-8601), key='2026-W39', label='2026-W39(09/21~09/27)'
 * - MONTH: KST 달력월, key='2026-09', label='2026-09'
 */
export function buildBuckets(fromDayBucket: string, toDayBucket: string, granularity: StatsGranularity): BucketKey[] {
  const fromKst = parseDayBucket(fromDayBucket);
  const toKst = parseDayBucket(toDayBucket);
  const buckets: BucketKey[] = [];

  if (granularity === 'DAY') {
    let cursor = fromKst;
    while (formatDayBucket(cursor) <= toDayBucket) {
      buckets.push({
        key: formatDayBucket(cursor),
        label: formatMonthDayLabel(cursor),
        start: kstDateOnlyToUtc(cursor, 0, 0, 0, 0),
        end: kstDateOnlyToUtc(cursor, 23, 59, 59, 999),
      });
      cursor = addDaysKst(cursor, 1);
    }
    return buckets;
  }

  if (granularity === 'WEEK') {
    let cursor = mondayOf(fromKst);
    while (formatDayBucket(cursor) <= toDayBucket) {
      const sunday = addDaysKst(cursor, 6);
      const key = isoWeekKey(cursor);
      buckets.push({
        key,
        label: `${key}(${formatShortDate(cursor)}~${formatShortDate(sunday)})`,
        start: kstDateOnlyToUtc(cursor, 0, 0, 0, 0),
        end: kstDateOnlyToUtc(sunday, 23, 59, 59, 999),
      });
      cursor = addDaysKst(cursor, 7);
    }
    return buckets;
  }

  // MONTH
  let cursor: KstDateOnly = { y: fromKst.y, m: fromKst.m, d: 1 };
  const toMonthIdx = monthIndex(toKst);
  while (monthIndex(cursor) <= toMonthIdx) {
    const key = `${cursor.y}-${String(cursor.m + 1).padStart(2, '0')}`;
    buckets.push({
      key,
      label: key,
      start: kstDateOnlyToUtc(cursor, 0, 0, 0, 0),
      end: kstDateOnlyToUtc(lastDayOfMonthKst(cursor), 23, 59, 59, 999),
    });
    cursor = addMonthsKst(cursor, 1);
  }
  return buckets;
}

/** 일 버킷 문자열 → 주/월 버킷 키(폴딩의 단일 규칙). DAY는 항등 함수다. */
export function dayBucketToBucketKey(dayBucket: string, granularity: StatsGranularity): string {
  const kst = parseDayBucket(dayBucket);
  if (granularity === 'DAY') return dayBucket;
  if (granularity === 'WEEK') return isoWeekKey(mondayOf(kst));
  return `${kst.y}-${String(kst.m + 1).padStart(2, '0')}`;
}

/** `dayBucket` 필드를 가진 행들을 버킷 키별로 묶는다. 빈 버킷은 `buildBuckets()`가 보장한다. */
export function foldDayRows<T extends { dayBucket: string }>(rows: T[], granularity: StatsGranularity): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const key = dayBucketToBucketKey(row.dayBucket, granularity);
    const list = map.get(key);
    if (list) list.push(row);
    else map.set(key, [row]);
  }
  return map;
}
