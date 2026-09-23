import { compareRuns, countByClassification, sortComparisonRows } from './compare-runs';
import type { ComparableResult } from './compare-runs';

function result(caseId: string, r: ComparableResult['result'], overrides: Partial<ComparableResult> = {}): ComparableResult {
  return { caseId, questionText: `q-${caseId}`, result: r, matchedIntentId: null, matchedFaqId: null, matchedNodeId: null, outputsHash: 'h', ...overrides };
}

describe('compareRuns — M1 5분류(FR-V2-6, ADR-0029 §2)', () => {
  it('PASS→FAIL은 REGRESSED, FAIL→PASS는 IMPROVED다', () => {
    const base = [result('c1', 'PASS'), result('c2', 'FAIL')];
    const target = [result('c1', 'FAIL'), result('c2', 'PASS')];
    const rows = compareRuns(base, target);
    expect(rows.find((r) => r.caseId === 'c1')?.classification).toBe('REGRESSED');
    expect(rows.find((r) => r.caseId === 'c2')?.classification).toBe('IMPROVED');
  });

  it('판정이 같고 매칭·해시도 같으면 UNCHANGED, 매칭 대상이 다르면 CHANGED다', () => {
    const base = [result('c1', 'PASS', { matchedIntentId: 'a' }), result('c2', 'PASS', { matchedIntentId: 'a' })];
    const target = [result('c1', 'PASS', { matchedIntentId: 'a' }), result('c2', 'PASS', { matchedIntentId: 'b' })];
    const rows = compareRuns(base, target);
    expect(rows.find((r) => r.caseId === 'c1')?.classification).toBe('UNCHANGED');
    expect(rows.find((r) => r.caseId === 'c2')?.classification).toBe('CHANGED');
  });

  it('응답 해시만 달라도 CHANGED다(판정·매칭 ID는 동일)', () => {
    const base = [result('c1', 'PASS', { outputsHash: 'h1' })];
    const target = [result('c1', 'PASS', { outputsHash: 'h2' })];
    expect(compareRuns(base, target)[0].classification).toBe('CHANGED');
  });

  it('한쪽에만 있는 TC는 ONLY_IN_ONE이며 요약 델타와 분리된다(FR-V2-18)', () => {
    const base = [result('c1', 'PASS')];
    const target = [result('c1', 'PASS'), result('c2', 'PASS')];
    const rows = compareRuns(base, target);
    expect(rows.find((r) => r.caseId === 'c2')?.classification).toBe('ONLY_IN_ONE');
  });

  it('정렬은 REGRESSED 우선이다(FR-V2-6)', () => {
    const base = [result('c1', 'PASS'), result('c2', 'PASS'), result('c3', 'FAIL')];
    const target = [result('c1', 'PASS'), result('c2', 'FAIL'), result('c3', 'PASS')];
    const sorted = sortComparisonRows(compareRuns(base, target));
    expect(sorted[0].classification).toBe('REGRESSED');
  });

  it('countByClassification은 5분류 전체를 0으로 초기화한 뒤 집계한다', () => {
    const rows = compareRuns([result('c1', 'PASS')], [result('c1', 'FAIL')]);
    const counts = countByClassification(rows);
    expect(counts).toEqual({ REGRESSED: 1, IMPROVED: 0, CHANGED: 0, UNCHANGED: 0, ONLY_IN_ONE: 0 });
  });
});
