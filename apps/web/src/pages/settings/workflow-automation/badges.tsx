import type { WorkflowEventType, WorkflowOutcome, WorkflowRunStatus } from '@chat-bot/shared-types';
import { MESSAGES } from '../../../constants/messages';

/**
 * [No.41] 발송 대상·실행 이력 공용 배지(`workflow-automation-ui-spec.md` §2.1). 색상+텍스트/아이콘
 * 병기(UIUX §1). `SecretStatusBadge`·`RawPersonalDataBadge`(No.26)는 그대로 재사용하고 여기서는
 * 다시 만들지 않는다.
 */

export function TargetEnabledBadge({ enabled }: { enabled: boolean }): JSX.Element {
  const msg = MESSAGES.workflowTargets;
  return (
    <span className={`dialogue-badge${enabled ? '' : ' dialogue-badge--neutral'}`} style={enabled ? { backgroundColor: '#DCFCE7', color: '#166534' } : undefined}>
      <span aria-hidden="true">{enabled ? '●' : '○'}</span> {enabled ? msg.badgeEnabled : msg.badgeDisabled}
    </span>
  );
}

export function TargetPausedBadge(): JSX.Element {
  const msg = MESSAGES.workflowTargets;
  return (
    <span className="dialogue-badge" style={{ backgroundColor: '#FFEDD5', color: '#9A3412' }}>
      <span aria-hidden="true">⏸</span> {msg.badgePaused}
    </span>
  );
}

export function SigningWeakBadge(): JSX.Element {
  const msg = MESSAGES.workflowTargets;
  return (
    <span className="dialogue-badge" style={{ backgroundColor: '#FFEDD5', color: '#9A3412' }} title={msg.badgeSigningWeakTitle}>
      <span aria-hidden="true">⚠</span> {msg.badgeSigningWeak}
    </span>
  );
}

export function ConsecutiveFailureBadge({ count }: { count: number }): JSX.Element {
  const msg = MESSAGES.workflowTargets;
  return (
    <span className="dialogue-badge" style={{ backgroundColor: '#FFEDD5', color: '#9A3412' }} title={msg.badgeConsecutiveFailuresTitle}>
      <span aria-hidden="true">⚠</span> {msg.badgeConsecutiveFailures(count)}
    </span>
  );
}

const RUN_STATUS_CONFIG: Record<WorkflowRunStatus, { icon: string; bg: string; fg: string }> = {
  PENDING: { icon: '◐', bg: '#F3F4F6', fg: '#374151' },
  HELD: { icon: '⏸', bg: '#FFEDD5', fg: '#9A3412' },
  SENDING: { icon: '↻', bg: '#DBEAFE', fg: '#1D4ED8' },
  SUCCEEDED: { icon: '✔', bg: '#DCFCE7', fg: '#166534' },
  FAILED: { icon: '✖', bg: '#FEE2E2', fg: '#991B1B' },
  SKIPPED: { icon: '—', bg: '#F3F4F6', fg: '#374151' },
  CANCELLED: { icon: '⊘', bg: '#F3F4F6', fg: '#374151' },
  EXPIRED: { icon: '⧖', bg: '#F3F4F6', fg: '#374151' },
};

export function WorkflowRunStatusBadge({ status }: { status: WorkflowRunStatus }): JSX.Element {
  const cfg = RUN_STATUS_CONFIG[status];
  return (
    <span className="dialogue-badge" style={{ backgroundColor: cfg.bg, color: cfg.fg }}>
      <span aria-hidden="true">{cfg.icon}</span> {MESSAGES.workflowRuns.statusLabel[status]}
    </span>
  );
}

const OUTCOME_TONE: Record<WorkflowOutcome, { bg: string; fg: string }> = {
  SUCCESS: { bg: '#DCFCE7', fg: '#166534' },
  HTTP_ERROR: { bg: '#FFEDD5', fg: '#9A3412' },
  TIMEOUT: { bg: '#FFEDD5', fg: '#9A3412' },
  NETWORK_ERROR: { bg: '#FFEDD5', fg: '#9A3412' },
  REDIRECT_NOT_ALLOWED: { bg: '#F3F4F6', fg: '#374151' },
  BLOCKED_ADDRESS: { bg: '#F3F4F6', fg: '#374151' },
  EGRESS_BLOCKED: { bg: '#F3F4F6', fg: '#374151' },
  SECRET_MISSING: { bg: '#F3F4F6', fg: '#374151' },
  TARGET_HOST_MISMATCH: { bg: '#F3F4F6', fg: '#374151' },
  INVALID_TARGET_URL: { bg: '#F3F4F6', fg: '#374151' },
  LEASE_EXPIRED: { bg: '#F3F4F6', fg: '#374151' },
};

/** 실행 이력 전용 — 관리자 화면에만 노출한다(FR-0-176과 같은 절제). */
export function WorkflowOutcomeBadge({ outcome }: { outcome: WorkflowOutcome }): JSX.Element {
  const cfg = OUTCOME_TONE[outcome];
  return (
    <span className="dialogue-badge" style={{ backgroundColor: cfg.bg, color: cfg.fg }}>
      {MESSAGES.workflowRuns.outcomeLabel[outcome]}
    </span>
  );
}

export function WorkflowEventTypeBadge({ eventType }: { eventType: WorkflowEventType }): JSX.Element {
  return <span className="dialogue-badge dialogue-badge--neutral">{MESSAGES.workflowRuns.eventTypeLabel[eventType]}</span>;
}

/** 노드 편집기(D1) — "이 노드는 사용자에게 보이는 응답이 없습니다"(WARNING 톤, `WORKFLOW_ONLY_OUTPUT`과 같은 조건). */
export function WorkflowOnlyOutputBadge(): JSX.Element {
  return (
    <span className="dialogue-badge" style={{ backgroundColor: '#FEF3C7', color: '#92400E' }}>
      <span aria-hidden="true">⚠</span> {MESSAGES.dialogue.outputFields.workflowOnlyOutputNotice}
    </span>
  );
}
