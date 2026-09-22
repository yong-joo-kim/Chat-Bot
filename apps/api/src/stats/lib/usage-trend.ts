import type { StatsGranularity } from '@chat-bot/shared-types';
import { toKstWeekday } from '@chat-bot/shared-types';
import { dayBucketToBucketKey } from './bucket';

/**
 * No.14 이용동향(시간대·요일 분포) + 세션 distinct 폴딩(FR-14-13/15/28/29, DD-59/60/61).
 * DB·Nest 무의존 순수 함수 — 단위 테스트 1차 대상(NFR-M1). 세션 distinct는 신규 원시 SQL
 * 없이 `groupBy(['dayBucket','channelType','sessionId'])` 1회 결과에서 앱이 파생한다(DD-60).
 */

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

export interface HourCountRow {
  hour: number;
  count: number;
}

/** `groupBy(['hourBucket'])` 결과 → 항상 24개(0~23시, FR-14-28). 데이터 없는 시간대도 0. */
export function foldByHour(rows: HourCountRow[]): Array<{ hour: number; turnCount: number }> {
  const counts = new Array(24).fill(0) as number[];
  for (const row of rows) {
    if (row.hour >= 0 && row.hour <= 23) counts[row.hour] += row.count;
  }
  return counts.map((turnCount, hour) => ({ hour, turnCount }));
}

export interface WeekdayRow {
  dayBucket: string;
  isAnswered: boolean;
  count: number;
}

/** `groupBy(['dayBucket','isAnswered'])` 결과 → 항상 7개(0=월~6=일, FR-14-29). `dayBucket`에서 요일을 파생한다. */
export function foldByWeekday(rows: WeekdayRow[]): Array<{ weekday: number; turnCount: number; responseRate: number }> {
  const turn = new Array(7).fill(0) as number[];
  const answered = new Array(7).fill(0) as number[];
  for (const row of rows) {
    const weekday = toKstWeekday(row.dayBucket);
    turn[weekday] += row.count;
    if (row.isAnswered) answered[weekday] += row.count;
  }
  return turn.map((turnCount, weekday) => ({
    weekday,
    turnCount,
    responseRate: turnCount === 0 ? 0 : round4(answered[weekday] / turnCount),
  }));
}

export interface SessionGroupRow {
  dayBucket: string;
  channelType: string;
  sessionId: string | null;
  count: number;
}

/**
 * `sessionId` distinct 집계를 그룹 키(버킷/채널)별로 파생한다(DD-60, J-8).
 * `sessionId === null` 행은 각 1건으로 센다(ADR-0001의 `computeVisitCount` 규칙과 동일).
 */
function foldSessionCounts<K extends string>(rows: SessionGroupRow[], keyOf: (row: SessionGroupRow) => K): Map<K, number> {
  const nonNullSessions = new Map<K, Set<string>>();
  const nullCounts = new Map<K, number>();
  for (const row of rows) {
    const key = keyOf(row);
    if (row.sessionId != null) {
      let set = nonNullSessions.get(key);
      if (!set) {
        set = new Set();
        nonNullSessions.set(key, set);
      }
      set.add(row.sessionId);
    } else {
      nullCounts.set(key, (nullCounts.get(key) ?? 0) + row.count);
    }
  }
  const result = new Map<K, number>();
  const keys = new Set<K>([...nonNullSessions.keys(), ...nullCounts.keys()]);
  for (const key of keys) {
    result.set(key, (nonNullSessions.get(key)?.size ?? 0) + (nullCounts.get(key) ?? 0));
  }
  return result;
}

/** 버킷별(주/월은 일 버킷들의 합집합 재계산, DD-61 — 합이 아니다) 세션 수. */
export function foldSessionCountsByBucket(rows: SessionGroupRow[], granularity: StatsGranularity): Map<string, number> {
  return foldSessionCounts(rows, (row) => dayBucketToBucketKey(row.dayBucket, granularity));
}

/** 채널별 세션 수(FR-14-15). */
export function foldSessionCountsByChannel(rows: SessionGroupRow[]): Map<string, number> {
  return foldSessionCounts(rows, (row) => row.channelType);
}
