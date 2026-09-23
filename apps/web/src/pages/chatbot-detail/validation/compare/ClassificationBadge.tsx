import type { TestRunComparisonKind } from '@chat-bot/shared-types';
import { MESSAGES } from '../../../../constants/messages';

/** M1/M2 5분류 배지(ui-spec §4.5) — 색상 단독 금지, 아이콘+텍스트 병기. */
const CONFIG: Record<TestRunComparisonKind, { icon: string; bg: string; fg: string }> = {
  REGRESSED: { icon: '✕', bg: '#FEE2E2', fg: '#991B1B' },
  IMPROVED: { icon: '✔', bg: '#DCFCE7', fg: '#166534' },
  CHANGED: { icon: '±', bg: '#FEF9C3', fg: '#854D0E' },
  UNCHANGED: { icon: '=', bg: '#F3F4F6', fg: '#374151' },
  ONLY_IN_ONE: { icon: '◐', bg: '#EDE9FE', fg: '#5B21B6' },
};

export function ClassificationBadge({ value }: { value: TestRunComparisonKind }): JSX.Element {
  const cfg = CONFIG[value];
  return (
    <span className="classification-badge" style={{ backgroundColor: cfg.bg, color: cfg.fg }}>
      <span aria-hidden="true">{cfg.icon}</span> {MESSAGES.validation.classification[value]}
    </span>
  );
}
