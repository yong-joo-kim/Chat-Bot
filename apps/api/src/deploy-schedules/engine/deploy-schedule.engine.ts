import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { DeployScheduleAction, DeployScheduleFailureReason } from '@chat-bot/shared-types';
import { PrismaService } from '../../prisma/prisma.service';
import { CLOCK } from '../../common/polling/clock';
import type { Clock } from '../../common/polling/clock';
import { PollingLoop } from '../../common/polling/polling-loop';
import { planTick } from '../lib/tick-planner';
import type { DueScheduleRow, HeldScheduleRow, TickDecision, TickPlannerConfig } from '../lib/tick-planner';
import { ExecutorRegistry } from '../executors/executor.registry';
import { CreatorVerifier } from './creator-verifier';
import { DeployScheduleRepository } from './deploy-schedule.repository';
import type { FinalizeInput } from './deploy-schedule.repository';
import { PostRunTestStarter } from '../post-run/post-run-test.starter';
import { isPostRunTestApplicable } from '../lib/required-permissions';

/**
 * [신규 2026-09-23 No.28] 실행 엔진(§7) — 라이프사이클(`onApplicationBootstrap`/`onModuleDestroy`) +
 * tick 오케스트레이션. `tick()`은 public — 통합 시험이 `DEPLOY_SCHEDULE_ENABLED=false`로 기동해
 * 타이머 없이 직접 호출한다(§7.10).
 */
@Injectable()
export class DeploySchedulesEngine implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('DeploySchedulesEngine');
  private readonly loop: PollingLoop;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly repository: DeployScheduleRepository,
    private readonly registry: ExecutorRegistry,
    private readonly creatorVerifier: CreatorVerifier,
    private readonly postRunTestStarter: PostRunTestStarter,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {
    this.loop = new PollingLoop({
      name: 'deploy-schedules',
      intervalMs: this.pollIntervalMs(),
      onTick: (signal) => this.tick(signal),
      logger: this.logger,
    });
  }

  private enabled(): boolean {
    return this.config.get<boolean>('DEPLOY_SCHEDULE_ENABLED') ?? true;
  }
  private pollIntervalMs(): number {
    return this.config.get<number>('DEPLOY_SCHEDULE_POLL_INTERVAL_MS') ?? 30_000;
  }
  private plannerConfig(): TickPlannerConfig {
    return {
      misfireGraceMs: (this.config.get<number>('DEPLOY_SCHEDULE_MISFIRE_GRACE_MINUTES') ?? 10) * 60_000,
      pollIntervalMs: this.pollIntervalMs(),
      retryWindowMs: (this.config.get<number>('DEPLOY_SCHEDULE_RETRY_WINDOW_MINUTES') ?? 15) * 60_000,
      leaseMs: (this.config.get<number>('DEPLOY_SCHEDULE_LEASE_MINUTES') ?? 5) * 60_000,
    };
  }

  async onApplicationBootstrap(): Promise<void> {
    if (!this.enabled()) {
      this.logger.log('DEPLOY_SCHEDULE_ENABLED=false — 이 인스턴스에서 실행 엔진을 가동하지 않습니다(CRUD는 정상 동작).');
      return;
    }
    await this.loop.runOnce();
    this.loop.start();
  }

  async onModuleDestroy(): Promise<void> {
    await this.loop.stop(30_000);
  }

  async tick(signal?: { stopping(): boolean }): Promise<void> {
    const now = this.clock.now();
    const cfg = this.plannerConfig();

    const rows = await this.prisma.deploySchedule.findMany({
      where: { status: { in: ['PENDING', 'RUNNING'] }, scheduledAt: { lte: now } },
      orderBy: { scheduledAt: 'asc' },
      take: 100,
      select: { id: true, chatbotId: true, status: true, scheduledAt: true, attemptCount: true, claimedAt: true, claimToken: true },
    });
    if (rows.length === 0) return;

    const chatbotIds = Array.from(new Set(rows.map((r) => r.chatbotId)));
    const heldRows = await this.prisma.deploySchedule.findMany({
      where: { chatbotId: { in: chatbotIds }, status: 'HELD', scheduledAt: { lte: now } },
      select: { id: true, chatbotId: true, scheduledAt: true },
    });

    const plannerRows: DueScheduleRow[] = rows.map((r) => ({
      id: r.id,
      chatbotId: r.chatbotId,
      status: r.status as 'PENDING' | 'RUNNING',
      scheduledAt: r.scheduledAt,
      attemptCount: r.attemptCount,
      claimedAt: r.claimedAt,
      claimToken: r.claimToken,
    }));
    const heldForPlanner: HeldScheduleRow[] = heldRows;

    const decisions = planTick(plannerRows, heldForPlanner, now, cfg);
    const rowsById = new Map(rows.map((r) => [r.id, r]));

    const deadlineMs = Math.min(20_000, Math.floor((cfg.pollIntervalMs * 2) / 3));
    const deadline = now.getTime() + deadlineMs;

    for (const d of decisions.sort((a, b) => (rowsById.get(a.id)?.scheduledAt.getTime() ?? 0) - (rowsById.get(b.id)?.scheduledAt.getTime() ?? 0))) {
      if (signal?.stopping() || this.clock.now().getTime() > deadline) break;
      try {
        await this.apply(d, rowsById, cfg, now);
      } catch (e) {
        this.logger.warn(`tick 처리 중 예외(다음 건 계속): id=${d.id} kind=${d.kind} error=${e instanceof Error ? e.message : 'unknown'}`);
      }
    }
  }

  private async apply(
    d: TickDecision,
    rowsById: Map<string, { id: string; chatbotId: string; status: string; scheduledAt: Date; attemptCount: number; claimedAt: Date | null; claimToken: string | null }>,
    cfg: TickPlannerConfig,
    now: Date,
  ): Promise<void> {
    switch (d.kind) {
      case 'SKIP':
        return;
      case 'HOLD_BEHIND_HELD':
        return this.repository.holdBehindHeld(d.id, d.heldByScheduleId, now);
      case 'MISS': {
        const meta = rowsById.get(d.id);
        if (!meta) return;
        await this.repository.markMissed(d.id, meta.scheduledAt, d.delaySeconds, now);
        return;
      }
      case 'EXPIRE_RETRY': {
        const meta = rowsById.get(d.id);
        if (!meta) return;
        await this.repository.expireRetry(d.id, meta.attemptCount, meta.scheduledAt, now);
        return;
      }
      case 'RECOVER':
        return this.applyRecover(d.id, d.claimToken, cfg, now);
      case 'EXECUTE': {
        const meta = rowsById.get(d.id);
        if (!meta) return;
        return this.applyExecute(d.id, d.expectAttemptCount, meta.scheduledAt, now);
      }
    }
  }

  private async applyRecover(id: string, observedClaimToken: string, cfg: TickPlannerConfig, now: Date): Promise<void> {
    const token = await this.repository.reclaim(id, observedClaimToken, cfg.leaseMs, now);
    if (!token) return; // 다른 인스턴스가 먼저 회수했거나 이미 종결됨

    const row = await this.prisma.deploySchedule.findUnique({ where: { id } });
    if (!row) return;
    const action = row.action as DeployScheduleAction;
    const executor = this.registry.get(action);
    const paramsResult = executor.paramsSchema.safeParse(JSON.parse(row.params));
    if (!paramsResult.success || !row.claimedAt) {
      await this.repository.finalize(id, token, { kind: 'FAILED', failureReason: 'INTERNAL_ERROR' }, now);
      return;
    }

    const verdict = await executor.judgeRecovery({
      deployScheduleId: id,
      chatbotId: row.chatbotId,
      params: paramsResult.data as never,
      targetContentHash: row.targetContentHash,
      claimedAt: row.claimedAt,
    });

    if (verdict.kind === 'INTERRUPTED') {
      this.logFinalizeResult(id, await this.repository.finalize(id, token, { kind: 'FAILED', failureReason: 'INTERRUPTED' }, now));
      return;
    }
    const input: FinalizeInput = { kind: 'SUCCEEDED', outcome: verdict.kind, summary: verdict.summary };
    this.logFinalizeResult(id, await this.repository.finalize(id, token, input, now));
  }

  private async applyExecute(id: string, expectAttemptCount: number, scheduledAt: Date, now: Date): Promise<void> {
    const token = await this.repository.claim(id, expectAttemptCount, scheduledAt, now);
    if (!token) return; // 다른 인스턴스가 가져갔거나 상태가 바뀜

    const row = await this.prisma.deploySchedule.findUnique({ where: { id } });
    if (!row) return;

    const action = row.action as DeployScheduleAction;
    const executor = this.registry.get(action);
    const paramsResult = executor.paramsSchema.safeParse(JSON.parse(row.params));
    if (!paramsResult.success) {
      this.logger.warn(`예약 params 파싱 실패(INTERNAL_ERROR로 종결): id=${id} action=${action}`);
      await this.repository.finalize(id, token, { kind: 'FAILED', failureReason: 'INTERNAL_ERROR' }, now);
      return;
    }

    const requiredPermissions = executor.requiredPermissions(paramsResult.data as never);
    const actor = await this.creatorVerifier.verify(row.createdById, requiredPermissions);
    if (!actor) {
      await this.finalizeAsFailure(id, token, 'CREATOR_NOT_AUTHORIZED', now);
      return;
    }

    const auditSummaryPrefix = `[예약 실행 #${id.slice(0, 8)}] `;
    const outcome = await executor.execute({
      deployScheduleId: id,
      chatbotId: row.chatbotId,
      params: paramsResult.data as never,
      expectedContentHash: row.expectedContentHash,
      acknowledgeActive: row.acknowledgeActive,
      actor,
      auditSummaryPrefix,
    });

    if (outcome.kind === 'APPLIED' || outcome.kind === 'NOOP') {
      let summary = outcome.summary;
      let testRunId: string | undefined;
      if (outcome.kind === 'APPLIED' && row.postRunTestSetId && isPostRunTestApplicable(action)) {
        // [신규 No.40 — §11.3 ⑥] SWITCH_PROD_VERSION 성공 직후는 새 운영 버전을 대상으로 한다
        // (params.targetVersionId = 방금 전환된 버전). 그 외 동작(RESTORE_VERSION·PUBLISH)은
        // 기존처럼 대상 생략(초안) — 계약 불변.
        const target = action === 'SWITCH_PROD_VERSION' ? ({ kind: 'VERSION' as const, versionId: (paramsResult.data as { targetVersionId: string }).targetVersionId }) : undefined;
        const postRunTest = await this.postRunTestStarter.start(row.chatbotId, row.postRunTestSetId, actor.role, target);
        testRunId = postRunTest.testRunId;
        summary = { ...summary, postRunTest } as typeof summary;
      }
      const result = await this.repository.finalize(id, token, { kind: 'SUCCEEDED', outcome: outcome.kind, summary, testRunId }, now);
      if (result === 'OK') this.logger.log(`예약 실행 완료: id=${id} action=${action} outcome=${outcome.kind}`);
      else this.logFinalizeResult(id, result);
      return;
    }

    if (outcome.kind === 'TRANSIENT') {
      const retryWindowMs = (this.config.get<number>('DEPLOY_SCHEDULE_RETRY_WINDOW_MINUTES') ?? 15) * 60_000;
      if (now.getTime() > scheduledAt.getTime() + retryWindowMs) {
        await this.finalizeAsFailure(id, token, 'BLOCKED_TOO_LONG', now);
      } else {
        this.logFinalizeResult(id, await this.repository.finalize(id, token, { kind: 'PENDING_RETRY', lastTransientReason: outcome.reason }, now));
      }
      return;
    }

    // PERMANENT
    await this.finalizeAsFailure(id, token, outcome.reason, now);
  }

  private async finalizeAsFailure(id: string, token: string, reason: DeployScheduleFailureReason, now: Date): Promise<void> {
    const result = await this.repository.finalize(id, token, { kind: 'FAILED', failureReason: reason }, now);
    if (result === 'OK') this.logger.warn(`예약 실행 실패: id=${id} reason=${reason}`);
    else this.logFinalizeResult(id, result);
  }

  /** §7.4 step5 — `finalize()`가 `LOST_LEASE`(임대를 잃음, 다른 인스턴스가 이미 회수)를 반환하면
   * 이번 결과는 폐기하고 warn 로그만 남긴다(code-review 1라운드 L2). */
  private logFinalizeResult(id: string, result: 'OK' | 'LOST_LEASE'): void {
    if (result === 'LOST_LEASE') {
      this.logger.warn(`임대를 잃어 이번 실행 결과를 폐기합니다(다른 인스턴스가 먼저 회수/종결함): id=${id}`);
    }
  }
}
