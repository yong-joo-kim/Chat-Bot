import type { ProdSwitchApprovalSummary } from '@chat-bot/shared-types';
import { MESSAGES } from '../constants/messages';
import { ApiError } from '../api/client';
import { formatDateTime } from './date';

/** 승인 상태 글자의 톤(색은 보조 — 글자가 항상 병기된다, UIUX §1). */
export type ApprovalTone = 'INFO' | 'SUCCESS' | 'WARNING' | 'ERROR' | 'NEUTRAL';

export interface ApprovalStatusView {
  label: string;
  tone: ApprovalTone;
  /** 반려 메모(있을 때만). */
  note?: string;
}

/** `failureCode` → 화면 글자(§13.3). 모르는 코드는 "알 수 없는 사유". */
export function failureCodeLabel(code: string | null): string {
  const map = MESSAGES.switchApproval.failureCode as Record<string, string>;
  return (code && map[code]) || map.unknown;
}

/** 요청 상태 → 글자 + 톤(ui-spec §9.5 표). */
export function approvalStatusView(req: Pick<ProdSwitchApprovalSummary, 'status' | 'outcome' | 'closedReason' | 'failureCode' | 'decisionNote' | 'executedAt'>): ApprovalStatusView {
  const s = MESSAGES.switchApproval.status;
  switch (req.status) {
    case 'PENDING':
      return { label: s.PENDING, tone: 'INFO' };
    case 'APPROVED':
      if (req.outcome === 'APPLIED') return { label: s.APPROVED_APPLIED, tone: 'SUCCESS' };
      if (req.outcome === 'SCHEDULED') return req.executedAt ? { label: s.APPROVED_SCHEDULED_DONE, tone: 'SUCCESS' } : { label: s.APPROVED_SCHEDULED, tone: 'INFO' };
      if (req.outcome === 'FAILED') return { label: s.APPROVED_FAILED(failureCodeLabel(req.failureCode)), tone: 'ERROR' };
      if (req.outcome === 'NOOP') return { label: s.APPROVED_NOOP, tone: 'INFO' };
      return { label: s.APPROVED, tone: 'INFO' };
    case 'REJECTED':
      return { label: s.REJECTED, tone: 'NEUTRAL', note: req.decisionNote ? s.rejectedNote(req.decisionNote) : undefined };
    case 'CANCELLED':
      switch (req.closedReason) {
        case 'REQUESTER':
          return { label: s.CANCELLED_REQUESTER, tone: 'NEUTRAL' };
        case 'POLICY_OFF':
          return { label: s.CANCELLED_POLICY_OFF, tone: 'NEUTRAL' };
        case 'BASE_CHANGED':
          return { label: s.CANCELLED_BASE_CHANGED, tone: 'WARNING' };
        case 'SCHEDULE_INACTIVE':
          return { label: s.CANCELLED_SCHEDULE_INACTIVE, tone: 'NEUTRAL' };
        default:
          return { label: s.CANCELLED, tone: 'NEUTRAL' };
      }
    case 'EXPIRED':
      return { label: s.EXPIRED, tone: 'WARNING' };
    default:
      return { label: req.status, tone: 'NEUTRAL' };
  }
}

/** 동작 글자(예약 전환은 예약 시각을 붙인다). */
export function approvalActionLabel(req: Pick<ProdSwitchApprovalSummary, 'action' | 'scheduledAt'>): string {
  const a = MESSAGES.switchApproval.action;
  if (req.action === 'SCHEDULED_PROD_SWITCH' && req.scheduledAt) return a.scheduled(formatDateTime(req.scheduledAt));
  return a[req.action];
}

/** "대상 ← 기준"(예: `v13 ← v12`). */
export function approvalVersionArrow(req: Pick<ProdSwitchApprovalSummary, 'target' | 'base'>): string {
  return `v${req.target.versionNo} ← v${req.base.versionNo}`;
}

/** 요청 한 줄 요약(취소 확인 대화상자 등). */
export function approvalSummaryText(req: Pick<ProdSwitchApprovalSummary, 'action' | 'scheduledAt' | 'target' | 'base'>): string {
  return `${approvalActionLabel(req)}: ${approvalVersionArrow(req)}`;
}

/** 남은 시간(분, 올림). 이미 지났으면 0 이하. */
export function remainingMinutes(expiresAt: Date | string, now: Date): number {
  const ms = new Date(expiresAt).getTime() - now.getTime();
  return Math.ceil(ms / 60_000);
}

/** 만료까지 10분 미만이면 "곧 만료"로 본다(§9.6). */
export const EXPIRING_SOON_MINUTES = 10;

export interface ApprovalErrorView {
  /** 화면에 보일 문구. */
  text: string;
  /** 분기용 종류(재조회·배너 위치 결정). */
  kind:
    | 'APPROVAL_REQUIRED'
    | 'POLICY_ACTIVE'
    | 'SELF_FORBIDDEN'
    | 'NOT_PENDING'
    | 'BASE_CHANGED'
    | 'PENDING_EXISTS'
    | 'POLICY_UNAVAILABLE'
    | 'APPLY_FAILED'
    | 'STALE'
    | 'BUSY'
    | 'ACK_REQUIRED'
    | 'FORBIDDEN'
    | 'NOT_FOUND'
    | 'OTHER';
  /** `APPROVAL_PENDING_EXISTS`의 대기 요청 id. */
  requestId?: string;
  /** `APPROVAL_POLICY_UNAVAILABLE`·`ENV_APPROVAL_REQUIRED`의 reason. */
  reason?: string;
}

function detailValue(e: ApiError, field: string): string | undefined {
  return e.details?.find((d) => d.field === field)?.message;
}

/** 승인 관련 오류를 화면 문구로 옮긴다(ui-spec §13.2). `ctx`는 같은 코드라도 위치별로 문구가 달라지는 경우. */
export function approvalErrorView(e: unknown, ctx: 'REQUEST' | 'APPROVE' | 'REJECT' | 'CANCEL' | 'POLICY' | 'SCHEDULE_REQUEST' = 'REQUEST'): ApprovalErrorView {
  const m = MESSAGES.switchApproval.errors;
  if (!(e instanceof ApiError)) return { text: m.generic, kind: 'OTHER' };
  switch (e.code) {
    case 'ENV_APPROVAL_REQUIRED': {
      const reason = detailValue(e, 'reason');
      if (reason === 'POLICY_ACTIVE') return { text: m.POLICY_ACTIVE, kind: 'POLICY_ACTIVE', reason };
      if (reason === 'OFF_LOCKED') return { text: m.OFF_LOCKED, kind: 'POLICY_UNAVAILABLE', reason };
      return { text: m.APPROVAL_REQUIRED, kind: 'APPROVAL_REQUIRED', reason };
    }
    case 'APPROVAL_SELF_FORBIDDEN':
      return { text: m.SELF_FORBIDDEN, kind: 'SELF_FORBIDDEN' };
    case 'APPROVAL_NOT_PENDING': {
      const status = detailValue(e, 'status');
      const text =
        status === 'APPROVED' ? m.NOT_PENDING_APPROVED : status === 'REJECTED' ? m.NOT_PENDING_REJECTED : status === 'CANCELLED' ? m.NOT_PENDING_CANCELLED : status === 'EXPIRED' ? m.NOT_PENDING_EXPIRED : m.NOT_PENDING;
      return { text, kind: 'NOT_PENDING' };
    }
    case 'APPROVAL_BASE_CHANGED':
      return { text: m.BASE_CHANGED, kind: 'BASE_CHANGED' };
    case 'APPROVAL_PENDING_EXISTS':
      return { text: m.PENDING_EXISTS, kind: 'PENDING_EXISTS', requestId: detailValue(e, 'requestId') };
    case 'APPROVAL_POLICY_UNAVAILABLE': {
      const reason = detailValue(e, 'reason');
      const text =
        reason === 'ENV_MODE_DISABLED'
          ? m.ENV_MODE_DISABLED
          : reason === 'NOT_ENOUGH_APPROVERS'
            ? m.NOT_ENOUGH_APPROVERS
            : reason === 'OFF_LOCKED'
              ? m.OFF_LOCKED
              : reason === 'NOT_REQUIRED'
                ? m.NOT_REQUIRED
                : e.message;
      return { text, kind: 'POLICY_UNAVAILABLE', reason };
    }
    case 'ENV_POINTER_STALE':
      return { text: m.ENV_POINTER_STALE, kind: 'STALE' };
    case 'ENV_SWITCH_BUSY':
      return { text: m.ENV_SWITCH_BUSY, kind: 'BUSY' };
    case 'ENV_GATE_NOT_PASSED':
      return applyFailed(e, m.ENV_GATE_NOT_PASSED);
    case 'ENV_TARGET_NOT_STAGING':
      return applyFailed(e, m.ENV_TARGET_NOT_STAGING);
    case 'CHATBOT_ARCHIVED':
    case 'ENV_MODE_DISABLED':
      return applyFailed(e, m.ARCHIVED_OR_OFF_APPLY);
    case 'VALIDATION_FAILED':
      return { text: m.ackRequired, kind: 'ACK_REQUIRED' };
    case 'FORBIDDEN':
      if (ctx === 'CANCEL') return { text: m.CANCEL_NOT_REQUESTER, kind: 'FORBIDDEN' };
      if (ctx === 'SCHEDULE_REQUEST') return { text: m.SCHEDULE_NOT_CREATOR, kind: 'FORBIDDEN' };
      return { text: e.message, kind: 'FORBIDDEN' };
    case 'NOT_FOUND':
      // 승인 뒤 적용 실패의 404("대상 버전 없음")는 요청 상태가 함께 실려 오면 적용 실패 문구를 쓴다.
      if (detailValue(e, 'requestStatus') === 'APPROVED') return { text: m.NOT_FOUND_APPLY, kind: 'APPLY_FAILED' };
      return { text: m.REQUEST_NOT_FOUND, kind: 'NOT_FOUND' };
    default:
      // 403(코드 없음)도 취소 위치에서는 같은 문구를 쓴다.
      if (e.status === 403 && ctx === 'CANCEL') return { text: m.CANCEL_NOT_REQUESTER, kind: 'FORBIDDEN' };
      if (e.status === 403 && ctx === 'SCHEDULE_REQUEST') return { text: m.SCHEDULE_NOT_CREATOR, kind: 'FORBIDDEN' };
      if (e.status === 404) return { text: m.REQUEST_NOT_FOUND, kind: 'NOT_FOUND' };
      return { text: m.generic, kind: 'OTHER' };
  }
}

/** 승인 뒤 적용 실패(`requestStatus=APPROVED`)면 적용 실패 문구, 아니면 일반 오류 문구를 쓴다. */
function applyFailed(e: ApiError, applyText: string): ApprovalErrorView {
  if (detailValue(e, 'requestStatus') === 'APPROVED') return { text: applyText, kind: 'APPLY_FAILED' };
  // 요청 생성·기존 전환 경로의 같은 코드는 기존 화면 문구(서버 message)를 그대로 쓴다.
  const legacy = MESSAGES.environment.errors as Record<string, string>;
  return { text: legacy[e.code ?? ''] ?? e.message ?? applyText, kind: 'OTHER' };
}
