import { MESSAGES } from '../constants/messages';

export type Severity = 'ERROR' | 'WARNING' | 'INFO';

/** 색상 단독 전달 금지(UIUX §1) — 색상 + 아이콘 + 텍스트 레이블을 항상 병기한다(ui-spec §2.2-5). */
const SEVERITY_CONFIG: Record<Severity, { icon: string; bg: string; fg: string }> = {
  ERROR: { icon: '✖', bg: '#FEE2E2', fg: '#991B1B' },
  WARNING: { icon: '⚠', bg: '#FEF3C7', fg: '#92400E' },
  INFO: { icon: 'ⓘ', bg: '#DBEAFE', fg: '#1D4ED8' },
};

export function SeverityBadge({ severity, label }: { severity: Severity; label?: string }): JSX.Element {
  const cfg = SEVERITY_CONFIG[severity];
  return (
    <span className="severity-badge" style={{ backgroundColor: cfg.bg, color: cfg.fg }}>
      <span aria-hidden="true">{cfg.icon}</span> {label ?? MESSAGES.dialogue.severity[severity]}
    </span>
  );
}
