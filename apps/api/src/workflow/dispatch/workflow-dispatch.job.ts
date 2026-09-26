import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { WorkflowEventType, WorkflowOutcome } from '@chat-bot/shared-types';
import { PrismaService } from '../../prisma/prisma.service';
import { CLOCK } from '../../common/polling/clock';
import type { Clock } from '../../common/polling/clock';
import { PollingLoop } from '../../common/polling/polling-loop';
import { isLeaseExpired } from '../../common/polling/lease';
import { WorkflowRunStore } from '../core/workflow-run.store';
import { workflowHoldMaxMs } from '../lib/hold-max';
import { WorkflowHttpSender } from './workflow-http.sender';
import { planClaims } from './lib/claim-plan';
import type { ClaimCandidate, TargetState } from './lib/claim-plan';
import { classifyHttpStatus, classifyTransportOutcome } from './lib/classify-result';
import { computeBackoffMs, parseBackoffSchedule } from './lib/backoff';
import { parseRetryAfterMs } from './lib/retry-after';

/**
 * [코드 리뷰 R1 M-2] 백오프 지터 난수 주입 지점 — `CLOCK` 토큰과 같은 패턴(§7.2 "시계·난수를 주입받는다").
 * 운영은 `workflow.module.ts`가 `Math.random`을 바인딩한다. 시험은 이 토큰을 오버라이드해 지터를
 * 결정적으로 고정한다(예: `() => 0` · `() => 1`).
 */
export const WORKFLOW_RANDOM = 'WORKFLOW_RANDOM';

interface CandidateRow {
  id: string;
  status: string;
  targetId: string;
  claimToken: string | null;
  attemptCount: number;
  claimedAt: Date | null;
}

/**
 * [신규 No.41] 발송 루프(§7) — `PollingLoop`(기본 5초) 소비자. `tick()`은 public(시험이 직접 호출).
 * `WORKFLOW_ENABLED ∧ WORKFLOW_DISPATCH_ENABLED`일 때만 가동한다(발송 전담 인스턴스 지정 가능).
 */
@Injectable()
export class WorkflowDispatchJob implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('WorkflowDispatchJob');
  private readonly loop: PollingLoop;
  private tickCounter = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly store: WorkflowRunStore,
    private readonly sender: WorkflowHttpSender,
    @Inject(CLOCK) private readonly clock: Clock,
    // [코드 리뷰 R1 M-2] 선택 주입 — 미등록이면 `Math.random`(운영 기본값, `workflow.module.ts`가 등록).
    @Optional() @Inject(WORKFLOW_RANDOM) private readonly random: () => number = Math.random,
  ) {
    this.loop = new PollingLoop({
      name: 'workflow-dispatch',
      intervalMs: this.intervalMs(),
      onTick: () => this.tick(),
      logger: this.logger,
    });
  }

  private enabled(): boolean {
    return (this.config.get<boolean>('WORKFLOW_ENABLED') ?? true) && (this.config.get<boolean>('WORKFLOW_DISPATCH_ENABLED') ?? true);
  }
  private intervalMs(): number {
    return this.config.get<number>('WORKFLOW_DISPATCH_INTERVAL_MS') ?? 5000;
  }
  private leaseMs(): number {
    return this.config.get<number>('WORKFLOW_CLAIM_LEASE_MS') ?? 60000;
  }
  private batch(): number {
    return this.config.get<number>('WORKFLOW_DISPATCH_BATCH') ?? 20;
  }
  private maxAttemptsCap(): number {
    return this.config.get<number>('WORKFLOW_MAX_ATTEMPTS_CAP') ?? 10;
  }
  private backoffSchedule(): number[] {
    return parseBackoffSchedule(this.config.get<string>('WORKFLOW_BACKOFF_SCHEDULE') ?? '30s,2m,10m,30m,2h');
  }
  private holdMaxMs(): number {
    return workflowHoldMaxMs(this.config);
  }
  private failedRetentionMs(): number {
    return (this.config.get<number>('WORKFLOW_FAILED_PAYLOAD_RETENTION_DAYS') ?? 7) * 86_400_000;
  }

  async onApplicationBootstrap(): Promise<void> {
    if (!this.enabled()) {
      this.logger.log('WORKFLOW_DISPATCH_ENABLED=false — 이 인스턴스에서 발송 루프를 가동하지 않습니다.');
      return;
    }
    this.loop.start();
  }

  async onModuleDestroy(): Promise<void> {
    await this.loop.stop(30_000);
  }

  /** 시험은 이 메서드를 직접 호출한다(루프는 시험 환경에서 꺼져 있다 — CLAUDE.md). */
  async tick(): Promise<void> {
    const now = this.clock.now();
    const leaseMs = this.leaseMs();
    const batch = this.batch();
    this.tickCounter += 1;
    const runMaintenanceThisTick = this.tickCounter % 12 === 0;

    const candidates = await this.prisma.workflowRun.findMany({
      where: {
        OR: [
          { status: 'PENDING', nextAttemptAt: { lte: now } },
          { status: 'SENDING', claimedAt: { lt: new Date(now.getTime() - leaseMs) } },
        ],
      },
      orderBy: { nextAttemptAt: 'asc' },
      take: batch * 2,
      select: { id: true, status: true, targetId: true, claimToken: true, attemptCount: true, claimedAt: true },
    });

    if (candidates.length === 0) {
      if (runMaintenanceThisTick) await this.runMaintenance(now);
      return;
    }

    const pending: CandidateRow[] = [];
    const expiredSending: CandidateRow[] = [];
    for (const c of candidates) {
      if (c.status === 'SENDING' && c.claimedAt && isLeaseExpired(c.claimedAt, now, leaseMs)) {
        expiredSending.push(c);
      } else if (c.status === 'PENDING') {
        pending.push(c);
      }
    }

    for (const row of expiredSending) {
      if (row.claimToken) await this.store.recoverExpired(row.id, row.claimToken, now, row.attemptCount, this.maxAttemptsCap());
    }

    if (pending.length > 0) {
      const targetIds = [...new Set(pending.map((p) => p.targetId))];
      const targetRows = await this.prisma.workflowTarget.findMany({
        where: { id: { in: targetIds } },
        select: { id: true, enabled: true, pausedAt: true },
      });
      const sendingGroups = await this.prisma.workflowRun.groupBy({
        by: ['targetId'],
        where: { targetId: { in: targetIds }, status: 'SENDING' },
        _count: { _all: true },
      });
      const since60s = new Date(now.getTime() - 60_000);
      const recentGroups = await this.prisma.workflowRun.groupBy({
        by: ['targetId'],
        where: { targetId: { in: targetIds }, lastAttemptAt: { gte: since60s } },
        _count: { _all: true },
      });
      const sendingByTarget = new Map(sendingGroups.map((g) => [g.targetId, g._count._all]));
      const recentByTarget = new Map(recentGroups.map((g) => [g.targetId, g._count._all]));

      const targetsMap = new Map<string, TargetState>(
        targetRows.map((t) => [
          t.id,
          { enabled: t.enabled, paused: !!t.pausedAt, sendingCount: sendingByTarget.get(t.id) ?? 0, recentAttempts: recentByTarget.get(t.id) ?? 0 },
        ]),
      );
      const targetRatePerMin = this.config.get<number>('WORKFLOW_TARGET_RATE_PER_MIN') ?? 60;

      const claimCandidates: ClaimCandidate[] = pending.map((p) => ({ id: p.id, targetId: p.targetId }));
      const plan = planClaims(claimCandidates, targetsMap, {
        batch,
        targetConcurrentSending: 2,
        targetRatePerMin,
        instanceConcurrentSends: 10,
      });

      const claimedIds: string[] = [];
      for (const [id, action] of plan) {
        if (action === 'HELD') await this.store.holdAtClaim(id, now);
        else if (action === 'SKIPPED') await this.store.skipAtClaim(id, now);
        else if (action === 'CLAIM') claimedIds.push(id);
      }

      await Promise.all(claimedIds.map((id) => this.dispatchOne(id, now)));
    }

    if (runMaintenanceThisTick) await this.runMaintenance(now);
  }

  private async dispatchOne(id: string, now: Date): Promise<void> {
    const run = await this.store.claim(id, now);
    if (!run) return; // 다른 인스턴스가 이미 가져갔다.

    // [신규 — 화면설계 계약 §26 I-1] 보관 봉투 개봉 실패(옛 키 제거·손상) — 송신하지 않고 즉시 종결한다.
    if (run.decryptFailed) {
      const ok = await this.store.finalizePermanent(run, now, null, undefined, 'DECRYPT_FAILED');
      if (!ok) this.logger.warn(`발송 종결 CAS 실패(임대 상실) — id=${id}`);
      return;
    }

    const target = await this.prisma.workflowTarget.findUnique({
      where: { id: run.targetId },
      select: {
        baseUrl: true,
        authType: true,
        authHeaderName: true,
        secretRef: true,
        signingEnabled: true,
        signingSecretRef: true,
        urlSecretRef: true,
        timeoutMs: true,
        maxAttempts: true,
      },
    });
    if (!target) {
      await this.store.finalizePermanent(run, now, 'INVALID_TARGET_URL', undefined, 'PERMANENT_ERROR');
      return;
    }

    const started = Date.now();
    let outcome: WorkflowOutcome = 'NETWORK_ERROR';
    let httpStatus: number | undefined;
    let retryAfterMs: number | null = null;
    let permanent = false;
    let success = false;

    try {
      const result = await this.sender.send(
        {
          baseUrl: target.baseUrl,
          authType: target.authType as never,
          authHeaderName: target.authHeaderName,
          secretRef: target.secretRef,
          signingEnabled: target.signingEnabled,
          signingSecretRef: target.signingSecretRef,
          urlSecretRef: target.urlSecretRef,
          timeoutMs: target.timeoutMs,
        },
        run.eventType as WorkflowEventType,
        run.id,
        run.attemptCount,
        run.payloadJson,
        now,
      );

      if (result.kind === 'RESPONSE') {
        httpStatus = result.status;
        const decision = classifyHttpStatus(result.status, parseRetryAfterMs(result.retryAfter, now));
        if (decision.kind === 'SUCCESS') {
          success = true;
        } else if (decision.kind === 'RETRY') {
          outcome = decision.outcome;
          retryAfterMs = decision.retryAfterMs ?? null;
        } else {
          outcome = decision.outcome;
          permanent = true;
        }
      } else if (result.kind === 'BLOCKED') {
        outcome = result.outcome;
        permanent = true;
      } else {
        const decision = classifyTransportOutcome(result.outcome);
        outcome = decision.outcome;
        permanent = decision.kind === 'PERMANENT';
      }
    } catch {
      outcome = 'NETWORK_ERROR';
    }

    const latencyMs = Date.now() - started;
    const maxAttempts = Math.min(target.maxAttempts, this.maxAttemptsCap());

    if (success) {
      const ok = await this.store.finalizeSuccess(run, now, httpStatus as number, latencyMs);
      if (!ok) this.logger.warn(`발송 종결 CAS 실패(임대 상실) — id=${id}`);
      return;
    }

    if (permanent) {
      const ok = await this.store.finalizePermanent(run, now, outcome!, httpStatus, 'PERMANENT_ERROR');
      if (!ok) this.logger.warn(`발송 종결 CAS 실패(임대 상실) — id=${id}`);
      return;
    }

    if (run.attemptCount >= maxAttempts) {
      const ok = await this.store.finalizePermanent(run, now, outcome!, httpStatus, 'MAX_ATTEMPTS');
      if (!ok) this.logger.warn(`발송 종결 CAS 실패(임대 상실) — id=${id}`);
      return;
    }

    const backoffMs = retryAfterMs ?? computeBackoffMs(this.backoffSchedule(), run.attemptCount, this.random);
    const nextAttemptAt = new Date(now.getTime() + backoffMs);
    const ok = await this.store.finalizeRetry(run, now, nextAttemptAt, outcome!, httpStatus);
    if (!ok) this.logger.warn(`발송 종결 CAS 실패(임대 상실) — id=${id}`);
  }

  private async runMaintenance(now: Date): Promise<void> {
    await this.store.expireOverdueHolds(now, this.holdMaxMs());
    await this.store.purgeFailedPayloads(now, this.failedRetentionMs());
  }
}
