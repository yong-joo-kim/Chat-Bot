import { toKstDayBucket, toKstHourOfDay, toKstWeekday } from '@chat-bot/shared-types';

describe('toKstDayBucket / toKstHourOfDay (FR-0-31, ADR-0017, AC-14A-4)', () => {
  it('places 2026-09-21 23:50 KST and 2026-09-22 00:10 KST in different day buckets', () => {
    // 2026-09-21 23:50 KST = 2026-09-21 14:50 UTC
    const before = new Date('2026-09-21T14:50:00.000Z');
    // 2026-09-22 00:10 KST = 2026-09-21 15:10 UTC
    const after = new Date('2026-09-21T15:10:00.000Z');

    expect(toKstDayBucket(before)).toBe('2026-09-21');
    expect(toKstDayBucket(after)).toBe('2026-09-22');
  });

  it('computes the KST hour-of-day (0~23)', () => {
    // 2026-09-22 09:00 KST = 2026-09-22 00:00 UTC
    expect(toKstHourOfDay(new Date('2026-09-22T00:00:00.000Z'))).toBe(9);
    // 2026-09-22 00:00 KST = 2026-09-21 15:00 UTC
    expect(toKstHourOfDay(new Date('2026-09-21T15:00:00.000Z'))).toBe(0);
  });
});

describe('toKstWeekday (FR-14-29, 0=월~6=일)', () => {
  it('resolves Monday(2026-09-21) to 0 and Sunday(2026-09-27) to 6', () => {
    expect(toKstWeekday('2026-09-21')).toBe(0);
    expect(toKstWeekday('2026-09-27')).toBe(6);
  });

  it('resolves Tuesday(2026-09-22) to 1', () => {
    expect(toKstWeekday('2026-09-22')).toBe(1);
  });
});
