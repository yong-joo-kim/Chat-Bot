import { buildBucketDayRanges, buildBuckets, dayBucketToBucketKey, foldDayRows } from './bucket';

describe('buildBuckets — DAY (FR-14-5/9)', () => {
  it('produces one bucket per day inclusive, zero-filled (AC-14A-1)', () => {
    const buckets = buildBuckets('2026-09-01', '2026-09-05', 'DAY');
    expect(buckets.map((b) => b.key)).toEqual(['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05']);
  });

  it('labels with MM/DD(요일)', () => {
    const buckets = buildBuckets('2026-09-22', '2026-09-22', 'DAY');
    expect(buckets[0].label).toBe('09/22(화)'); // 2026-09-22 is a Tuesday
  });
});

describe('buildBuckets — WEEK (FR-14-5, Monday-start ISO-8601)', () => {
  it('starts the first bucket on the Monday containing fromDayBucket', () => {
    // 2026-09-21(Mon)~09-27(Sun) is ISO week 39
    const buckets = buildBuckets('2026-09-23', '2026-09-23', 'WEEK');
    expect(buckets).toHaveLength(1);
    expect(buckets[0].key).toBe('2026-W39');
    expect(buckets[0].label).toBe('2026-W39(09/21~09/27)');
  });

  it('spans multiple week buckets when the range crosses week boundaries', () => {
    const buckets = buildBuckets('2026-09-21', '2026-09-28', 'WEEK');
    expect(buckets.map((b) => b.key)).toEqual(['2026-W39', '2026-W40']);
  });
});

describe('buildBuckets — MONTH (FR-14-6, KST calendar month)', () => {
  it('produces one bucket per calendar month with YYYY-MM label', () => {
    const buckets = buildBuckets('2026-07-15', '2026-09-01', 'MONTH');
    expect(buckets.map((b) => b.key)).toEqual(['2026-07', '2026-08', '2026-09']);
    expect(buckets.map((b) => b.label)).toEqual(['2026-07', '2026-08', '2026-09']);
  });
});

describe('dayBucketToBucketKey', () => {
  it('is identity for DAY', () => {
    expect(dayBucketToBucketKey('2026-09-22', 'DAY')).toBe('2026-09-22');
  });

  it('folds to the Monday-start ISO week for WEEK', () => {
    expect(dayBucketToBucketKey('2026-09-23', 'WEEK')).toBe('2026-W39');
    expect(dayBucketToBucketKey('2026-09-21', 'WEEK')).toBe('2026-W39');
    expect(dayBucketToBucketKey('2026-09-27', 'WEEK')).toBe('2026-W39');
  });

  it('folds to YYYY-MM for MONTH', () => {
    expect(dayBucketToBucketKey('2026-09-22', 'MONTH')).toBe('2026-09');
  });
});

describe('foldDayRows — no lost/duplicated rows (AC-14A-2 합계 보존 전제)', () => {
  it('groups rows by folded bucket key without loss', () => {
    const rows = [
      { dayBucket: '2026-09-21', count: 3 },
      { dayBucket: '2026-09-22', count: 5 },
      { dayBucket: '2026-09-27', count: 2 },
      { dayBucket: '2026-09-28', count: 4 },
    ];
    const folded = foldDayRows(rows, 'WEEK');
    const week39 = folded.get('2026-W39') ?? [];
    const week40 = folded.get('2026-W40') ?? [];
    expect(week39.reduce((s, r) => s + r.count, 0)).toBe(10);
    expect(week40.reduce((s, r) => s + r.count, 0)).toBe(4);
  });
});

describe('buildBucketDayRanges (No.29 §5.3 — buildBuckets()와 버킷 규칙 1벌)', () => {
  function allDayBuckets(from: string, to: string): string[] {
    const days: string[] = [];
    let cursor = new Date(`${from}T00:00:00.000Z`);
    const end = new Date(`${to}T00:00:00.000Z`);
    while (cursor <= end) {
      days.push(cursor.toISOString().slice(0, 10));
      cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
    }
    return days;
  }

  it('DAY: every range covers exactly one day and matches its own key', () => {
    const ranges = buildBucketDayRanges('2026-09-01', '2026-09-05', 'DAY');
    for (const r of ranges) {
      expect(r.fromDay).toBe(r.key);
      expect(r.toDay).toBe(r.key);
    }
  });

  it('property: every day in [from,to] falls in exactly one range and maps to dayBucketToBucketKey()', () => {
    for (const granularity of ['DAY', 'WEEK', 'MONTH'] as const) {
      const from = '2025-12-15';
      const to = '2026-02-10'; // 연말·월 경계를 포함하는 구간
      const ranges = buildBucketDayRanges(from, to, granularity);
      for (const day of allDayBuckets(from, to)) {
        const expectedKey = dayBucketToBucketKey(day, granularity);
        const matching = ranges.filter((r) => day >= r.fromDay && day <= r.toDay);
        expect(matching).toHaveLength(1);
        expect(matching[0].key).toBe(expectedKey);
      }
    }
  });

  it('handles a partial first/last week correctly (WEEK)', () => {
    const ranges = buildBucketDayRanges('2026-09-23', '2026-09-23', 'WEEK');
    expect(ranges).toHaveLength(1);
    expect(ranges[0]).toEqual({ key: '2026-W39', fromDay: '2026-09-21', toDay: '2026-09-27' });
  });
});
