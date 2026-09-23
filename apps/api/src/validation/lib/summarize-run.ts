import type { TestCaseResultKind, TestRunSideSummary } from '@chat-bot/shared-types';

/**
 * 실행 요약 집계 순수 함수(§5.4) — 합계는 실행 대상 TC 수와 같다(`enabled=false` TC는 애초에
 * 실행 대상에서 제외되므로 분모에 들어가지 않는다). DB·Nest 무의존.
 */
export function summarizeRun(results: readonly { result: TestCaseResultKind }[]): TestRunSideSummary {
  const summary: TestRunSideSummary = { pass: 0, fail: 0, notJudged: 0, unresolved: 0 };
  for (const r of results) {
    if (r.result === 'PASS') summary.pass += 1;
    else if (r.result === 'FAIL') summary.fail += 1;
    else if (r.result === 'NOT_JUDGED') summary.notJudged += 1;
    else if (r.result === 'UNRESOLVED') summary.unresolved += 1;
  }
  return summary;
}
