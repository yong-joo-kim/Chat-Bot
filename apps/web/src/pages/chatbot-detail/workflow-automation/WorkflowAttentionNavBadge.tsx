import { MESSAGES } from '../../../constants/messages';

/**
 * [신규 No.41] "업무 자동화" 탭 배지(`workflow-automation-ui-spec.md` §3.13, `NegativeFeedbackNavBadge`와
 * 동형) — 0건이면 렌더하지 않는다. 주황 톤 + 아이콘 + 텍스트("확인 필요 {n}") + `aria-label`.
 */
export function WorkflowAttentionNavBadge({ count }: { count: number }): JSX.Element | null {
  if (count === 0) return null;
  return (
    <span className="workflow-attention-nav-badge" aria-label={`확인 필요 ${count}건`}>
      <span aria-hidden="true">⚠</span> {MESSAGES.workflowSummary.attentionTitle} {count}
    </span>
  );
}
