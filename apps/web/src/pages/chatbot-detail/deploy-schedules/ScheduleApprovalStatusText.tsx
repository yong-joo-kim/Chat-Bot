import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { ApprovalPolicyStatus, ProdSwitchApprovalSummary } from '@chat-bot/shared-types';
import { switchApprovalsApi } from '../../../api/switchApprovals';
import { useToast } from '../../../components/Toast';
import { useAuth } from '../../../context/AuthContext';
import { MESSAGES } from '../../../constants/messages';
import { approvalErrorView, approvalStatusView } from '../../../lib/approvalText';
import { formatDateTime } from '../../../lib/date';
import { ApprovalToneBadge } from '../environment/approval/ApprovalStatusText';

/** 매칭 결과(§9.10 표). */
export type ScheduleApprovalMatch =
  | { kind: 'PENDING'; request: ProdSwitchApprovalSummary }
  | { kind: 'APPROVED'; request: ProdSwitchApprovalSummary }
  | { kind: 'CLOSED'; request: ProdSwitchApprovalSummary }
  | { kind: 'REQUIRED' }
  | { kind: 'UNKNOWN' }
  | { kind: 'NONE' };

/** `recent` 20건이 가득 차 있으면 더 오래된 요청이 잘렸을 수 있다(서버 상한 — `ApprovalPolicyStatus.recent`). */
const RECENT_LIMIT = 20;

/**
 * 예약 1건과 승인 정책 조회 결과(`pending`·`recent`)를 `deployScheduleId`로 맞춘다. 전역 예약 목록은 챗봇마다 승인을 조회하지 않으므로
 * 이 함수를 쓰지 않는다(조정 A-7). 예약 항목에 `approvalState`는 없다(서버 미제공) — 합성만 한다.
 */
export function matchScheduleApproval(
  item: { id: string; status: string; scheduledAt: Date | string },
  policy: ApprovalPolicyStatus | null,
  now: Date = new Date(),
): ScheduleApprovalMatch {
  if (!policy || !policy.policy.required) return { kind: 'NONE' };
  if (policy.pending?.deployScheduleId === item.id) return { kind: 'PENDING', request: policy.pending };
  const found = policy.recent.find((r) => r.deployScheduleId === item.id);
  if (found) {
    if (found.status === 'APPROVED' && (found.outcome === 'SCHEDULED' || found.outcome === null)) return { kind: 'APPROVED', request: found };
    return { kind: 'CLOSED', request: found };
  }
  if (item.status === 'PENDING' || item.status === 'HELD') {
    // 예약 시각이 아직 미래이고 최근 목록이 가득 찼으면 "없음"으로 단정하지 않는다(잘린 요청일 수 있다).
    if (policy.recent.length >= RECENT_LIMIT && new Date(item.scheduledAt).getTime() > now.getTime()) return { kind: 'UNKNOWN' };
    return { kind: 'REQUIRED' };
  }
  return { kind: 'NONE' };
}

export interface ScheduleApprovalStatusTextProps {
  chatbotId: string;
  scheduleId: string;
  createdByEmail: string;
  match: ScheduleApprovalMatch;
  /** 요청을 보낸 뒤 목록·정책을 다시 조회한다. */
  onSent: () => void;
}

/**
 * 예약 행·상세의 승인 상태 글자 + 행 버튼(§9.10). 승인 요청은 예약을 만든 사람만 보낼 수 있다(서버도 403).
 * 색 단독이 아니라 항상 글자가 병기된다.
 */
export function ScheduleApprovalStatusText({ chatbotId, scheduleId, createdByEmail, match, onSent }: ScheduleApprovalStatusTextProps): JSX.Element | null {
  const m = MESSAGES.switchApproval.schedule;
  const { user, can } = useAuth();
  const { showToast } = useToast();
  const [sending, setSending] = useState(false);
  const isCreator = Boolean(user && user.email === createdByEmail);
  const canSend = isCreator && can('chatbot:deploy');

  async function send(): Promise<void> {
    if (sending) return;
    setSending(true);
    try {
      await switchApprovalsApi.createRequest(chatbotId, { action: 'SCHEDULED_PROD_SWITCH', deployScheduleId: scheduleId });
      showToast(m.requestSent);
      onSent();
    } catch (e) {
      showToast(approvalErrorView(e, 'SCHEDULE_REQUEST').text);
    } finally {
      setSending(false);
    }
  }

  const sendButton = (label: string): JSX.Element | null =>
    canSend ? (
      <button type="button" className="btn btn-secondary" onClick={() => void send()} disabled={sending}>
        {sending ? m.requesting : label}
      </button>
    ) : null;

  if (match.kind === 'NONE') return null;
  if (match.kind === 'PENDING') {
    return (
      <span className="schedule-approval-status">
        <ApprovalToneBadge tone="INFO" label={m.rowPending(formatDateTime(match.request.expiresAt))} />{' '}
        <Link to={`/environment-approvals/${chatbotId}/${match.request.id}`}>{m.rowViewRequest}</Link>
      </span>
    );
  }
  if (match.kind === 'APPROVED') {
    return (
      <span className="schedule-approval-status">
        <ApprovalToneBadge tone="SUCCESS" label={m.rowApproved} />
      </span>
    );
  }
  if (match.kind === 'CLOSED') {
    const label =
      match.request.status === 'REJECTED' ? m.closedRejected : match.request.status === 'EXPIRED' ? m.closedExpired : match.request.status === 'CANCELLED' ? m.closedCancelled : approvalStatusView(match.request).label;
    return (
      <span className="schedule-approval-status">
        <ApprovalToneBadge tone="WARNING" label={m.rowClosed(label)} /> {sendButton(m.rowResend)}
      </span>
    );
  }
  if (match.kind === 'UNKNOWN') {
    return (
      <span className="schedule-approval-status">
        <ApprovalToneBadge tone="INFO" label={m.rowUnknown} />
      </span>
    );
  }
  return (
    <span className="schedule-approval-status">
      <ApprovalToneBadge tone="WARNING" label={m.rowRequired} /> {sendButton(m.rowSend)}
    </span>
  );
}
