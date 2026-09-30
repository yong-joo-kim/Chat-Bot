import type { ProdSwitchApprovalClosedReason } from '@chat-bot/shared-types';

/**
 * [신규 No.36] 운영 전환 승인 요청의 유효 상태 판정 순수 함수(ai-guardrails-설계.md §10.3) — 루프 없이 **조회·변경 시점**에
 * 계산한다(NFR-AGR3). DB·Nest 무의존.
 */

export interface PendingRequestFacts {
  action: string;
  expiresAt: Date;
  /** 요청 시점의 운영 버전(예약 요청은 예약의 기준 버전). */
  baseProdVersionId: string;
  deployScheduleId: string | null;
  targetVersionId: string;
}

export interface EffectiveContext {
  policyRequired: boolean;
  /** 지금의 운영 포인터(모드 꺼짐 = null). */
  currentProdVersionId: string | null;
  /** 예약 요청일 때만 — 예약이 없으면 `null`. */
  schedule: { status: string; scheduledAt: Date; targetVersionId: string | null; expectedProdVersionId: string | null } | null;
}

export type EffectiveVerdict =
  | { kind: 'PENDING' }
  | { kind: 'EXPIRED' }
  | { kind: 'CANCELLED'; closedReason: Extract<ProdSwitchApprovalClosedReason, 'POLICY_OFF' | 'BASE_CHANGED' | 'SCHEDULE_INACTIVE'> };

/**
 * 대기(`PENDING`) 요청의 유효 상태. 순서: 정책 끔 → 만료 → 기준 변경·예약 비활성.
 * 즉시 요청(`PROD_SWITCH`·`PROD_ROLLBACK`)은 운영 포인터가 요청 시점 기준과 달라지면 `BASE_CHANGED`, 예약 요청은 예약이
 * 없거나 대기·보류가 아니거나 시각이 지났거나 대상·기준이 달라지면 `SCHEDULE_INACTIVE`(기준이 달라진 경우는 `BASE_CHANGED`).
 */
export function effectiveVerdict(row: PendingRequestFacts, now: Date, ctx: EffectiveContext): EffectiveVerdict {
  if (!ctx.policyRequired) return { kind: 'CANCELLED', closedReason: 'POLICY_OFF' };
  if (now.getTime() >= row.expiresAt.getTime()) return { kind: 'EXPIRED' };

  if (row.action === 'SCHEDULED_PROD_SWITCH') {
    const schedule = ctx.schedule;
    if (!schedule || (schedule.status !== 'PENDING' && schedule.status !== 'HELD') || schedule.scheduledAt.getTime() <= now.getTime()) {
      return { kind: 'CANCELLED', closedReason: 'SCHEDULE_INACTIVE' };
    }
    if (schedule.targetVersionId !== row.targetVersionId || schedule.expectedProdVersionId !== row.baseProdVersionId) {
      return { kind: 'CANCELLED', closedReason: 'BASE_CHANGED' };
    }
    return { kind: 'PENDING' };
  }

  if (ctx.currentProdVersionId !== row.baseProdVersionId) return { kind: 'CANCELLED', closedReason: 'BASE_CHANGED' };
  return { kind: 'PENDING' };
}

/** 만료 시각 — 예약 요청은 `min(요청 + TTL, 예약 시각)`(R-22 · 예약 시각 뒤 승인은 의미 없다). */
export function computeExpiresAt(now: Date, ttlHours: number, scheduledAt?: Date | null): Date {
  const byTtl = new Date(now.getTime() + ttlHours * 3_600_000);
  if (scheduledAt && scheduledAt.getTime() < byTtl.getTime()) return scheduledAt;
  return byTtl;
}

/** 승인·반려 가능 여부 — 대기 중이고 요청자가 아닐 때(서버가 다시 강제한다). */
export function canDecide(status: string, requestedById: string, actorId: string): boolean {
  return status === 'PENDING' && requestedById !== actorId;
}
