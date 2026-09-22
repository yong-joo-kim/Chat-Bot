import { buildBuckets, dayBucketToBucketKey, foldDayRows } from './bucket';

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
