import type { DeployScheduleOutcome, DeployScheduleStatus } from '@chat-bot/shared-types';
import { MESSAGES } from '../constants/messages';

export interface DeployScheduleStatusBadgeProps {
  status: DeployScheduleStatus;
  attemptCount?: number;
  outcome?: DeployScheduleOutcome | null;
  delaySeconds?: number | null;
}

/**
 * 예약 상태 7종 고정 배지(`scheduled-deploy-ui-spec.md` §3.3-(1)). `StatusBadge`(챗봇 상태)와 같은
 * "아이콘+색+텍스트" 3중 표현 관행 — 색상 단독 금지(UIUX §1).
 */
export function DeployScheduleStatusBadge({ status, attemptCount = 0, outcome, delaySeconds }: DeployScheduleStatusBadgeProps): JSX.Element {
  const msg = MESSAGES.deploySchedules.statusBadge;

  if (status === 'PENDING' && attemptCount >= 1) {
    return (
      <span className="deploy-schedule-status-badge deploy-schedule-status-badge--retrying">
        <span aria-hidden="true">↻</span> {msg.PENDING_RETRYING}
      </span>
    );
  }
  if (status === 'SUCCEEDED') {
    const label = outcome === 'NOOP' ? msg.SUCCEEDED_NOOP : outcome === 'RECOVERED' ? msg.SUCCEEDED_RECOVERED : (delaySeconds ?? 0) > 0 ? msg.SUCCEEDED_DELAYED : msg.SUCCEEDED_APPLIED;
    return (
      <span className="deploy-schedule-status-badge deploy-schedule-status-badge--succeeded">
        <span aria-hidden="true">✔</span> {label}
      </span>
    );
  }

  const CONFIG: Record<Exclude<DeployScheduleStatus, 'SUCCEEDED'>, { icon: string; className: string; label: string }> = {
    PENDING: { icon: '○', className: 'pending', label: msg.PENDING },
    RUNNING: { icon: '●', className: 'running', label: msg.RUNNING },
    FAILED: { icon: '✕', className: 'failed', label: msg.FAILED },
    MISSED: { icon: '▲', className: 'missed', label: msg.MISSED },
    HELD: { icon: '▮', className: 'held', label: msg.HELD },
    CANCELLED: { icon: '⊘', className: 'cancelled', label: msg.CANCELLED },
  };
  const cfg = CONFIG[status];
  return (
    <span className={`deploy-schedule-status-badge deploy-schedule-status-badge--${cfg.className}`}>
      <span aria-hidden="true">{cfg.icon}</span> {cfg.label}
    </span>
  );
}
