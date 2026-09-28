import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { KbApproveIngestDto, KbDocumentListQuery, KbDocumentListResponse, KbRunCreateDto, KbRunListResponse, KbRunView } from '@chat-bot/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { ApiException } from '../common/api.exception';
import { AuditLogService } from '../audit-logs/audit-log.service';
import { RagHttpClient } from '../rag/rag-http.client';
import { KbRunStore } from './core/kb-run.store';
import { KbSourcesService } from './kb-sources.service';
import { toKbDocumentView } from './kb-source.mapper';
import { buildRunView } from './lib/build-run-view';
import { isPreviewConfigStale } from './lib/preview-stale';
import { isWithinBulkWindow } from './lib/ingest-lane';

/**
 * [신규 No.43] 수동 실행·중지·적재 승인·이력/문서 조회(쓰기는 `KbRunStore` 경유 — KB-9).
 */
@Injectable()
export class KbRunsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly store: KbRunStore,
    private readonly sourcesService: KbSourcesService,
    private readonly auditLogService: AuditLogService,
    private readonly ragClient: RagHttpClient,
  ) {}

  private async findSourceOrThrow(id: string) {
    const row = await this.prisma.kbSource.findUnique({ where: { id } });
    if (!row) throw new ApiException('NOT_FOUND', 404, '요청하신 지식베이스 소스를 찾을 수 없습니다.');
    return row;
  }

  private ingestAllowed(): { ok: true } | { ok: false; reason: string } {
    if (!this.config.get<string>('KB_INGEST_TRANSPORT_ACK')) return { ok: false, reason: 'TRANSPORT_NOT_ACKNOWLEDGED' };
    if (!this.ragClient.isConfigured()) return { ok: false, reason: 'RAG_NOT_CONFIGURED' };
    return { ok: true };
  }

  async createRun(sourceId: string, dto: KbRunCreateDto, userId: string): Promise<{ runId: string }> {
    const source = await this.findSourceOrThrow(sourceId);
    if (source.activeRunId) throw new ApiException('KB_SOURCE_BUSY', 409, '이미 실행 중인 작업이 있습니다.');
    if (!source.enabled) throw new ApiException('VALIDATION_FAILED', 400, '일시중지된 소스는 실행할 수 없습니다.');

    if (dto.kind !== 'PREVIEW') {
      const approved = source.approvedConfigVersion === source.configVersion && !source.reviewRequiredReason;
      if (!approved) {
        // [3차 보완 · 설계서 :613] 자동 미리보기 복귀(강등) 사유가 있으면 `REVIEW_REQUIRED`를 따로
        // 낸다 — 단순히 "아직 미리보기를 한 번도 안 했다"(`PREVIEW_REQUIRED`)와는 사용자 안내 문구가
        // 달라야 한다(강등은 "다시" 확인이 필요하다는 뜻이라 원인 설명이 다르다).
        const code = source.reviewRequiredReason ? 'REVIEW_REQUIRED' : 'PREVIEW_REQUIRED';
        const message = source.reviewRequiredReason ? '내용이 크게 바뀌어 미리보기를 다시 확인해야 합니다.' : '먼저 미리보기를 확인하고 적재를 시작해야 합니다.';
        throw new ApiException('KB_INGEST_NOT_ALLOWED', 409, message, [{ field: 'kind', message: code }]);
      }
      const gate = this.ingestAllowed();
      if (!gate.ok) throw new ApiException('KB_INGEST_NOT_ALLOWED', 409, '외부 RAG 적재 전제 조건이 충족되지 않았습니다.', [{ field: 'kind', message: gate.reason }]);
    }
    const run = await this.sourcesService.claimAndCreateRun({
      sourceId,
      sourceName: source.name,
      kind: dto.kind,
      trigger: 'MANUAL',
      configVersion: source.configVersion,
      nextRunAt: source.nextRunAt,
      createdById: userId,
      // 정리 확인(GONE 문서 삭제·표시 해제)은 선점에 성공한 같은 트랜잭션에서 한다 — 선점에 지면 아무것도 지우지 않는다.
      acknowledgeCleanup: dto.kind === 'FULL_RESEND' && dto.acknowledgeCleanup === true,
    });
    if (!run) throw new ApiException('KB_SOURCE_BUSY', 409, '이미 실행 중인 작업이 있습니다.');

    await this.auditLogService.record({ action: 'STATUS_CHANGE', targetType: 'KbSource', targetId: sourceId, targetName: source.name, summary: `[수동 실행] ${dto.kind}` });
    return { runId: run.id };
  }

  async approveIngest(sourceId: string, dto: KbApproveIngestDto, userId: string): Promise<{ runId: string }> {
    const source = await this.findSourceOrThrow(sourceId);
    if (source.activeRunId) throw new ApiException('KB_SOURCE_BUSY', 409, '이미 실행 중인 작업이 있습니다.');
    const preview = await this.store.findRun(dto.previewRunId);
    // [R1 리뷰 M-1 계약 보완] configVersion 비교는 `KbSourceResponse.previewStale`과 같은 함수
    // (`isPreviewConfigStale`)를 쓴다 — 두 판정이 서로 달라지는 드리프트를 막는다.
    if (!preview || preview.sourceId !== sourceId || preview.kind !== 'PREVIEW' || preview.status !== 'SUCCEEDED' || isPreviewConfigStale(preview.configVersion, source.configVersion)) {
      throw new ApiException('KB_INGEST_NOT_ALLOWED', 409, '유효한 미리보기 실행이 아닙니다.', [{ field: 'previewRunId', message: 'PREVIEW_STALE' }]);
    }
    // [pass 11 · L-B] 자동 강등(새로 비율·인증 벽) 사유가 있는 소스는 **강등된 실행 이후에 끝난** 미리보기여야 한다 — 승인 SYNC는 새로 비율 판정을 면제받으므로(RG-23) 옛 성공 미리보기 id를 직접 넘겨
    // 방금 강등된 대량 적재를 사람이 새 결과를 보지 않은 채 통과시킬 수 없어야 한다. 강등을 만든 실행이 그 미리보기 자신이면(사람이 그 결과를 보고 승인) 종료 시각이 같아 통과한다(`>=` 아닌 `<`만 거절).
    // 기존 `PREVIEW_STALE`과 같은 계열의 거절이다(새 오류 코드 없음).
    if (source.reviewRequiredReason && preview.finishedAt) {
      const demotedAt = await this.store.findLatestDemotionFinishedAt(sourceId);
      if (demotedAt && preview.finishedAt.getTime() < demotedAt.getTime()) {
        throw new ApiException('KB_INGEST_NOT_ALLOWED', 409, '내용이 크게 바뀌어 적재가 보류된 뒤에 확인한 미리보기가 아닙니다. 미리보기를 다시 실행해 결과를 확인한 뒤 승인해 주세요.', [
          { field: 'previewRunId', message: 'PREVIEW_STALE' },
        ]);
      }
    }
    const gate = this.ingestAllowed();
    if (!gate.ok) throw new ApiException('KB_INGEST_NOT_ALLOWED', 409, '외부 RAG 적재 전제 조건이 충족되지 않았습니다.', [{ field: 'previewRunId', message: gate.reason }]);

    // 적재 승인 기록·소스 선점·실행 행 생성이 한 트랜잭션이다 — 이미 실행 중이라 선점에 실패하면 승인도 남지 않는다.
    const run = await this.sourcesService.claimAndCreateRun({
      sourceId,
      sourceName: source.name,
      kind: 'SYNC',
      trigger: 'APPROVAL',
      configVersion: source.configVersion,
      nextRunAt: source.nextRunAt,
      createdById: userId,
      approval: { configVersion: source.configVersion, userId },
    });
    if (!run) throw new ApiException('KB_SOURCE_BUSY', 409, '이미 실행 중인 작업이 있습니다.');

    await this.auditLogService.record({ action: 'STATUS_CHANGE', targetType: 'KbSource', targetId: sourceId, targetName: source.name, summary: `적재 시작(미리보기 ${dto.previewRunId})` });
    return { runId: run.id };
  }

  async cancelRun(sourceId: string, runId: string, userId: string): Promise<void> {
    const run = await this.store.findRun(runId);
    if (!run || run.sourceId !== sourceId) throw new ApiException('NOT_FOUND', 404, '요청하신 실행을 찾을 수 없습니다.');
    // 중지·작업 정리·소스 선점 해제는 한 트랜잭션이다(중간에 죽어도 소스가 "실행 중"으로 남지 않는다).
    const ok = await this.sourcesService.cancelRunAndRelease(sourceId, runId, new Date(), userId, 'CANCELLED_BY_USER');
    if (ok) {
      await this.auditLogService.record({ action: 'STATUS_CHANGE', targetType: 'KbSource', targetId: sourceId, targetName: run.sourceName, summary: '[수동 실행] 중지' });
    }
  }

  async listRuns(sourceId: string, page: number, pageSize: number): Promise<KbRunListResponse> {
    await this.findSourceOrThrow(sourceId);
    const { items, total } = await this.store.listRuns(sourceId, (page - 1) * pageSize, pageSize);

    // [R1 리뷰 M-1] `countJobsByRun`·`getEtaInputs`가 실행마다 따로 돌던 N+1을 배치 2회로 줄인다
    // (페이지 크기와 무관하게 고정) — 진행률·ETA 계산이 필요한 실행(INGESTING·SUCCEEDED·PARTIAL)만
    // 대상으로 한다.
    const relevantRunIds = items.filter((r) => r.status === 'INGESTING' || r.status === 'SUCCEEDED' || r.status === 'PARTIAL').map((r) => r.id);
    const [countsByRun, etaByRun, waitingCtx] = await Promise.all([this.store.countJobsByRunBatch(relevantRunIds), this.store.getEtaInputsBatch(relevantRunIds), this.store.getWaitingContext(relevantRunIds)]);

    const leaseMs = this.config.get<number>('KB_SYNC_LEASE_MS') ?? 600000;
    const slotCount = this.config.get<number>('KB_INGEST_CONCURRENCY') ?? 1;
    const now = new Date();
    const waiting = { ragReady: waitingCtx.ragReady, bulkWindowOpen: isWithinBulkWindow(this.config.get<string>('KB_INGEST_BULK_WINDOW') ?? '', now), pendingBulk: (id: string) => waitingCtx.pendingBulkByRun.get(id) ?? 0 };
    const views = await Promise.all(
      items.map((r) =>
        buildRunView(r, {
          now,
          leaseMs,
          slotCount,
          waiting,
          countJobsByRun: async (runId) => countsByRun.get(runId) ?? {},
          getEtaInputs: async (runId) => etaByRun.get(runId) ?? { remainingHtmlJobs: 0, remainingFileJobs: 0, recentHtmlAvgSeconds: null, recentFileAvgSeconds: null },
        }),
      ),
    );
    return { items: views, total, page, pageSize };
  }

  async getRun(sourceId: string, runId: string): Promise<KbRunView> {
    const run = await this.store.findRun(runId);
    if (!run || run.sourceId !== sourceId) throw new ApiException('NOT_FOUND', 404, '요청하신 실행을 찾을 수 없습니다.');
    return this.toRunView(run);
  }

  private async toRunView(run: NonNullable<Awaited<ReturnType<KbRunStore['findRun']>>>): Promise<KbRunView> {
    const now = new Date();
    const waitingCtx = await this.store.getWaitingContext([run.id]);
    return buildRunView(run, {
      now,
      waiting: { ragReady: waitingCtx.ragReady, bulkWindowOpen: isWithinBulkWindow(this.config.get<string>('KB_INGEST_BULK_WINDOW') ?? '', now), pendingBulk: (id: string) => waitingCtx.pendingBulkByRun.get(id) ?? 0 },
      leaseMs: this.config.get<number>('KB_SYNC_LEASE_MS') ?? 600000,
      slotCount: this.config.get<number>('KB_INGEST_CONCURRENCY') ?? 1,
      countJobsByRun: (runId) => this.store.countJobsByRun(runId),
      getEtaInputs: (runId) => this.store.getEtaInputs(runId),
    });
  }

  async listDocuments(sourceId: string, query: KbDocumentListQuery): Promise<KbDocumentListResponse> {
    await this.findSourceOrThrow(sourceId);
    const where: Record<string, unknown> = {};
    if (query.state && query.state.length > 0) where.state = { in: query.state };
    if (query.cleanupOnly) where.cleanupReason = { not: null };
    if (query.excludeReason && query.excludeReason.length > 0) where.excludeReason = { in: query.excludeReason };
    if (query.observedChange && query.observedChange.length > 0) where.observedChange = { in: query.observedChange };
    if (query.runId) where.seenRunId = query.runId;

    const page = query.page;
    const pageSize = query.pageSize;
    const { items, total } = await this.store.listDocuments(sourceId, where, (page - 1) * pageSize, pageSize);
    return { items: items.map((i) => toKbDocumentView(i)), total, page, pageSize };
  }
}
