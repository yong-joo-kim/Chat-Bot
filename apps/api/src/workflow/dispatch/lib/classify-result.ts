import type { WorkflowOutcome } from '@chat-bot/shared-types';

export type ClassifyDecision =
  | { kind: 'SUCCESS' }
  | { kind: 'RETRY'; outcome: WorkflowOutcome; httpStatus?: number; retryAfterMs?: number }
  | { kind: 'PERMANENT'; outcome: WorkflowOutcome; httpStatus?: number };

/** [신규 No.41] 결과 분류(§7.4) — 순수. */
export function classifyHttpStatus(status: number, retryAfterMs: number | null): ClassifyDecision {
  if (status >= 200 && status < 300) return { kind: 'SUCCESS' };
  if (status === 408 || status === 425 || status === 429 || (status >= 500 && status < 600)) {
    return { kind: 'RETRY', outcome: 'HTTP_ERROR', httpStatus: status, ...(retryAfterMs ? { retryAfterMs } : {}) };
  }
  return { kind: 'PERMANENT', outcome: 'HTTP_ERROR', httpStatus: status };
}

export function classifyTransportOutcome(outcome: WorkflowOutcome): Extract<ClassifyDecision, { kind: 'RETRY' } | { kind: 'PERMANENT' }> {
  if (outcome === 'TIMEOUT' || outcome === 'NETWORK_ERROR') return { kind: 'RETRY', outcome };
  // REDIRECT_NOT_ALLOWED · BLOCKED_ADDRESS · EGRESS_BLOCKED · SECRET_MISSING · TARGET_HOST_MISMATCH ·
  // INVALID_TARGET_URL — 전부 발송 전 차단(송신 0) · 영구 실패(§7.4).
  return { kind: 'PERMANENT', outcome };
}
