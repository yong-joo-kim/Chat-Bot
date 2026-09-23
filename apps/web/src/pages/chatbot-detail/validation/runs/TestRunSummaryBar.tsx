import type { TestRunSideSummary } from '@chat-bot/shared-types';
import { JudgmentBadge } from '../../../../components/JudgmentBadge';
import { MESSAGES } from '../../../../constants/messages';

/**
 * 판정 4값 요약 배지(ui-spec §3.3/§4.4.1). 나열 순서는 항상 통과→실패→판정안함→판정불가이며,
 * "합=실행 대상 TC 수" 산식을 각주로 상시 표기해 AC-V2-3을 사용자가 직접 검산할 수 있게 한다.
 */
export function TestRunSummaryBar({ summary }: { summary: TestRunSideSummary }): JSX.Element {
  return (
    <div className="test-run-summary-bar">
      <div className="test-run-summary-badges">
        <JudgmentBadge value="PASS" count={summary.pass} />
        <JudgmentBadge value="FAIL" count={summary.fail} />
        <JudgmentBadge value="NOT_JUDGED" count={summary.notJudged} />
        <JudgmentBadge value="UNRESOLVED" count={summary.unresolved} />
      </div>
      <p className="field-hint">{MESSAGES.validation.judgment.footnote(summary.pass, summary.fail, summary.notJudged, summary.unresolved)}</p>
    </div>
  );
}
