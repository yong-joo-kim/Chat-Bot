import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { WorkflowOutcome } from '@chat-bot/shared-types';
import { PrismaService } from '../../prisma/prisma.service';
import { openField, DECRYPT_FAILED_TEXT } from '../../common/crypto/field-crypto';

export interface ClaimedRun {
  id: string;
  targetId: string;
  eventType: string;
  sessionRef: string | null;
  createdAt: Date;
  attemptCount: number;
  claimToken: string;
  payloadJson: string;
  /** [신규 — 화면설계 계약 §26 I-1] 보관 봉투 개봉 실패(옛 키 제거·손상) — 송신하지 않는다. */
  decryptFailed: boolean;
}

/**
 * ★ 발송함 상태 전이(`workflowRun.update|updateMany|upsert`) + `workflowTarget` 카운터(3키) 쓰기
 * 유일 파일(No.41, §7 · W-3 · W-4). `openField('WORKFLOW_PAYLOAD'` 개봉도 이 파일에만 있다.
 * 모든 전이는 CAS(`updateMany` + 기대 상태 조건) — 원시 SQL 0.
 */
@Injectable()
export class WorkflowRunStore {
  constructor(private readonly prisma: PrismaService) {}

  /** 선점 CAS — PENDING(nextAttemptAt≤now) → SENDING. count===1인 경우만 발송한다. */
  async claim(id: string, now: Date): Promise<ClaimedRun | null> {
    const token = randomUUID();
    const { count } = await this.prisma.workflowRun.updateMany({
      where: { id, status: 'PENDING', nextAttemptAt: { lte: now } },
      data: { status: 'SENDING', claimToken: token, claimedAt: now, attemptCount: { increment: 1 }, lastAttemptAt: now },
    });
    if (count !== 1) return null;

    const row = await this.prisma.workflowRun.findUnique({
      where: { id },
      select: { targetId: true, eventType: true, sessionRef: true, createdAt: true, attemptCount: true, payload: true },
    });
    if (!row) return null;
    const opened = openField('WORKFLOW_PAYLOAD', id, row.payload) ?? '';
    const decryptFailed = opened === DECRYPT_FAILED_TEXT;
    return {
      id,
      targetId: row.targetId,
      eventType: row.eventType,
      sessionRef: row.sessionRef,
      createdAt: row.createdAt,
      attemptCount: row.attemptCount,
      claimToken: token,
      payloadJson: opened,
      decryptFailed,
    };
  }

  /** 임대 만료 `SENDING` 회수 — 최대 시도 초과면 곧바로 `FAILED(MAX_ATTEMPTS)`로 종결한다. */
  async recoverExpired(id: string, observedClaimToken: string, now: Date, attemptCount: number, maxAttemptsCap: number): Promise<void> {
    if (attemptCount >= maxAttemptsCap) {
      await this.prisma.workflowRun.updateMany({
        where: { id, status: 'SENDING', claimToken: observedClaimToken },
        data: { status: 'FAILED', statusReason: 'MAX_ATTEMPTS', lastOutcome: 'LEASE_EXPIRED', completedAt: now, claimToken: null },
      });
      return;
    }
    await this.prisma.workflowRun.updateMany({
      where: { id, status: 'SENDING', claimToken: observedClaimToken },
      data: { status: 'PENDING', claimToken: null, nextAttemptAt: now, lastOutcome: 'LEASE_EXPIRED' },
    });
  }

  /** 선점 계획이 대상 정지/꺼짐을 재확인했을 때(§7.6 이중 방어). */
  async holdAtClaim(id: string, now: Date): Promise<void> {
    await this.prisma.workflowRun.updateMany({
      where: { id, status: 'PENDING' },
      data: { status: 'HELD', holdReason: 'TARGET', heldAt: now },
    });
  }

  async skipAtClaim(id: string, now: Date): Promise<void> {
    await this.prisma.workflowRun.updateMany({
      where: { id, status: 'PENDING' },
      data: { status: 'SKIPPED', statusReason: 'TARGET_UNAVAILABLE', payload: null, payloadPurgedAt: now, completedAt: now },
    });
  }

  /** 종결 CAS(claimToken 조건) — `count===0`이면 임대를 잃은 것(호출부가 경고 로그만 남긴다). */
  async finalizeSuccess(run: ClaimedRun, now: Date, httpStatus: number, latencyMs: number): Promise<boolean> {
    const deliveryLatencyMs = Math.max(0, now.getTime() - run.createdAt.getTime());
    const { count } = await this.prisma.workflowRun.updateMany({
      where: { id: run.id, status: 'SENDING', claimToken: run.claimToken },
      data: {
        status: 'SUCCEEDED',
        lastOutcome: 'SUCCESS',
        lastHttpStatus: httpStatus,
        lastLatencyMs: latencyMs,
        completedAt: now,
        deliveryLatencyMs,
        firstSentAt: now,
        claimToken: null,
        payload: null,
        payloadPurgedAt: now,
      },
    });
    if (count === 1) await this.bumpTargetSuccess(run.targetId, now);
    return count === 1;
  }

  async finalizeRetry(run: ClaimedRun, now: Date, nextAttemptAt: Date, outcome: WorkflowOutcome, httpStatus: number | undefined): Promise<boolean> {
    const { count } = await this.prisma.workflowRun.updateMany({
      where: { id: run.id, status: 'SENDING', claimToken: run.claimToken },
      data: {
        status: 'PENDING',
        lastOutcome: outcome,
        lastHttpStatus: httpStatus ?? null,
        nextAttemptAt,
        claimToken: null,
        firstSentAt: now,
      },
    });
    if (count === 1) await this.bumpTargetFailure(run.targetId, now);
    return count === 1;
  }

  async finalizePermanent(
    run: ClaimedRun,
    now: Date,
    outcome: WorkflowOutcome | null,
    httpStatus: number | undefined,
    reason: 'PERMANENT_ERROR' | 'MAX_ATTEMPTS' | 'DECRYPT_FAILED',
  ): Promise<boolean> {
    // [신규 — 화면설계 계약 §26 I-1] `DECRYPT_FAILED`는 송신 자체가 없었다 — `firstSentAt`을 채우지 않는다.
    const attempted = reason !== 'DECRYPT_FAILED';
    const { count } = await this.prisma.workflowRun.updateMany({
      where: { id: run.id, status: 'SENDING', claimToken: run.claimToken },
      data: {
        status: 'FAILED',
        statusReason: reason,
        lastOutcome: outcome,
        lastHttpStatus: httpStatus ?? null,
        completedAt: now,
        claimToken: null,
        ...(attempted ? { firstSentAt: now } : {}),
      },
    });
    if (count === 1 && attempted) await this.bumpTargetFailure(run.targetId, now);
    return count === 1;
  }

  private async bumpTargetSuccess(targetId: string, now: Date): Promise<void> {
    await this.prisma.workflowTarget.updateMany({ where: { id: targetId }, data: { consecutiveFailures: 0, lastSuccessAt: now } });
  }

  private async bumpTargetFailure(targetId: string, now: Date): Promise<void> {
    await this.prisma.workflowTarget.updateMany({ where: { id: targetId }, data: { consecutiveFailures: { increment: 1 }, lastFailureAt: now } });
  }

  /** 보류 만료 · 실패 본문 소거(60초마다 1회 — 잡이 호출 간격을 제어한다). */
  async expireOverdueHolds(now: Date, holdMaxMs: number): Promise<number> {
    const cutoff = new Date(now.getTime() - holdMaxMs);
    const { count } = await this.prisma.workflowRun.updateMany({
      where: { status: 'HELD', createdAt: { lt: cutoff } },
      data: { status: 'EXPIRED', statusReason: 'HOLD_EXPIRED', payload: null, payloadPurgedAt: now, completedAt: now },
    });
    return count;
  }

  async purgeFailedPayloads(now: Date, retentionMs: number): Promise<number> {
    const cutoff = new Date(now.getTime() - retentionMs);
    const { count } = await this.prisma.workflowRun.updateMany({
      where: { status: 'FAILED', payload: { not: null }, completedAt: { lt: cutoff } },
      data: { payload: null, payloadPurgedAt: now },
    });
    return count;
  }

  /** 대상 정지/재개(§7.6) — `WorkflowTarget.pausedAt` CAS + 그 대상의 `PENDING → HELD(TARGET)`. */
  async pauseTarget(targetId: string, now: Date): Promise<boolean> {
    const { count } = await this.prisma.workflowTarget.updateMany({ where: { id: targetId, pausedAt: null }, data: { pausedAt: now } });
    if (count === 1) {
      await this.prisma.workflowRun.updateMany({ where: { targetId, status: 'PENDING' }, data: { status: 'HELD', holdReason: 'TARGET', heldAt: now } });
    }
    return count === 1;
  }

  async resumeTarget(targetId: string, now: Date, holdMaxMs: number): Promise<{ resumed: number; expired: number }> {
    const { count } = await this.prisma.workflowTarget.updateMany({ where: { id: targetId, pausedAt: { not: null } }, data: { pausedAt: null } });
    if (count !== 1) return { resumed: 0, expired: 0 };

    const cutoff = new Date(now.getTime() - holdMaxMs);
    const held = await this.prisma.workflowRun.findMany({
      where: { targetId, status: 'HELD', holdReason: 'TARGET' },
      select: { id: true, createdAt: true, subscriptionId: true },
    });
    let resumed = 0;
    let expired = 0;
    for (const row of held) {
      if (row.createdAt < cutoff) {
        await this.prisma.workflowRun.updateMany({
          where: { id: row.id, status: 'HELD' },
          data: { status: 'EXPIRED', statusReason: 'HOLD_EXPIRED', payload: null, payloadPurgedAt: now, completedAt: now },
        });
        expired += 1;
        continue;
      }
      const subPaused = row.subscriptionId ? await this.isSubscriptionPaused(row.subscriptionId) : false;
      if (subPaused) {
        await this.prisma.workflowRun.updateMany({ where: { id: row.id, status: 'HELD' }, data: { holdReason: 'SUBSCRIPTION' } });
        continue;
      }
      await this.prisma.workflowRun.updateMany({ where: { id: row.id, status: 'HELD' }, data: { status: 'PENDING', holdReason: null, heldAt: null, nextAttemptAt: now } });
      resumed += 1;
    }
    return { resumed, expired };
  }

  async pauseSubscription(subscriptionId: string, now: Date): Promise<boolean> {
    const { count } = await this.prisma.workflowSubscription.updateMany({ where: { id: subscriptionId, pausedAt: null }, data: { pausedAt: now } });
    if (count === 1) {
      await this.prisma.workflowRun.updateMany({ where: { subscriptionId, status: 'PENDING' }, data: { status: 'HELD', holdReason: 'SUBSCRIPTION', heldAt: now } });
    }
    return count === 1;
  }

  async resumeSubscription(subscriptionId: string, now: Date, holdMaxMs: number): Promise<{ resumed: number; expired: number }> {
    const { count } = await this.prisma.workflowSubscription.updateMany({ where: { id: subscriptionId, pausedAt: { not: null } }, data: { pausedAt: null } });
    if (count !== 1) return { resumed: 0, expired: 0 };

    const cutoff = new Date(now.getTime() - holdMaxMs);
    const held = await this.prisma.workflowRun.findMany({
      where: { subscriptionId, status: 'HELD', holdReason: 'SUBSCRIPTION' },
      select: { id: true, createdAt: true, targetId: true },
    });
    let resumed = 0;
    let expired = 0;
    for (const row of held) {
      if (row.createdAt < cutoff) {
        await this.prisma.workflowRun.updateMany({
          where: { id: row.id, status: 'HELD' },
          data: { status: 'EXPIRED', statusReason: 'HOLD_EXPIRED', payload: null, payloadPurgedAt: now, completedAt: now },
        });
        expired += 1;
        continue;
      }
      const target = await this.prisma.workflowTarget.findUnique({ where: { id: row.targetId }, select: { pausedAt: true } });
      if (target?.pausedAt) {
        await this.prisma.workflowRun.updateMany({ where: { id: row.id, status: 'HELD' }, data: { holdReason: 'TARGET' } });
        continue;
      }
      await this.prisma.workflowRun.updateMany({ where: { id: row.id, status: 'HELD' }, data: { status: 'PENDING', holdReason: null, heldAt: null, nextAttemptAt: now } });
      resumed += 1;
    }
    return { resumed, expired };
  }

  private async isSubscriptionPaused(subscriptionId: string): Promise<boolean> {
    const sub = await this.prisma.workflowSubscription.findUnique({ where: { id: subscriptionId }, select: { pausedAt: true } });
    return !!sub?.pausedAt;
  }

  /** 대상 삭제(§12.3) — 대기·보류 건을 `CANCELLED(TARGET_DELETED)`로 종결한다(본문 소거). */
  async cancelForTargetDeletion(tx: Prisma.TransactionClient, targetId: string, now: Date): Promise<void> {
    await tx.workflowRun.updateMany({
      where: { targetId, status: { in: ['PENDING', 'HELD'] } },
      data: { status: 'CANCELLED', statusReason: 'TARGET_DELETED', payload: null, payloadPurgedAt: now, completedAt: now },
    });
  }

  /** 재발송(§7.7) — 전건 사전검사는 서비스가 하고, 여기서는 CAS로 실행한다(count가 요청 수와 다르면 경합). */
  async retryManual(ids: readonly string[], now: Date): Promise<number> {
    const { count } = await this.prisma.workflowRun.updateMany({
      where: { id: { in: [...ids] }, status: 'FAILED', payload: { not: null } },
      data: {
        status: 'PENDING',
        attemptCount: 0,
        nextAttemptAt: now,
        statusReason: null,
        completedAt: null,
        manualRetryCount: { increment: 1 },
        lastManualRetryAt: now,
      },
    });
    return count;
  }

  async cancelManual(ids: readonly string[], now: Date): Promise<number> {
    const { count } = await this.prisma.workflowRun.updateMany({
      where: { id: { in: [...ids] }, status: { in: ['PENDING', 'HELD'] } },
      data: { status: 'CANCELLED', statusReason: 'MANUAL', payload: null, payloadPurgedAt: now, completedAt: now },
    });
    return count;
  }
}
