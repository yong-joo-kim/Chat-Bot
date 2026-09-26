import {
  AUDIT_ACTION_LABELS,
  DESTRUCTIVE_AUDIT_ACTIONS,
  ROLE_LABELS,
  type AuditAction,
  type BannedWordPolicy,
  type RoleName,
  type UserStatus,
} from '@chat-bot/shared-types';
import { MESSAGES } from '../../constants/messages';

/** 색상 단독 전달 금지(UIUX §1) — 색+아이콘+텍스트 병기(security-audit-ui-spec.md §2.1). */

const ROLE_CONFIG: Record<RoleName, { icon: string; bg: string; fg: string }> = {
  ADMIN: { icon: '★', bg: '#EDE9FE', fg: '#5B21B6' },
  EDITOR: { icon: '✎', bg: '#DBEAFE', fg: '#1D4ED8' },
  VIEWER: { icon: '◎', bg: '#F3F4F6', fg: '#374151' },
  /** [신규 No.24] 상담원 — 청록 + 헤드셋 아이콘(hybrid-cs-ui-spec.md §2.1). */
  AGENT: { icon: '🎧', bg: '#CCFBF1', fg: '#0F766E' },
};

/** `ROLE_LABELS`(shared-types) 문자열을 그대로 표시한다 — 컴포넌트가 재정의하지 않는다(F-3). */
export function RoleBadge({ role }: { role: RoleName }): JSX.Element {
  const cfg = ROLE_CONFIG[role];
  return (
    <span className="dialogue-badge" style={{ backgroundColor: cfg.bg, color: cfg.fg }}>
      <span aria-hidden="true">{cfg.icon}</span> {ROLE_LABELS[role]}
    </span>
  );
}

export function AccountStatusBadge({ status }: { status: UserStatus }): JSX.Element {
  if (status === 'ACTIVE') {
    return (
      <span className="dialogue-badge" style={{ backgroundColor: '#DCFCE7', color: '#166534' }}>
        <span aria-hidden="true">●</span> {MESSAGES.users.statusActive}
      </span>
    );
  }
  return (
    <span className="dialogue-badge dialogue-badge--neutral">
      <span aria-hidden="true">○🔒</span> {MESSAGES.users.statusDisabled}
    </span>
  );
}

const AUDIT_ACTION_COLOR: Record<AuditAction, { bg: string; fg: string }> = {
  CREATE: { bg: '#DBEAFE', fg: '#1D4ED8' },
  UPDATE: { bg: '#F3F4F6', fg: '#374151' },
  DELETE: { bg: '#FEE2E2', fg: '#991B1B' },
  PURGE: { bg: '#FEE2E2', fg: '#7F1D1D' },
  STATUS_CHANGE: { bg: '#FEF3C7', fg: '#92400E' },
  BULK_DELETE: { bg: '#FEE2E2', fg: '#991B1B' },
  IMPORT: { bg: '#DBEAFE', fg: '#1D4ED8' },
  COPY: { bg: '#F3F4F6', fg: '#374151' },
  LOGIN: { bg: '#DCFCE7', fg: '#166534' },
  LOGIN_FAILED: { bg: '#FEF3C7', fg: '#92400E' },
  LOGOUT: { bg: '#F3F4F6', fg: '#374151' },
  PERMISSION_DENIED: { bg: '#FEF3C7', fg: '#92400E' },
  /** [신규 2026-09-23 No.25] 복원(FR-0-73, `RESTORE`) — 파괴적 동작 목록에 포함(ADR-0016). */
  RESTORE: { bg: '#FFEDD5', fg: '#9A3412' },
  /** [신규 No.24] 원문 열람(`RAW_VIEW`) — 하이브리드 CS 상담 중 원문 토글 감사(hybrid-cs-설계.md §16). */
  RAW_VIEW: { bg: '#E0E7FF', fg: '#3730A3' },
  /** [신규 No.45] 열람(마스킹본, `VIEW`)·내보내기(`EXPORT`) — `RAW_VIEW`와 톤이 겹치지 않게 구분한다
   * (data-governance-ui-spec.md §2.2 — 같은 목록에 `VIEW`·`RAW_VIEW`가 함께 나타날 수 있다). */
  VIEW: { bg: '#E0F2FE', fg: '#075985' },
  EXPORT: { bg: '#DBEAFE', fg: '#1D4ED8' },
};

/** 파괴적 동작 3종은 굵게+좌측 강조선으로 한 번 더 구분한다(FR-13-21). */
export function AuditActionBadge({ action }: { action: AuditAction }): JSX.Element {
  const cfg = AUDIT_ACTION_COLOR[action];
  const destructive = (DESTRUCTIVE_AUDIT_ACTIONS as readonly AuditAction[]).includes(action);
  return (
    <span
      className={`dialogue-badge${destructive ? ' audit-action-badge--destructive' : ''}`}
      style={{ backgroundColor: cfg.bg, color: cfg.fg }}
    >
      {action === 'PERMISSION_DENIED' && <span aria-hidden="true">⚠ </span>}
      {action === 'VIEW' && <span aria-hidden="true">👁 </span>}
      {action === 'EXPORT' && <span aria-hidden="true">⬇ </span>}
      {AUDIT_ACTION_LABELS[action]}
    </span>
  );
}

export function MatchTypeBadge({ matchType }: { matchType: 'EXACT' | 'CONTAINS' }): JSX.Element {
  const label = matchType === 'EXACT' ? MESSAGES.bannedWords.matchTypeExact : MESSAGES.bannedWords.matchTypeContains;
  return <span className="dialogue-badge dialogue-badge--neutral">{label}</span>;
}

export function BannedWordPolicyBadge({ policy }: { policy: BannedWordPolicy }): JSX.Element {
  if (policy === 'BLOCK') {
    return (
      <span className="dialogue-badge" style={{ backgroundColor: '#FEE2E2', color: '#991B1B' }}>
        {MESSAGES.bannedWords.policyBlock}
      </span>
    );
  }
  return (
    <span className="dialogue-badge" style={{ backgroundColor: '#FEF3C7', color: '#92400E' }}>
      {MESSAGES.bannedWords.policyWarn}
    </span>
  );
}

export function BannedWordDecisionBadge({ decision }: { decision: 'PASS' | 'WARN' | 'BLOCK' }): JSX.Element {
  const cfg =
    decision === 'BLOCK'
      ? { bg: '#FEE2E2', fg: '#991B1B', icon: '✖', label: MESSAGES.bannedWords.decisionBlock }
      : decision === 'WARN'
        ? { bg: '#FEF3C7', fg: '#92400E', icon: '⚠', label: MESSAGES.bannedWords.decisionWarn }
        : { bg: '#DCFCE7', fg: '#166534', icon: '✔', label: MESSAGES.bannedWords.decisionPass };
  return (
    <span className="dialogue-badge" style={{ backgroundColor: cfg.bg, color: cfg.fg }}>
      <span aria-hidden="true">{cfg.icon}</span> {cfg.label}
    </span>
  );
}
