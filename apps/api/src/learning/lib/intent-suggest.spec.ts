import { suggestIntents } from './intent-suggest';

const INTENTS = [
  { id: 'i1', name: '배송문의', examples: ['배송 언제 오나요', '택배 조회하고 싶어요'] },
  { id: 'i2', name: '환불문의', examples: ['환불 절차 알려주세요'] },
];

describe('suggestIntents (FR-15-15~18, J-5 — 문자 bigram 자카드)', () => {
  it('ranks intents whose examples are similar to the question above the threshold (AC-15B-2)', () => {
    const result = suggestIntents('배송 얼마나 걸리나요', INTENTS, { minScore: 0.1, max: 3 });
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].intentId).toBe('i1');
    expect(result[0].score).toBeGreaterThan(0);
  });

  it('returns an empty array when nothing clears the minimum score (AC-15B-3)', () => {
    const result = suggestIntents('전혀 무관한 문의입니다', INTENTS, { minScore: 0.9, max: 3 });
    expect(result).toEqual([]);
  });

  it('caps results at `max`', () => {
    const manyIntents = Array.from({ length: 10 }, (_, i) => ({ id: `i${i}`, name: '배송문의', examples: ['배송 언제 오나요'] }));
    const result = suggestIntents('배송 언제 오나요', manyIntents, { minScore: 0, max: 3 });
    expect(result).toHaveLength(3);
  });

  it('sorts by descending score', () => {
    const result = suggestIntents('배송 언제 오나요', INTENTS, { minScore: 0, max: 3 });
    for (let i = 1; i < result.length; i += 1) {
      expect(result[i - 1].score).toBeGreaterThanOrEqual(result[i].score);
    }
  });
});
