import { ALERT_LEVEL_LABELS, HANDOFF_END_REASON_LABELS, type AlertLevel, type HandoffEndReason } from '@chat-bot/shared-types';
import { MESSAGES } from '../../constants/messages';

/** 색상 단독 전달 금지(UIUX §1) — 색+아이콘+텍스트 병기(hybrid-cs-ui-spec.md §2.1). */

/** ▲(주의)/⛔(경고) — 색상 없이도 형태로 구분되는 순수 아이콘(§2.2 `AlertLevelIcon`). */
export function AlertLevelIcon({ level }: { level: AlertLevel }): JSX.Element | null {
  if (level === 'NORMAL') return null;
  return <span aria-hidden="true">{level === 'WARNING' ? '⛔' : '▲'}</span>;
}

const ALERT_LEVEL_COLOR: Record<AlertLevel, { bg: string; fg: string }> = {
  NORMAL: { bg: '#F3F4F6', fg: '#374151' },
  CAUTION: { bg: '#FEF3C7', fg: '#92400E' },
  WARNING: { bg: '#FEE2E2', fg: '#991B1B' },
};

/** `evaluateSessionAlert()` 결과를 그대로 표시한다 — 클라이언트 재계산 0(NFR-CSM1). */
export function AlertLevelBadge({ level, consecutive }: { level: AlertLevel; consecutive?: number }): JSX.Element {
  const cfg = ALERT_LEVEL_COLOR[level];
  const label =
    level === 'NORMAL'
      ? ALERT_LEVEL_LABELS.NORMAL
      : `${ALERT_LEVEL_LABELS[level]} · 연속${consecutive !== undefined ? consecutive : ''}`;
  return (
    <span className="dialogue-badge" style={{ backgroundColor: cfg.bg, color: cfg.fg }}>
      <AlertLevelIcon level={level} /> {label}
    </span>
  );
}

export type HandoffStateBadgeVariant =
  | { kind: 'NONE' }
  | { kind: 'CONNECTING'; assigneeName: string }
  | { kind: 'CONNECTED'; assigneeName: string; isMine: boolean }
  | { kind: 'LEGACY' };

export function HandoffStateBadge(props: HandoffStateBadgeVariant): JSX.Element | null {
  const msg = MESSAGES.handoffConsole;
  if (props.kind === 'NONE') return null;
  if (props.kind === 'LEGACY') {
    return (
      <span className="dialogue-badge dialogue-badge--neutral">{msg.handoffLegacyBadge}</span>
    );
  }
  if (props.kind === 'CONNECTING') {
    return (
      <span className="dialogue-badge" style={{ backgroundColor: '#DBEAFE', color: '#1D4ED8' }}>
        {msg.handoffConnecting(props.assigneeName)}
      </span>
    );
  }
  return (
    <span className="dialogue-badge" style={{ backgroundColor: '#DCFCE7', color: '#166534' }}>
      {props.isMine ? msg.handoffConnectedMine : msg.handoffConnected(props.assigneeName)}
    </span>
  );
}

/** `unverifiedAttemptCount > 0`일 때만 렌더 — 선점 의심 신호(§1.4.2). */
export function UnverifiedAttemptBadge({ count }: { count: number }): JSX.Element | null {
  if (count <= 0) return null;
  return (
    <span className="dialogue-badge" style={{ backgroundColor: '#FFEDD5', color: '#9A3412' }}>
      {MESSAGES.handoffConsole.unverifiedAttemptBadge(count)}
    </span>
  );
}

/** 원문이 함께 표시된 항목에만 — 마스킹본 옆에 병기(색상 단독 아님). */
export function RawViewBadge(): JSX.Element {
  return (
    <span className="dialogue-badge" style={{ backgroundColor: '#E0E7FF', color: '#3730A3' }}>
      {MESSAGES.handoffConsole.rawBadgeLabel}
    </span>
  );
}

/** "간이 추천" — `mode: 'LEXICAL'`일 때(의미 매칭 불가, AC-CS5-2). */
export function LexicalFallbackBadge(): JSX.Element {
  return <span className="dialogue-badge dialogue-badge--neutral">{MESSAGES.handoffConsole.hintLexicalBadge}</span>;
}

/** "표본 {n}건" — 항상 표본 수를 병기한다(No.27 `SurveyLowSampleBadge`와 같은 원칙). */
export function LowSampleBadge({ n }: { n: number }): JSX.Element {
  return <span className="dialogue-badge dialogue-badge--neutral">{MESSAGES.handoffConsole.summarySampleCount(n)}</span>;
}

/** `HANDOFF_END_REASON_LABELS`(shared-types) 그대로 표시 — 문자열 재정의 금지(F-3 원칙 상속). */
export function EndReasonBadge({ reason }: { reason: HandoffEndReason | null }): JSX.Element | null {
  if (!reason) return null;
  return <span className="dialogue-badge dialogue-badge--neutral">{HANDOFF_END_REASON_LABELS[reason]}</span>;
}
