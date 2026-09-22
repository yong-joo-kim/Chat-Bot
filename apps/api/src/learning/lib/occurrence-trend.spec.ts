import { foldTrend, trendStartDayBucket } from './occurrence-trend';

const NOW = new Date('2026-09-22T03:00:00.000Z'); // 2026-09-22 12:00 KST

describe('foldTrend (FR-15-13, DD-67)', () => {
  it('returns `days` entries ending at today, zero-filled for missing days', () => {
    const result = foldTrend([{ dayBucket: '2026-09-20', count: 3 }], 5, NOW);
    expect(result.map((r) => r.dayBucket)).toEqual(['2026-09-18', '2026-09-19', '2026-09-20', '2026-09-21', '2026-09-22']);
    expect(result.find((r) => r.dayBucket === '2026-09-20')?.count).toBe(3);
    expect(result.find((r) => r.dayBucket === '2026-09-22')?.count).toBe(0);
  });

  it('sums duplicate dayBucket rows (variants folding to the same day)', () => {
    const result = foldTrend(
      [
        { dayBucket: '2026-09-22', count: 2 },
        { dayBucket: '2026-09-22', count: 1 },
      ],
      1,
      NOW,
    );
    expect(result).toEqual([{ dayBucket: '2026-09-22', count: 3 }]);
  });
});

describe('trendStartDayBucket', () => {
  it('returns the first day of the N-day window ending today', () => {
    expect(trendStartDayBucket(14, NOW)).toBe('2026-09-09');
  });
});
