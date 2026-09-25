import type { EnvironmentGateSettings, GateEvaluation } from '@chat-bot/shared-types';
import { MESSAGES } from '../constants/messages';
import { gateReasonText } from '../pages/chatbot-detail/environment/lib/switchPreviewText';

/** 게이트 판정 배지 3종(`environment-separation-ui-spec.md` §3.3-(2)). 아이콘+색+텍스트 3중 표현. */
const STYLE: Record<GateEvaluation['verdict'], { icon: string; bg: string; fg: string }> = {
  PASS: { icon: '✔', bg: '#DCFCE7', fg: '#166534' },
  WARN: { icon: '⚠', bg: '#FEF3C7', fg: '#92400E' },
  BLOCK: { icon: '✕', bg: '#FEE2E2', fg: '#991B1B' },
};

export function GateResultBadge({
  gate,
  settings,
  showReason = true,
}: {
  gate: GateEvaluation;
  settings?: EnvironmentGateSettings;
  showReason?: boolean;
}): JSX.Element {
  const style = STYLE[gate.verdict];
  const reasonText = showReason ? gateReasonText(gate, settings) : undefined;
  return (
    <span className="gate-result-badge">
      <span className="gate-result-badge-verdict" style={{ backgroundColor: style.bg, color: style.fg }}>
        <span aria-hidden="true">{style.icon}</span> {MESSAGES.environment.gateVerdict[gate.verdict]}
      </span>
      {reasonText && <span className="gate-result-badge-reason"> — {reasonText}</span>}
    </span>
  );
}
