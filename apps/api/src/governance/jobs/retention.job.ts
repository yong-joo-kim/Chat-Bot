import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import type { DialogOutput, RetentionTargetKind } from '@chat-bot/shared-types';
import { toKstDayBucket } from '@chat-bot/shared-types';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../audit-logs/audit-log.service';
import { AuditChainVerifier } from '../../audit-logs/chain/audit-chain-verifier.service';
import { PollingLoop } from '../../common/polling/polling-loop';
import { governanceRuntime } from '../../common/governance/governance-runtime';
import { GovernanceJobLease } from './job-lease';
import { GovernanceDataWriter } from '../writer/governance-data.writer';
import { isWithinKstWindow } from '../lib/retention-window';
import { computeCutoff, resolveEffectiveDays } from '../lib/retention-policy';
import type { ChatbotRetentionDaysMap, RetentionBounds, RetentionDaysMap, RetentionPendingMap } from '../lib/retention-policy';
import { nodeHasV1PlainHeader } from '../lib/v1-token-scan';

const JOB_NAME = 'RETENTION';
const TICK_INTERVAL_MS = 5 * 60_000;
const LEASE_MS = 10 * 60_000;
const CHAIN_VERIFY_INTERVAL_DAYS = 7;
const V1_TOKEN_CHECK_INTERVAL_DAYS = 7;

interface ParsedPolicyRow {
  chatbotId: string | null;
  days: ChatbotRetentionDaysMap;
  pending: RetentionPendingMap;
}

interface RetentionJobStateShape {
  v1TokenCheck?: { computedAt: string; snapshotCount: number };
}

function safeJsonParse<T>(json: string, fallback: T): T {
  try {
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === 'object' ? (parsed as T) : fallback;
  } catch {
    return fallback;
  }
}

/**
 * ★ 파기 잡(No.45 §9) — `PollingLoop` 소비자(ADR-0032 세 번째). `tick()`은 public(CLAUDE.md 규약).
 * 모드와 무관하게 항상 동작한다(보존 정책은 모드 무관 — P-6). 정책이 전부 무기한이면 정책 읽기
 * 1회 외 쿼리 0(FR-0-161 기준선의 파기 잡 부분).
 */
@Injectable()
export class RetentionJob implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('RetentionJob');
  private readonly loop: PollingLoop;
  private readonly instanceId = randomUUID();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly writer: GovernanceDataWriter,
    private readonly lease: GovernanceJobLease,
    private readonly auditLog: AuditLogService,
    private readonly chainVerifier: AuditChainVerifier,
  ) {
    this.loop = new PollingLoop({ name: 'governance-retention', intervalMs: TICK_INTERVAL_MS, onTick: (signal) => this.tick(signal), logger: this.logger });
  }

  private enabled(): boolean {
    return this.config.get<boolean>('DATA_RETENTION_JOB_ENABLED') ?? true;
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.lease.ensureRow(JOB_NAME);
    if (!this.enabled()) return;
    this.loop.start();
  }

  async onModuleDestroy(): Promise<void> {
    await this.loop.stop(10_000);
  }

  private batchSize(): number {
    return this.config.get<number>('DATA_RETENTION_BATCH_SIZE') ?? 500;
  }
  private batchPauseMs(): number {
    return this.config.get<number>('DATA_RETENTION_BATCH_PAUSE_MS') ?? 200;
  }
  private maxRowsPerRun(): number {
    return this.config.get<number>('DATA_RETENTION_MAX_ROWS_PER_RUN') ?? 500_000;
  }
  private window(): string {
    return this.config.get<string>('DATA_RETENTION_WINDOW') ?? '02:00-05:00';
  }
  private bounds(): RetentionBounds {
    return {
      minConversationDays: this.config.get<number>('RETENTION_MIN_DAYS_CONVERSATION') ?? 7,
      minAuditDays: this.config.get<number>('RETENTION_MIN_DAYS_AUDIT') ?? 365,
      maxDays: this.config.get<number>('RETENTION_MAX_DAYS') ?? 3650,
      shortenGraceDays: this.config.get<number>('RETENTION_SHORTEN_GRACE_DAYS') ?? 7,
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** `tick()`은 public — 시험이 직접 호출한다(CLAUDE.md). */
  async tick(signal?: { stopping(): boolean }): Promise<void> {
    if (!isWithinKstWindow(new Date(), this.window())) return;

    const now = new Date();
    const kstToday = toKstDayBucket(now);
    const state = await this.prisma.governanceJobState.findUnique({ where: { jobName: JOB_NAME } });
    if (state?.lastCompletedDay === kstToday) return;

    const token = await this.lease.claim(JOB_NAME, LEASE_MS, now);
    if (!token) return;

    const runId = randomUUID();
    let totalAffected = 0;
    const affectedByKind: Record<string, number> = {};
    let partial = false;

    try {
      const globalRow = await this.prisma.retentionPolicy.findUnique({ where: { scopeKey: 'GLOBAL' } });
      const globalDays: RetentionDaysMap = globalRow ? safeJsonParse(globalRow.days, {}) : {};
      const globalPending: RetentionPendingMap = globalRow ? safeJsonParse(globalRow.pending, {}) : {};
      const bounds = this.bounds();

      const chatbotOverrides = await this.prisma.retentionPolicy.findMany({ where: { chatbotId: { not: null } } });
      const overridesByChatbot = new Map<string, ParsedPolicyRow>(
        chatbotOverrides.map((r) => {
          const days = safeJsonParse<ChatbotRetentionDaysMap>(r.days, {});
          const pending = safeJsonParse<RetentionPendingMap>(r.pending, {});
          return [r.chatbotId as string, { chatbotId: r.chatbotId, days, pending }];
        }),
      );

      const rowsBudget = { remaining: this.maxRowsPerRun() };

      for (const kind of ['CONVERSATION_TEXT', 'UNANSWERED_CLOSED', 'SURVEY_FREE_TEXT', 'HANDOFF_TEXT'] as const) {
        if (signal?.stopping() || rowsBudget.remaining <= 0) {
          partial = true;
          break;
        }
        const affected = await this.purgeConversationKind(kind, globalDays, globalPending, overridesByChatbot, bounds, now, rowsBudget, signal);
        affectedByKind[kind] = (affectedByKind[kind] ?? 0) + affected;
        totalAffected += affected;
      }

      // CALL_LOGS(전역만)
      if (!signal?.stopping() && rowsBudget.remaining > 0) {
        const days = resolveEffectiveDays('CALL_LOGS', globalDays, globalPending, null, null, now, bounds);
        if (days !== null) {
          const cutoff = computeCutoff(days, now);
          const affected = await this.purgeBatchLoop(rowsBudget, signal, () => this.writer.deleteCallLogsBatch(cutoff, this.batchSize()));
          affectedByKind.CALL_LOGS = affected;
          totalAffected += affected;
        }
      }

      // [신규 No.42] INBOX_TEXT(전역만) — 항목 본문 소거(스레드 상태와 무관).
      if (!signal?.stopping() && rowsBudget.remaining > 0) {
        const days = resolveEffectiveDays('INBOX_TEXT', globalDays, globalPending, null, null, now, bounds);
        if (days !== null) {
          const cutoff = computeCutoff(days, now);
          const affected = await this.purgeBatchLoop(rowsBudget, signal, async () => {
            const rows = await this.prisma.inboxEntry.findMany({
              where: { textPurgedAt: null, kind: { not: 'SYSTEM' }, createdAt: { lt: cutoff } },
              select: { id: true },
              take: this.batchSize(),
            });
            if (rows.length === 0) return 0;
            return this.writer.purgeInboxEntries(rows.map((r) => r.id), new Date());
          });
          affectedByKind.INBOX_TEXT = affected;
          totalAffected += affected;
        }
      }

      // [신규 No.42] CUSTOMER_IDENTITY(전역만) — 마지막 활동 기준, 해시·표시 이름·지문 → null.
      if (!signal?.stopping() && rowsBudget.remaining > 0) {
        const days = resolveEffectiveDays('CUSTOMER_IDENTITY', globalDays, globalPending, null, null, now, bounds);
        if (days !== null) {
          const cutoff = computeCutoff(days, now);
          const affected = await this.purgeBatchLoop(rowsBudget, signal, async () => {
            const rows = await this.prisma.customer.findMany({
              where: { identityPurgedAt: null, OR: [{ customerKeyHash: { not: null } }, { displayName: { not: null } }], lastActivityAt: { lt: cutoff } },
              select: { id: true },
              take: this.batchSize(),
            });
            if (rows.length === 0) return 0;
            return this.writer.purgeCustomerIdentities(rows.map((r) => r.id), new Date());
          });
          affectedByKind.CUSTOMER_IDENTITY = affected;
          totalAffected += affected;
        }
      }

      // AUDIT_LOGS(전역만) — 행 삭제 + 앵커
      let headSeqAfter: number | null = null;
      let anchorSeqAfter: number | null = null;
      if (!signal?.stopping() && rowsBudget.remaining > 0) {
        const days = resolveEffectiveDays('AUDIT_LOGS', globalDays, globalPending, null, null, now, bounds);
        if (days !== null) {
          const cutoff = computeCutoff(days, now);
          let affected = 0;
          for (;;) {
            if (signal?.stopping() || rowsBudget.remaining <= 0) {
              partial = true;
              break;
            }
            const result = await this.writer.deleteAuditLogsBatch(cutoff, this.batchSize());
            if (result.deleted === 0) break;
            affected += result.deleted;
            rowsBudget.remaining -= result.deleted;
            if (result.anchorSeq !== undefined) anchorSeqAfter = result.anchorSeq;
            await this.sleep(this.batchPauseMs());
          }
          await this.writer.deleteOldRetentionRuns(cutoff);
          affectedByKind.AUDIT_LOGS = affected;
          totalAffected += affected;
        }
      }

      const head = await this.prisma.auditChainHead.findUnique({ where: { id: 'HEAD' } });
      headSeqAfter = head?.headSeq ?? null;

      // 주간 체인 검증(창 안에서, 마지막 CHAIN_VERIFY로부터 7일 이상 지났으면)
      await this.maybeRunWeeklyChainVerify(runId, now);

      // [신규 §9.1 ⑤] v1 평문 토큰 스냅샷 주간 점검 — 데이터 지도는 이 캐시만 읽는다(요청 경로 스캔 0).
      await this.maybeRunWeeklyV1TokenCheck(now);

      const status = partial ? 'PARTIAL' : 'SUCCEEDED';
      await this.writer.createRetentionRun({
        runId,
        kind: 'PURGE',
        target: null,
        chatbotId: null,
        days: null,
        cutoff: null,
        affectedCount: totalAffected,
        status,
        resultCode: partial ? 'MAX_ROWS' : null,
        headSeq: headSeqAfter,
        headHash: head?.headHash ?? null,
        anchorSeq: anchorSeqAfter,
        instanceId: this.instanceId,
        startedAt: now,
        finishedAt: new Date(),
      });

      const hasFiniteAny = Object.keys(affectedByKind).length > 0;
      if (hasFiniteAny) {
        await this.auditLog.record({
          action: 'PURGE',
          targetType: 'RetentionRun',
          targetId: runId,
          summary: '보존기간 파기',
          actorOverride: { id: null, email: 'system', role: null },
          after: { kind: 'PURGE', status, affectedByKind, headSeq: headSeqAfter, anchorSeq: anchorSeqAfter },
        });
      }

      this.logger.log(`파기 완료: runId=${runId} status=${status} affected=${totalAffected} headSeq=${headSeqAfter ?? '-'}`);

      if (!partial) {
        await this.prisma.governanceJobState.updateMany({ where: { jobName: JOB_NAME }, data: { lastCompletedDay: kstToday } });
      }
    } finally {
      await this.lease.release(JOB_NAME, token);
    }
  }

  private async purgeConversationKind(
    kind: 'CONVERSATION_TEXT' | 'UNANSWERED_CLOSED' | 'SURVEY_FREE_TEXT' | 'HANDOFF_TEXT',
    globalDays: RetentionDaysMap,
    globalPending: RetentionPendingMap,
    overridesByChatbot: Map<string, ParsedPolicyRow>,
    bounds: RetentionBounds,
    now: Date,
    rowsBudget: { remaining: number },
    signal?: { stopping(): boolean },
  ): Promise<number> {
    const globalOnlyDays = resolveEffectiveDays(kind, globalDays, globalPending, null, null, now, bounds);
    const overrideChatbotIds = [...overridesByChatbot.keys()];

    let total = 0;

    // 재정의 없는 챗봇 전부 — 전역 cutoff 1개로 처리(챗봇 id 조건 없이).
    if (globalOnlyDays !== null) {
      const cutoff = computeCutoff(globalOnlyDays, now);
      total += await this.purgeKindBatchLoop(kind, cutoff, overrideChatbotIds, 'EXCLUDE', rowsBudget, signal);
    }

    // 재정의가 있는 챗봇들 — 각자의 cutoff.
    for (const chatbotId of overrideChatbotIds) {
      if (signal?.stopping() || rowsBudget.remaining <= 0) break;
      const row = overridesByChatbot.get(chatbotId) as ParsedPolicyRow;
      const days = resolveEffectiveDays(kind, globalDays, globalPending, row.days, row.pending, now, bounds);
      if (days === null) continue;
      const cutoff = computeCutoff(days, now);
      total += await this.purgeKindBatchLoop(kind, cutoff, [chatbotId], 'INCLUDE', rowsBudget, signal);
    }

    return total;
  }

  private async purgeKindBatchLoop(
    kind: 'CONVERSATION_TEXT' | 'UNANSWERED_CLOSED' | 'SURVEY_FREE_TEXT' | 'HANDOFF_TEXT',
    cutoff: Date,
    chatbotIds: string[],
    mode: 'INCLUDE' | 'EXCLUDE',
    rowsBudget: { remaining: number },
    signal?: { stopping(): boolean },
  ): Promise<number> {
    let total = 0;
    for (;;) {
      if (signal?.stopping() || rowsBudget.remaining <= 0) break;
      const batch = await this.selectBatch(kind, cutoff, chatbotIds, mode);
      if (batch.length === 0) break;
      const affected = await this.applyPurge(kind, batch, new Date());
      total += affected;
      rowsBudget.remaining -= affected;
      if (affected === 0) break; // 경합으로 CAS 0건 — 무한루프 방지
      await this.sleep(this.batchPauseMs());
    }
    return total;
  }

  private async selectBatch(
    kind: 'CONVERSATION_TEXT' | 'UNANSWERED_CLOSED' | 'SURVEY_FREE_TEXT' | 'HANDOFF_TEXT',
    cutoff: Date,
    chatbotIds: string[],
    mode: 'INCLUDE' | 'EXCLUDE',
  ): Promise<string[]> {
    const chatbotFilter = chatbotIds.length === 0 ? {} : mode === 'INCLUDE' ? { chatbotId: { in: chatbotIds } } : { chatbotId: { notIn: chatbotIds } };
    const take = this.batchSize();

    if (kind === 'CONVERSATION_TEXT') {
      const rows = await this.prisma.conversationLog.findMany({
        where: { ...chatbotFilter, textPurgedAt: null, createdAt: { lt: cutoff } },
        select: { id: true },
        take,
      });
      return rows.map((r) => r.id);
    }
    if (kind === 'UNANSWERED_CLOSED') {
      const rows = await this.prisma.unansweredQuestion.findMany({
        where: { ...chatbotFilter, status: { in: ['RESOLVED', 'IGNORED'] }, textPurgedAt: null, lastOccurredAt: { lt: cutoff } },
        select: { id: true },
        take,
      });
      return rows.map((r) => r.id);
    }
    if (kind === 'SURVEY_FREE_TEXT') {
      const surveyWhere = chatbotIds.length === 0 ? {} : mode === 'INCLUDE' ? { chatbotId: { in: chatbotIds } } : { chatbotId: { notIn: chatbotIds } };
      const surveys = await this.prisma.survey.findMany({ where: surveyWhere, select: { id: true } });
      const surveyIds = surveys.map((s) => s.id);
      if (surveyIds.length === 0) return [];
      const rows = await this.prisma.surveyAnswer.findMany({
        where: { surveyId: { in: surveyIds }, textPurgedAt: null, textValue: { not: null }, answeredAt: { lt: cutoff } },
        select: { id: true },
        take,
      });
      return rows.map((r) => r.id);
    }
    // HANDOFF_TEXT
    const rows = await this.prisma.handoffMessage.findMany({
      where: { ...chatbotFilter, textPurgedAt: null, createdAt: { lt: cutoff }, handoffSession: { status: 'ENDED' } },
      select: { id: true },
      take,
    });
    return rows.map((r) => r.id);
  }

  private async applyPurge(kind: RetentionTargetKind, ids: string[], now: Date): Promise<number> {
    if (kind === 'CONVERSATION_TEXT') return this.writer.purgeConversationLogs(ids, now);
    if (kind === 'UNANSWERED_CLOSED') return this.writer.purgeUnansweredClosed(ids, now);
    if (kind === 'SURVEY_FREE_TEXT') return this.writer.purgeSurveyAnswers(ids, now);
    if (kind === 'HANDOFF_TEXT') return this.writer.purgeHandoffMessages(ids, now);
    return 0;
  }

  private async purgeBatchLoop(rowsBudget: { remaining: number }, signal: { stopping(): boolean } | undefined, run: () => Promise<number>): Promise<number> {
    let total = 0;
    for (;;) {
      if (signal?.stopping() || rowsBudget.remaining <= 0) break;
      const affected = await run();
      if (affected === 0) break;
      total += affected;
      rowsBudget.remaining -= affected;
      await this.sleep(this.batchPauseMs());
    }
    return total;
  }

  private async maybeRunWeeklyChainVerify(runId: string, now: Date): Promise<void> {
    void governanceRuntime(); // 모드 무관(§10) — 읽지 않지만 의도 표시
    const lastVerify = await this.prisma.retentionRun.findFirst({ where: { kind: 'CHAIN_VERIFY' }, orderBy: { startedAt: 'desc' } });
    if (lastVerify && now.getTime() - lastVerify.startedAt.getTime() < CHAIN_VERIFY_INTERVAL_DAYS * 86_400_000) return;

    try {
      const result = await this.chainVerifier.verify(undefined, undefined, now);
      await this.writer.createRetentionRun({
        runId,
        kind: 'CHAIN_VERIFY',
        target: null,
        chatbotId: null,
        days: null,
        cutoff: null,
        affectedCount: result.checkedRows,
        status: result.status === 'OK' || result.status === 'EMPTY' ? 'SUCCEEDED' : 'FAILED',
        resultCode: result.status,
        headSeq: result.head?.seq ?? null,
        headHash: result.head?.hash ?? null,
        anchorSeq: null,
        instanceId: this.instanceId,
        startedAt: now,
        finishedAt: new Date(),
      });
      if (result.status !== 'OK' && result.status !== 'EMPTY') {
        this.logger.warn(`주간 감사 체인 검증 이상: status=${result.status}`);
      }
    } catch (e) {
      // 예외 message는 로그에 담지 않는다(G-14 — 종류만).
      this.logger.warn(`주간 감사 체인 검증 실패: ${e instanceof Error ? e.constructor.name : 'unknown'}`);
    }
  }

  /**
   * ★ [신규 §9.1 ⑤ · §13] v1 평문 헤더 토큰이 남은 스냅샷 수를 주 1회 스캔해 `GovernanceJobState
   * ('RETENTION').state.v1TokenCheck`에 캐시한다 — 데이터 지도 요청 경로는 이 캐시만 읽는다
   * (`ChatbotVersionPayload` 본문을 요청마다 스캔하지 않는다, R-13).
   */
  private async maybeRunWeeklyV1TokenCheck(now: Date): Promise<void> {
    const stateRow = await this.prisma.governanceJobState.findUnique({ where: { jobName: JOB_NAME } });
    const state: RetentionJobStateShape = stateRow ? safeJsonParse(stateRow.state, {}) : {};
    const lastAt = state.v1TokenCheck ? new Date(state.v1TokenCheck.computedAt).getTime() : 0;
    if (now.getTime() - lastAt < V1_TOKEN_CHECK_INTERVAL_DAYS * 86_400_000) return;

    try {
      const snapshotCount = await this.scanV1PlainHeaderSnapshots();
      state.v1TokenCheck = { computedAt: now.toISOString(), snapshotCount };
      await this.prisma.governanceJobState.updateMany({ where: { jobName: JOB_NAME }, data: { state: JSON.stringify(state) } });
    } catch (e) {
      // 예외 message는 로그에 담지 않는다(G-14 — 종류만).
      this.logger.warn(`v1 평문 토큰 주간 점검 실패: ${e instanceof Error ? e.constructor.name : 'unknown'}`);
    }
  }

  private async scanV1PlainHeaderSnapshots(): Promise<number> {
    const payloads = await this.prisma.chatbotVersionPayload.findMany({ select: { payload: true } });
    let count = 0;
    for (const p of payloads) {
      try {
        const envelope = JSON.parse(p.payload) as { assets?: { dialogNodes?: unknown[] } };
        const nodes = envelope.assets?.dialogNodes ?? [];
        const hasAny = nodes.some((raw) => {
          const node = raw as { outputs?: unknown };
          const outputs = Array.isArray(node.outputs) ? (node.outputs as DialogOutput[]) : [];
          return nodeHasV1PlainHeader(outputs);
        });
        if (hasAny) count += 1;
      } catch {
        // 손상되었거나 형식이 다른 스냅샷은 건너뛴다(위험 집계 과소 계상 — 알려진 한계).
      }
    }
    return count;
  }
}
