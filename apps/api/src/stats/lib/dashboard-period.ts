import { KstDateOnly, MS_PER_DAY, kstDateOnlyToUtc, toKstDateOnly } from './kst-date';

const MAX_PERIOD_DAYS = 366;

export interface ResolvedPeriod {
  periodStart: Date;
  periodEnd: Date;
}

/** 기간 입력이 역전되었거나 366일을 초과할 때 던지는 순수 오류(서비스가 400으로 변환). */
export class InvalidPeriodError extends Error {}

/**
 * 대시보드 기간 경계 계산(FR-2-7, AC-2-7, AC-2-8, 설계서 §7.6).
 * `Asia/Seoul` 기준 `from` 00:00:00.000 ~ `to` 23:59:59.999(포함)로 해석해 UTC로 변환한다.
 * `to` 미지정 시 오늘(KST), `from` 미지정 시 `to`로부터 최근 7일(오늘 포함).
 * 순수 함수 — `now`를 인자로 받아 DB·Nest 무의존(NFR-M3).
 */
export function resolveDashboardPeriod(from: Date | undefined, to: Date | undefined, now: Date): ResolvedPeriod {
  const toKst = to ? toKstDateOnly(to) : toKstDateOnly(now);

  let fromKst: KstDateOnly;
  if (from) {
    fromKst = toKstDateOnly(from);
  } else {
    const toMidnightUtc = kstDateOnlyToUtc(toKst, 0, 0, 0, 0);
    fromKst = toKstDateOnly(new Date(toMidnightUtc.getTime() - 6 * MS_PER_DAY));
  }

  const fromMidnightUtcMs = Date.UTC(fromKst.y, fromKst.m, fromKst.d);
  const toMidnightUtcMs = Date.UTC(toKst.y, toKst.m, toKst.d);

  if (fromMidnightUtcMs > toMidnightUtcMs) {
    throw new InvalidPeriodError('조회 시작일이 종료일보다 늦을 수 없습니다.');
  }

  const inclusiveDays = Math.round((toMidnightUtcMs - fromMidnightUtcMs) / MS_PER_DAY) + 1;
  if (inclusiveDays > MAX_PERIOD_DAYS) {
    throw new InvalidPeriodError('조회 기간은 최대 366일까지 지정할 수 있습니다.');
  }

  return {
    periodStart: kstDateOnlyToUtc(fromKst, 0, 0, 0, 0),
    periodEnd: kstDateOnlyToUtc(toKst, 23, 59, 59, 999),
  };
}
