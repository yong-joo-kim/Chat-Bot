import type { TestCaseResultKind } from '@chat-bot/shared-types';
import { MESSAGES } from '../constants/messages';

/**
 * 판정 4값의 고정 시각 언어(validation-regression-ui-spec.md §3.3) — 화면 전체에서 이 컴포넌트
 * 하나로만 판정을 그린다. `UNRESOLVED`는 색상(주황)·아이콘(⚠)·테두리(점선) 3중으로 `FAIL`(빨강 실선)과
 * 구분해 "회귀가 아니다"를 시각적으로 강제한다(NFR-VA1).
 */
const CONFIG: Record<TestCaseResultKind, { icon: string; bg: string; fg: string; border: string }> = {
  PASS: { icon: '✔', bg: '#DCFCE7', fg: '#166534', border: '1px solid transparent' },
  FAIL: { icon: '✕', bg: '#FEE2E2', fg: '#991B1B', border: '1px solid #991B1B' },
  NOT_JUDGED: { icon: '➖', bg: '#F3F4F6', fg: '#374151', border: '1px solid transparent' },
  UNRESOLVED: { icon: '⚠', bg: '#FEF3C7', fg: '#92400E', border: '1px dashed #92400E' },
};

export function JudgmentBadge({
  value,
  withHint = false,
  count,
}: {
  value: TestCaseResultKind;
  withHint?: boolean;
  /** 요약 바(`TestRunSummaryBar`)에서 "통과 471"처럼 건수를 함께 표시할 때 사용한다. */
  count?: number;
}): JSX.Element {
  const cfg = CONFIG[value];
  const msg = MESSAGES.validation.judgment;
  return (
    <span className="judgment-badge" style={{ backgroundColor: cfg.bg, color: cfg.fg, border: cfg.border }}>
      <span aria-hidden="true">{cfg.icon}</span> {msg[value]}
      {count !== undefined && ` ${count}`}
      {withHint && value === 'UNRESOLVED' && <span className="judgment-badge-hint"> — {msg.unresolvedHint}</span>}
    </span>
  );
}
