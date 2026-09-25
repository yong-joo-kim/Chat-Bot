import { foldFeedbackStats } from './feedback-stats';

describe('foldFeedbackStats (FR-FB8-\\*, ADR-0038 §7 — AC-FB6-1 고정 픽스처)', () => {
  it('AC-FB6-1: offered 200 · up 30 · down 10 → positiveRate 0.75 · participationRate 0.2 · ratedCount 40', () => {
    const result = foldFeedbackStats({
      fromDayBucket: '2026-09-01',
      toDayBucket: '2026-09-01',
      ratingByDay: [
        { turnDayBucket: '2026-09-01', rating: 'UP', count: 30 },
        { turnDayBucket: '2026-09-01', rating: 'DOWN', count: 10 },
      ],
      offeredByDay: [{ dayBucket: '2026-09-01', count: 200 }],
      targetRatingRows: [],
      topN: 10,
      lowSampleThreshold: 30,
    });

    expect(result.totals.upCount).toBe(30);
    expect(result.totals.downCount).toBe(10);
    expect(result.totals.ratedCount).toBe(40);
    expect(result.totals.offeredCount).toBe(200);
    expect(result.totals.positiveRate).toBe(0.75);
    expect(result.totals.participationRate).toBe(0.2);
    expect(result.totals.lowSample).toBe(false); // 40 >= 30
  });

  it('lowSample=true when ratedCount below threshold', () => {
    const result = foldFeedbackStats({
      fromDayBucket: '2026-09-01',
      toDayBucket: '2026-09-01',
      ratingByDay: [{ turnDayBucket: '2026-09-01', rating: 'UP', count: 5 }],
      offeredByDay: [{ dayBucket: '2026-09-01', count: 10 }],
      targetRatingRows: [],
      topN: 10,
      lowSampleThreshold: 30,
    });
    expect(result.totals.ratedCount).toBe(5);
    expect(result.totals.lowSample).toBe(true);
  });

  it('rates are null when denominator is 0', () => {
    const result = foldFeedbackStats({
      fromDayBucket: '2026-09-01',
      toDayBucket: '2026-09-01',
      ratingByDay: [],
      offeredByDay: [],
      targetRatingRows: [],
      topN: 10,
      lowSampleThreshold: 30,
    });
    expect(result.totals.positiveRate).toBeNull();
    expect(result.totals.participationRate).toBeNull();
  });

  it('buckets are filled for every day in range even with no rows (empty-day zero fill)', () => {
    const result = foldFeedbackStats({
      fromDayBucket: '2026-09-01',
      toDayBucket: '2026-09-03',
      ratingByDay: [{ turnDayBucket: '2026-09-02', rating: 'UP', count: 1 }],
      offeredByDay: [{ dayBucket: '2026-09-02', count: 2 }],
      targetRatingRows: [],
      topN: 10,
      lowSampleThreshold: 30,
    });
    expect(result.buckets.map((b) => b.dayBucket)).toEqual(['2026-09-01', '2026-09-02', '2026-09-03']);
    expect(result.buckets[0]).toMatchObject({ upCount: 0, downCount: 0, offeredCount: 0, positiveRate: null });
    expect(result.buckets[1]).toMatchObject({ upCount: 1, downCount: 0, offeredCount: 2, positiveRate: 1 });
  });

  it('topNegativeTargets sorted by downCount desc, upCount asc, then kind/targetId — and sliced to topN', () => {
    const result = foldFeedbackStats({
      fromDayBucket: '2026-09-01',
      toDayBucket: '2026-09-01',
      ratingByDay: [],
      offeredByDay: [],
      targetRatingRows: [
        { targetKind: 'NODE', targetId: 'node-a', rating: 'DOWN', count: 3 },
        { targetKind: 'NODE', targetId: 'node-a', rating: 'UP', count: 1 },
        { targetKind: 'FALLBACK', targetId: null, rating: 'DOWN', count: 5 },
        { targetKind: 'FAQ', targetId: 'faq-b', rating: 'DOWN', count: 3 },
        { targetKind: 'FAQ', targetId: 'faq-b', rating: 'UP', count: 0 },
      ],
      topN: 2,
      lowSampleThreshold: 30,
    });

    expect(result.topNegativeTargetsRaw.length).toBe(2);
    expect(result.topNegativeTargetsRaw[0]).toMatchObject({ kind: 'FALLBACK', downCount: 5, upCount: 0 });
    // NODE(down3/up1) vs FAQ(down3/up0) — tie on downCount, FAQ wins on lower upCount.
    expect(result.topNegativeTargetsRaw[1]).toMatchObject({ kind: 'FAQ', targetId: 'faq-b', downCount: 3, upCount: 0 });
  });
});
