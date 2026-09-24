import { toKstDayBucket } from '@chat-bot/shared-types';
import type { StatsGranularity } from '@chat-bot/shared-types';
import {
  KstDateOnly,
  MS_PER_DAY,
  addDaysKst,
  addMonthsKst,
  kstDateOnlyToUtc,
  mondayOf,
  monthIndex,
  toKstDateOnly,
} from './kst-date';

/**
 * No.14 기간·단위 규약의 단일 소스(FR-14-4~12, J-3, ADR-0017).
 * DB·Nest 무의존 순수 함수 — 단위 테스트 1차 대상(NFR-M1).
 * `dashboard-period.ts`(No.2 대시보드)는 No.29에서 `kst-date.ts` import로 통합되었다(동작 불변) —
 * 이 파일은 그와 별개로 `kst-date.ts`를 직접 재사용한다. 동일성은 AC-14A-9·`kst-date.contract.spec.ts`로
 * 고정한다.
 */

/** `from > to`(기존 코드 `INVALID_PERIOD` 재사용, EX-14-4). */
export class InvalidPeriodError extends Error {}
/** `DAY|WEEK|MONTH` 외의 값(AC-14A-7). */
export class InvalidGranularityError extends Error {}
/** 단위별 기간 상한 초과(FR-14-8). 메시지에 더 큰 단위 조회 대안을 포함한다. */
export class StatsRangeTooWideError extends Error {}

export interface StatsRangeLimits {
  maxRangeDays: number;
  maxRangeWeeks: number;
  maxRangeMonths: number;
  defaultDays: number;
  defaultWeeks: number;
  defaultMonths: number;
}

export interface ResolvedStatsPeriod {
  periodStart: Date;
  periodEnd: Date;
  /** `dayBucket` 범위 조회용(문자열 사전순 = 날짜순, ADR-0017). */
  fromDayBucket: string;
  toDayBucket: string;
}

/** 쿼리의 원시 `granularity` 문자열을 검증한다. 전용 오류코드가 필요해 zod enum을 쓰지 않는다(FR-14-4). */
export function parseGranularity(raw: string | undefined): StatsGranularity {
  if (raw === undefined) return 'DAY';
  if (raw === 'DAY' || raw === 'WEEK' || raw === 'MONTH') return raw;
  throw new InvalidGranularityError(`지원하지 않는 조회 단위입니다: "${raw}". DAY, WEEK, MONTH 중 하나를 사용해 주세요.`);
}

/**
 * 기간 경계 + 상한 검증(FR-14-7/8/10, EX-14-6). `Asia/Seoul` 기준 `from` 00:00:00.000 ~
 * `to` 23:59:59.999(포함)로 해석해 UTC로 변환한다. `now`를 인자로 받아 순수 함수를 유지한다.
 * 미래 날짜 요청은 오늘까지로 보정한다(EX-14-6) — 보정된 `periodEnd`가 그 사실을 드러낸다.
 */
export function resolveStatsPeriod(input: {
  from?: Date;
  to?: Date;
  granularity: StatsGranularity;
  now: Date;
  limits: StatsRangeLimits;
}): ResolvedStatsPeriod {
  const { granularity, now, limits } = input;
  const todayKst = toKstDateOnly(now);

  const rawToKst = input.to ? toKstDateOnly(input.to) : todayKst;
  const todayMs = Date.UTC(todayKst.y, todayKst.m, todayKst.d);
  const rawToMs = Date.UTC(rawToKst.y, rawToKst.m, rawToKst.d);
  const toKst = rawToMs > todayMs ? todayKst : rawToKst;

  let fromKst: KstDateOnly;
  if (input.from) {
    fromKst = toKstDateOnly(input.from);
  } else if (granularity === 'WEEK') {
    const currentWeekMonday = mondayOf(toKst);
    fromKst = addDaysKst(currentWeekMonday, -7 * (limits.defaultWeeks - 1));
  } else if (granularity === 'MONTH') {
    fromKst = addMonthsKst(toKst, -(limits.defaultMonths - 1));
  } else {
    fromKst = addDaysKst(toKst, -(limits.defaultDays - 1));
  }

  const fromMs = Date.UTC(fromKst.y, fromKst.m, fromKst.d);
  const toMs = Date.UTC(toKst.y, toKst.m, toKst.d);
  if (fromMs > toMs) {
    throw new InvalidPeriodError('조회 시작일이 종료일보다 늦을 수 없습니다.');
  }

  const inclusiveDays = Math.round((toMs - fromMs) / MS_PER_DAY) + 1;

  if (granularity === 'DAY' && inclusiveDays > limits.maxRangeDays) {
    throw new StatsRangeTooWideError(
      `일 단위 조회는 최대 ${limits.maxRangeDays}일까지 지정할 수 있습니다. 더 긴 기간은 주 또는 월 단위로 조회해 주세요.`,
    );
  }
  if (granularity === 'WEEK' && inclusiveDays > limits.maxRangeWeeks * 7) {
    throw new StatsRangeTooWideError(
      `주 단위 조회는 최대 ${limits.maxRangeWeeks}주까지 지정할 수 있습니다. 더 긴 기간은 월 단위로 조회해 주세요.`,
    );
  }
  if (granularity === 'MONTH') {
    const months = monthIndex(toKst) - monthIndex(fromKst) + 1;
    if (months > limits.maxRangeMonths) {
      throw new StatsRangeTooWideError(`월 단위 조회는 최대 ${limits.maxRangeMonths}개월까지 지정할 수 있습니다. 조회 기간을 좁혀 주세요.`);
    }
  }

  const periodStart = kstDateOnlyToUtc(fromKst, 0, 0, 0, 0);
  const periodEnd = kstDateOnlyToUtc(toKst, 23, 59, 59, 999);

  return {
    periodStart,
    periodEnd,
    fromDayBucket: toKstDayBucket(periodStart),
    toDayBucket: toKstDayBucket(periodEnd),
  };
}
