import { aggregateProactiveStats, isFrequentlyDismissed } from './stats-aggregate';

const THRESHOLD = { ratio: 0.5, minShown: 100 };

describe('isFrequentlyDismissed', () => {
  it('표시가 최소치 미만이면 false', () => {
    expect(isFrequentlyDismissed(99, 99, 0, THRESHOLD)).toBe(false);
  });
  it('표시 ≥ 최소치이고 (닫기+끄기)/표시 ≥ 비율이면 true', () => {
    expect(isFrequentlyDismissed(120, 70, 0, THRESHOLD)).toBe(true);
  });
  it('닫기+끄기를 합쳐서 판정한다', () => {
    expect(isFrequentlyDismissed(100, 30, 20, THRESHOLD)).toBe(true);
  });
  it('비율 미만이면 false', () => {
    expect(isFrequentlyDismissed(100, 10, 10, THRESHOLD)).toBe(false);
  });
});

describe('aggregateProactiveStats', () => {
  it('규칙별로 합산하고 비율을 계산한다', () => {
    const rows = [
      { ruleId: 'r1', ruleName: '규칙1', dayBucket: '2026-09-01', shown: 10, clicked: 3, dismissed: 5, optedOut: 0 },
      { ruleId: 'r1', ruleName: '규칙1', dayBucket: '2026-09-02', shown: 0, clicked: 0, dismissed: 0, optedOut: 0 },
    ];
    const { totals, daily } = aggregateProactiveStats(rows, new Set(['r1']), THRESHOLD);
    expect(totals).toEqual([
      { ruleId: 'r1', name: '규칙1', deleted: false, shown: 10, clicked: 3, dismissed: 5, optedOut: 0, clickRate: 0.3, dismissRate: 0.5, optOutRate: 0, frequentlyDismissed: false },
    ]);
    expect(daily).toHaveLength(2);
  });

  it('삭제된 규칙(existingRuleIds에 없음)은 deleted:true', () => {
    const rows = [{ ruleId: 'gone', ruleName: '삭제됨', dayBucket: '2026-09-01', shown: 1, clicked: 0, dismissed: 0, optedOut: 0 }];
    const { totals } = aggregateProactiveStats(rows, new Set(), THRESHOLD);
    expect(totals[0].deleted).toBe(true);
  });

  it('표시 0이면 비율은 null(FR-PA5-6 — SHOWN 없이 온 클릭이 분모를 넘지 않게)', () => {
    const rows = [{ ruleId: 'r1', ruleName: '규칙1', dayBucket: '2026-09-01', shown: 0, clicked: 5, dismissed: 0, optedOut: 0 }];
    const { totals } = aggregateProactiveStats(rows, new Set(['r1']), THRESHOLD);
    expect(totals[0].clickRate).toBeNull();
  });

  it('클릭이 표시보다 많아도(위조) 비율은 1을 넘지 않는다', () => {
    const rows = [{ ruleId: 'r1', ruleName: '규칙1', dayBucket: '2026-09-01', shown: 5, clicked: 50, dismissed: 0, optedOut: 0 }];
    const { totals } = aggregateProactiveStats(rows, new Set(['r1']), THRESHOLD);
    expect(totals[0].clickRate).toBe(1);
  });

  it('빈 입력은 빈 결과', () => {
    expect(aggregateProactiveStats([], new Set(), THRESHOLD)).toEqual({ totals: [], daily: [] });
  });
});
