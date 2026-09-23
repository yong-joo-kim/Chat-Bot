import { summarizeRun } from './summarize-run';

describe('summarizeRun — §5.4 요약 집계', () => {
  it('4값 각각을 정확히 센다(합 = 실행 대상 TC 수)', () => {
    const results = [{ result: 'PASS' as const }, { result: 'PASS' as const }, { result: 'FAIL' as const }, { result: 'NOT_JUDGED' as const }, { result: 'UNRESOLVED' as const }];
    expect(summarizeRun(results)).toEqual({ pass: 2, fail: 1, notJudged: 1, unresolved: 1 });
  });

  it('빈 배열은 전부 0이다', () => {
    expect(summarizeRun([])).toEqual({ pass: 0, fail: 0, notJudged: 0, unresolved: 0 });
  });
});
