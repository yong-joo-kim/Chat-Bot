import type { ProdSwitchApprovalSummary } from '@chat-bot/shared-types';
import { SeverityBadge } from '../../../../components/SeverityBadge';
import { approvalStatusView, type ApprovalTone } from '../../../../lib/approvalText';

const EXTRA_TONE_STYLE: Record<'SUCCESS' | 'NEUTRAL', { icon: string; bg: string; fg: string }> = {
  SUCCESS: { icon: '✔', bg: '#DCFCE7', fg: '#166534' },
  NEUTRAL: { icon: '•', bg: '#F3F4F6', fg: '#374151' },
};

/** 톤 배지 — 글자가 항상 병기되고 색·아이콘은 보조다(UIUX §1). `SeverityBadge`에 없는 성공·중립 톤만 자체 스타일을 쓴다. */
export function ApprovalToneBadge({ tone, label }: { tone: ApprovalTone; label: string }): JSX.Element {
  if (tone === 'INFO' || tone === 'WARNING' || tone === 'ERROR') return <SeverityBadge severity={tone} label={label} />;
  const style = EXTRA_TONE_STYLE[tone];
  return (
    <span className="severity-badge" style={{ backgroundColor: style.bg, color: style.fg }}>
      <span aria-hidden="true">{style.icon}</span> {label}
    </span>
  );
}

/** 요청 상태 글자(§9.5 표) — 서버가 준 `status`만 믿고 화면에서 만료를 판정해 바꾸지 않는다. 반려 메모가 있으면 줄 아래 붙인다. */
export function ApprovalStatusText({ request }: { request: Pick<ProdSwitchApprovalSummary, 'status' | 'outcome' | 'closedReason' | 'failureCode' | 'decisionNote' | 'executedAt'> }): JSX.Element {
  const view = approvalStatusView(request);
  return (
    <span className="approval-status-text">
      <ApprovalToneBadge tone={view.tone} label={view.label} />
      {view.note && <span className="field-hint guardrail-break"> {view.note}</span>}
    </span>
  );
}
