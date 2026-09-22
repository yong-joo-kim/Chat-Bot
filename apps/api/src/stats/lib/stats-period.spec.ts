import { InvalidGranularityError, InvalidPeriodError, StatsRangeTooWideError, parseGranularity, resolveStatsPeriod } from './stats-period';
import type { StatsRangeLimits } from './stats-period';

const LIMITS: StatsRangeLimits = {
  maxRangeDays: 92,
  maxRangeWeeks: 53,
  maxRangeMonths: 24,
  defaultDays: 30,
  defaultWeeks: 12,
  defaultMonths: 12,
};

const NOW = new Date('2026-09-22T03:00:00.000Z'); // 2026-09-22 12:00 KST

describe('parseGranularity (FR-14-4, AC-14A-7)', () => {
  it('defaults to DAY when unspecified', () => {
    expect(parseGranularity(undefined)).toBe('DAY');
  });

  it('accepts DAY/WEEK/MONTH', () => {
    expect(parseGranularity('DAY')).toBe('DAY');
    expect(parseGranularity('WEEK')).toBe('WEEK');
    expect(parseGranularity('MONTH')).toBe('MONTH');
  });

  it('throws InvalidGranularityError for unsupported values', () => {
    expect(() => parseGranularity('YEAR')).toThrow(InvalidGranularityError);
  });
});

describe('resolveStatsPeriod — defaults (FR-14-7, AC-14A-8)', () => {
  it('defaults DAY to the last 30 days inclusive of today', () => {
    const period = resolveStatsPeriod({ granularity: 'DAY', now: NOW, limits: LIMITS });
    expect(period.toDayBucket).toBe('2026-09-22');
    expect(period.fromDayBucket).toBe('2026-08-24'); // 30일 포함(오늘 포함)
  });

  it('defaults WEEK to 12 weeks ending with the current week', () => {
    const period = resolveStatsPeriod({ granularity: 'WEEK', now: NOW, limits: LIMITS });
    expect(period.toDayBucket).toBe('2026-09-22');
    // 현재 주(2026-W39, 09/21 월요일 시작) 기준 11주 전 월요일
    expect(period.fromDayBucket).toBe('2026-07-06');
  });

  it('defaults MONTH to the last 12 calendar months', () => {
    const period = resolveStatsPeriod({ granularity: 'MONTH', now: NOW, limits: LIMITS });
    expect(period.toDayBucket).toBe('2026-09-22');
    expect(period.fromDayBucket).toBe('2025-10-01');
  });
});

describe('resolveStatsPeriod — range validation (FR-14-8, EX-14-4/14-6)', () => {
  it('throws InvalidPeriodError when from > to', () => {
    expect(() =>
      resolveStatsPeriod({
        from: new Date('2026-09-22T00:00:00.000Z'),
        to: new Date('2026-09-01T00:00:00.000Z'),
        granularity: 'DAY',
        now: NOW,
        limits: LIMITS,
      }),
    ).toThrow(InvalidPeriodError);
  });

  it('throws StatsRangeTooWideError when DAY range exceeds maxRangeDays (AC-14A-6)', () => {
    expect(() =>
      resolveStatsPeriod({
        from: new Date('2026-01-01T00:00:00.000Z'),
        to: new Date('2026-09-22T00:00:00.000Z'),
        granularity: 'DAY',
        now: NOW,
        limits: LIMITS,
      }),
    ).toThrow(StatsRangeTooWideError);
  });

  it('clamps future `to` dates to today (EX-14-6)', () => {
    const period = resolveStatsPeriod({
      to: new Date('2099-01-01T00:00:00.000Z'),
      granularity: 'DAY',
      now: NOW,
      limits: LIMITS,
    });
    expect(period.toDayBucket).toBe('2026-09-22');
  });

  it('accepts an explicit period within limits', () => {
    const period = resolveStatsPeriod({
      from: new Date('2026-09-01T00:00:00.000Z'),
      to: new Date('2026-09-10T00:00:00.000Z'),
      granularity: 'DAY',
      now: NOW,
      limits: LIMITS,
    });
    expect(period.fromDayBucket).toBe('2026-09-01');
    expect(period.toDayBucket).toBe('2026-09-10');
  });
});
