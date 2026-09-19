import { aggregateTopQuestions, computeResponseRates, computeVisitCount } from './dashboard-aggregator';

describe('aggregateTopQuestions', () => {
  it('merges normalized duplicates and sorts by count desc (AC-2-2, AC-2-4)', () => {
    const rows = [
      { question: '배송 조회', count: 11, lastOccurredAt: new Date('2026-01-01T00:00:00Z') },
      { question: ' 배송  조회 ', count: 1, lastOccurredAt: new Date('2026-01-02T00:00:00Z') },
      { question: '환불 절차', count: 7, lastOccurredAt: new Date('2026-01-01T00:00:00Z') },
    ];
    const result = aggregateTopQuestions(rows, 5);
    expect(result[0]).toEqual({ question: '배송 조회', count: 12 });
    expect(result[1]).toEqual({ question: '환불 절차', count: 7 });
  });

  it('excludes blank/whitespace-only questions from the ranking (EX-2-3)', () => {
    const rows = [
      { question: '', count: 5, lastOccurredAt: new Date() },
      { question: '   ', count: 3, lastOccurredAt: new Date() },
      { question: '유효 질문', count: 1, lastOccurredAt: new Date() },
    ];
    expect(aggregateTopQuestions(rows, 5)).toEqual([{ question: '유효 질문', count: 1 }]);
  });

  it('limits results to topN — defaults align with 5, extends to 10 (AC-2-3)', () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({
      question: `질문 ${i}`,
      count: 20 - i,
      lastOccurredAt: new Date(),
    }));
    expect(aggregateTopQuestions(rows, 5)).toHaveLength(5);
    expect(aggregateTopQuestions(rows, 10)).toHaveLength(10);
  });

  it('breaks count ties by the most recent occurrence (FR-2-4)', () => {
    const rows = [
      { question: 'A', count: 3, lastOccurredAt: new Date('2026-01-01T00:00:00Z') },
      { question: 'B', count: 3, lastOccurredAt: new Date('2026-01-02T00:00:00Z') },
    ];
    expect(aggregateTopQuestions(rows, 5)[0].question).toBe('B');
  });
});

describe('computeResponseRates', () => {
  it('returns 0/0 without NaN when totalCount is 0 (FR-2-9, AC-2-5)', () => {
    expect(computeResponseRates({ answeredCount: 0, totalCount: 0 })).toEqual({
      responseRate: 0,
      noResponseRate: 0,
    });
  });

  it('sums to exactly 1 (AC-2-1)', () => {
    const { responseRate, noResponseRate } = computeResponseRates({ answeredCount: 90, totalCount: 100 });
    expect(responseRate).toBe(0.9);
    expect(noResponseRate).toBe(0.1);
    expect(responseRate + noResponseRate).toBe(1);
  });

  it('derives noResponseRate from the rounded responseRate to avoid rounding drift', () => {
    const { responseRate, noResponseRate } = computeResponseRates({ answeredCount: 1, totalCount: 3 });
    expect(responseRate + noResponseRate).toBe(1);
  });

  it('allows an all-unanswered period (EX-2-2)', () => {
    expect(computeResponseRates({ answeredCount: 0, totalCount: 10 })).toEqual({
      responseRate: 0,
      noResponseRate: 1,
    });
  });
});

describe('computeVisitCount', () => {
  it('uses LOG_COUNT basis when no sessionId is present (ADR-0001)', () => {
    expect(computeVisitCount({ distinctSessionCount: 0, nullSessionCount: 42 })).toEqual({
      visitCount: 42,
      visitCountBasis: 'LOG_COUNT',
    });
  });

  it('uses SESSION basis and sums distinct + null-session rows when any sessionId exists', () => {
    expect(computeVisitCount({ distinctSessionCount: 40, nullSessionCount: 5 })).toEqual({
      visitCount: 45,
      visitCountBasis: 'SESSION',
    });
  });
});
