import { foldIntentStats } from './intent-stats';

describe('foldIntentStats (No.29 §6, J-13)', () => {
  const rows = [
    { matchedIntentId: 'intent-a', isAnswered: true, count: 6 },
    { matchedIntentId: 'intent-a', isAnswered: false, count: 2 },
    { matchedIntentId: 'intent-b', isAnswered: true, count: 3 },
    { matchedIntentId: null, isAnswered: false, count: 4 },
  ];
  const names = [
    { id: 'intent-a', name: '배송조회' },
    // intent-b는 삭제된 의도(이름 목록에 없음) — deleted:true로 표시(AC-I5-5)
  ];

  it('splits unmatched turns and computes both denominators', () => {
    const result = foldIntentStats(rows, names, 10);
    expect(result.totalTurnCount).toBe(15);
    expect(result.unmatchedTurnCount).toBe(4);
    expect(result.matchedTurnCount).toBe(11);
    expect(result.distinctIntentCount).toBe(2);

    const a = result.items.find((i) => i.intentId === 'intent-a')!;
    expect(a.turnCount).toBe(8);
    expect(a.answeredCount).toBe(6);
    expect(a.responseRate).toBe(0.75);
    expect(a.shareOfAll).toBeCloseTo(8 / 15, 4);
    expect(a.shareOfIntentMatched).toBeCloseTo(8 / 11, 4);

    const b = result.items.find((i) => i.intentId === 'intent-b')!;
    expect(b.name).toBeNull();
    expect(b.deleted).toBe(true);
  });

  it('sorts by turnCount desc → intentId asc and truncates to topN with othersTurnCount', () => {
    const manyRows = Array.from({ length: 5 }, (_, i) => ({ matchedIntentId: `intent-${i}`, isAnswered: true, count: 5 - i }));
    const manyNames = manyRows.map((_, i) => ({ id: `intent-${i}`, name: `의도${i}` }));
    const result = foldIntentStats(manyRows, manyNames, 2);
    expect(result.items).toHaveLength(2);
    expect(result.items.map((i) => i.intentId)).toEqual(['intent-0', 'intent-1']);
    expect(result.othersTurnCount).toBe(3 + 2 + 1);
  });

  it('returns zeroed totals for an empty input', () => {
    const result = foldIntentStats([], [], 10);
    expect(result).toEqual({
      totalTurnCount: 0,
      matchedTurnCount: 0,
      unmatchedTurnCount: 0,
      othersTurnCount: 0,
      distinctIntentCount: 0,
      items: [],
    });
  });
});
