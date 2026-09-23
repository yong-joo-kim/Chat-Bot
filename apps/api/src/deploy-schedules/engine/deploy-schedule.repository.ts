import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { DEPLOY_SCHEDULE_LIMITS } from '@chat-bot/shared-types';
import type { DeployScheduleFailureReason, DeployScheduleHeldReason, DeployScheduleOutcome, DeployScheduleResultSummary, DeployScheduleTransientReason } from '@chat-bot/shared-types';
import { PrismaService } from '../../prisma/prisma.service';
import { isBusyError } from '../../common/prisma/busy-error';
import { secondsBetween } from '../../common/polling/lease';
import { successorsToHold } from '../lib/chain-rules';

/** 부분 유니크②(`deploy_schedules_chatbotId_running_key` — 챗봇당 RUNNING 최대 1건) 위반 판별(§7.3). */
function isUniqueConstraintViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002';
}

export type FinalizeInput =
  | { kind: 'SUCCEEDED'; outcome: DeployScheduleOutcome; summary: DeployScheduleResultSummary; testRunId?: string }
  | { kind: 'PENDING_RETRY'; lastTransientReason: DeployScheduleTransientReason }
  | { kind: 'FAILED'; failureReason: DeployScheduleFailureReason };

/**
 * [신규 2026-09-23 No.28] 엔진의 상태 전이 쓰기 전부(§4.3) — CAS 선점·종결·재시도 복귀·MISSED·HELD 전파·
 * 임대 회수. `prisma.deploySchedule.*` 쓰기 호출이 `deploy-schedule.service.ts`와 함께 허용되는
 * 2파일 중 하나다(§16 D-1). 트랜잭션 콜백 안에서 `Promise.all`을 쓰지 않는다(§16 D-14).
 */
@Injectable()
export class DeployScheduleRepository {
  private readonly logger = new Logger('DeployScheduleRepository');

  constructor(private readonly prisma: PrismaService) {}

  /** PENDING → RUNNING(CAS). 영향 행 1이면 토큰 반환, 0이면 다른 인스턴스가 가져갔거나 상태가 바뀜. */
  async claim(id: string, expectAttemptCount: number, scheduledAt: Date, now: Date): Promise<string | null> {
    const token = randomUUID();
    const first = expectAttemptCount === 0;
    try {
      const { count } = await this.prisma.deploySchedule.updateMany({
        where: { id, status: 'PENDING', attemptCount: expectAttemptCount },
        data: {
          status: 'RUNNING',
          claimToken: token,
          claimedAt: now,
          attemptCount: { increment: 1 },
          lastAttemptAt: now,
          ...(first ? { startedAt: now, delaySeconds: secondsBetween(scheduledAt, now) } : {}),
        },
      });
      return count === 1 ? token : null;
    } catch (e) {
      // 부분 유니크②(챗봇당 RUNNING 최대 1건) 위반 — 같은 챗봇의 다른 예약이 먼저 RUNNING이 됐다는
      // 뜻이다. 선점 실패로 간주하고 건너뛴다(§7.3 의사코드, code-review 1라운드 L1).
      if (isBusyError(e) || isUniqueConstraintViolation(e)) return null; // 다음 tick에서 재시도
      throw e;
    }
  }

  /** RUNNING(claimToken 관측값) → 회수 토큰으로 교체(CAS). count 1인 인스턴스만 판정 권한을 갖는다. */
  async reclaim(id: string, observedClaimToken: string, leaseMs: number, now: Date): Promise<string | null> {
    const newToken = randomUUID();
    try {
      const { count } = await this.prisma.deploySchedule.updateMany({
        where: { id, status: 'RUNNING', claimToken: observedClaimToken, claimedAt: { lt: new Date(now.getTime() - leaseMs) } },
        data: { claimToken: newToken },
      });
      return count === 1 ? newToken : null;
    } catch (e) {
      if (isBusyError(e) || isUniqueConstraintViolation(e)) return null;
      throw e;
    }
  }

  /** RUNNING(claimToken) → 종결. FAILED면 같은 트랜잭션에서 후속 PENDING을 HELD로 전파한다(§7.7). */
  async finalize(id: string, claimToken: string, input: FinalizeInput, now: Date): Promise<'OK' | 'LOST_LEASE'> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const row = await tx.deploySchedule.findFirst({ where: { id, status: 'RUNNING', claimToken }, select: { chatbotId: true, scheduledAt: true } });
        if (!row) return 'LOST_LEASE' as const;

        if (input.kind === 'SUCCEEDED') {
          await tx.deploySchedule.updateMany({
            where: { id, status: 'RUNNING', claimToken },
            data: {
              status: 'SUCCEEDED',
              outcome: input.outcome,
              resultSummary: JSON.stringify(input.summary),
              finishedAt: now,
              claimToken: null,
              ...(input.testRunId ? { testRunId: input.testRunId } : {}),
            },
          });
          return 'OK' as const;
        }

        if (input.kind === 'PENDING_RETRY') {
          await tx.deploySchedule.updateMany({
            where: { id, status: 'RUNNING', claimToken },
            data: { status: 'PENDING', lastTransientReason: input.lastTransientReason, claimToken: null },
          });
          return 'OK' as const;
        }

        // FAILED
        await tx.deploySchedule.updateMany({
          where: { id, status: 'RUNNING', claimToken },
          data: { status: 'FAILED', failureReason: input.failureReason, finishedAt: now, claimToken: null },
        });
        await this.holdSuccessorsWithin(tx, row.chatbotId, row.scheduledAt, now, 'PREDECESSOR_FAILED', id);
        return 'OK' as const;
      });
    } catch (e) {
      if (isBusyError(e)) return 'LOST_LEASE';
      throw e;
    }
  }

  /** PENDING(attemptCount:0) → MISSED. 후속 PENDING 전부(동작 무관) → HELD(PREDECESSOR_MISSED). */
  async markMissed(id: string, scheduledAt: Date, delaySeconds: number, now: Date): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.deploySchedule.updateMany({
        where: { id, status: 'PENDING', attemptCount: 0 },
        data: { status: 'MISSED', finishedAt: now, delaySeconds, startedAt: now },
      });
      if (count === 0) return;
      const row = await tx.deploySchedule.findUnique({ where: { id }, select: { chatbotId: true } });
      if (row) await this.holdSuccessorsWithin(tx, row.chatbotId, scheduledAt, now, 'PREDECESSOR_MISSED', id);
    });
  }

  /** PENDING(attemptCount:expect) → FAILED(BLOCKED_TOO_LONG). 재시도 창을 넘겨 종결하는 추가 간선(§21 D-5). */
  async expireRetry(id: string, expectAttemptCount: number, scheduledAt: Date, now: Date): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.deploySchedule.updateMany({
        where: { id, status: 'PENDING', attemptCount: expectAttemptCount },
        data: { status: 'FAILED', failureReason: 'BLOCKED_TOO_LONG', finishedAt: now },
      });
      if (count === 0) return;
      const row = await tx.deploySchedule.findUnique({ where: { id }, select: { chatbotId: true } });
      if (row) await this.holdSuccessorsWithin(tx, row.chatbotId, scheduledAt, now, 'PREDECESSOR_FAILED', id);
    });
  }

  /** 도래한 PENDING이 앞선 HELD 뒤에 있으면 그 자체를 HELD(PREDECESSOR_HELD)로 바꾼다(전파 없음, 단건). */
  async holdBehindHeld(id: string, heldByScheduleId: string, now: Date): Promise<void> {
    await this.prisma.deploySchedule.updateMany({
      where: { id, status: 'PENDING' },
      data: { status: 'HELD', heldReason: 'PREDECESSOR_HELD', heldByScheduleId, heldAt: now },
    });
  }

  /** service.cancel()이 RESTORE_VERSION 취소 시 호출한다(R6) — 후속 PENDING RESTORE_VERSION만 대상. */
  async holdRestoreSuccessorsOnCancel(tx: Prisma.TransactionClient, chatbotId: string, cancelledScheduledAt: Date, now: Date, cancelledId: string): Promise<void> {
    await this.holdSuccessorsWithin(tx, chatbotId, cancelledScheduledAt, now, 'PREDECESSOR_CANCELLED', cancelledId, { restoreOnly: true });
  }

  private async holdSuccessorsWithin(
    tx: Prisma.TransactionClient,
    chatbotId: string,
    triggerScheduledAt: Date,
    now: Date,
    heldReason: DeployScheduleHeldReason,
    heldByScheduleId: string,
    opts: { restoreOnly?: boolean } = {},
  ): Promise<void> {
    const pendingRows = await tx.deploySchedule.findMany({
      where: { chatbotId, status: 'PENDING', scheduledAt: { gt: triggerScheduledAt } },
      select: { id: true, action: true, scheduledAt: true },
      take: DEPLOY_SCHEDULE_LIMITS.maxActivePerChatbot + 5,
    });
    const ids = successorsToHold(
      pendingRows.map((r) => ({ id: r.id, action: r.action as never, scheduledAt: r.scheduledAt })),
      triggerScheduledAt,
      opts,
    );
    if (ids.length === 0) return;
    await tx.deploySchedule.updateMany({
      where: { id: { in: ids }, status: 'PENDING' },
      data: { status: 'HELD', heldReason, heldByScheduleId, heldAt: now },
    });
  }
}
