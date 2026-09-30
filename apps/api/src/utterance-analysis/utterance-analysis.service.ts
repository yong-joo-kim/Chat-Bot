import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { maskPii } from '@chat-bot/pii-mask';
import {
  UtteranceAnalysisConditionsSchema,
  UtterancePreviewQuerySchema,
} from '@chat-bot/shared-types';
import type {
  AnalyzedUtterance,
  AnalyzedUtteranceListQuery,
  ClusterRenameRequest,
  Paginated,
  StartUtteranceAnalysisResponse,
  UtteranceAnalysisCapability,
  UtteranceAnalysisConditions,
  UtteranceAnalysisDetail,
  UtteranceAnalysisListItem,
  UtteranceAnalysisListQuery,
  UtteranceCluster,
  UtterancePreviewResponse,
} from '@chat-bot/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { ApiException } from '../common/api.exception';
import { toPaginated } from '../common/pagination';
import { checkEgress } from '../common/egress/egress-guard';
import { AuditLogService } from '../audit-logs/audit-log.service';
import { ChatbotScopeService } from '../chatbots/chatbot-scope.service';
import { BannedWordFilterService } from '../banned-words/banned-word-filter.service';
import { TrainingJobQueue } from '../training-jobs/training-job.queue';
import { UtteranceAnalysisStore } from './core/utterance-analysis.store';
import { UtteranceUploadParser } from './upload/utterance-upload.parser';
import type { UploadedUtteranceFile } from './upload/utterance-upload.parser';
import { maskFileName, prepareUtterances } from './lib/prepare-utterances';
import type { MaskDeps, PrepareResult } from './lib/prepare-utterances';
import { CLUSTERING_ALGORITHM } from './lib/spherical-kmeans';
import { UtteranceAnalysisJobRunner } from './run/utterance-analysis-job.runner';
import { UtteranceAnalysisStatusSink } from './run/utterance-analysis-status.sink';
import { UtteranceAnalysisCancelRegistry } from './run/utterance-analysis-cancel.registry';
import { AnalysisEmbeddingSource } from './run/analysis-embedding.source';
import { yieldToEventLoop } from './run/analysis-cancelled.error';
import { ClusterNameSuggesterFactory } from './naming/cluster-name-suggester.factory';
import { readUtteranceAnalysisConfig } from './utterance-analysis.config';
import type { UtteranceAnalysisConfig } from './utterance-analysis.config';
import { parseCounts, toClusterDto, toDetail, toListItem, toUtteranceDto } from './utterance-analysis.mapper';
import type { ClusterRepresentativeTexts } from './utterance-analysis.mapper';

const NOT_FOUND_MESSAGE = '요청하신 분석을 찾을 수 없습니다.';
const TERMINAL = ['SUCCEEDED', 'FAILED', 'CANCELLED'] as const;

function isUniqueConstraintViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002';
}

/**
 * 발화 묶음 분석 서비스(No.21 — 설계서 §7·§8·§12). 요청 검증 미리보기 · 요청(사전 검사 §7.4) · 목록 · 상세 ·
 * 발화 목록 · 이름 수정 · 취소 · 삭제 · capability · 기동 시 고아 정리.
 *
 * 쓰기는 전부 `UtteranceAnalysisStore`(3테이블 쓰기 유일 파일 — DC-5)가 한다. 이 서비스는 **원본 파일 버퍼를 핸들러
 * 스코프 밖으로 내보내지 않는다** — 파싱 직후 마스킹해 `MaskedUtteranceText[]`만 작업에 넘긴다(DC-8).
 * 로그·오류에 문장·파일 내용을 넣지 않는다(DC-9 — 건수·사유 코드만).
 */
@Injectable()
export class UtteranceAnalysisService implements OnModuleInit {
  private readonly logger = new Logger('UtteranceAnalysisService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly store: UtteranceAnalysisStore,
    private readonly scope: ChatbotScopeService,
    private readonly parser: UtteranceUploadParser,
    private readonly bannedFilter: BannedWordFilterService,
    private readonly embeddingSource: AnalysisEmbeddingSource,
    private readonly nameFactory: ClusterNameSuggesterFactory,
    private readonly queue: TrainingJobQueue,
    private readonly runner: UtteranceAnalysisJobRunner,
    private readonly statusSink: UtteranceAnalysisStatusSink,
    private readonly cancelRegistry: UtteranceAnalysisCancelRegistry,
    private readonly auditLog: AuditLogService,
    private readonly config: ConfigService,
  ) {}

  /** 기동 시 고아 정리(§8.4 · AC-DC7-5) — 메모리에 있던 마스킹 문장은 사라졌으므로 재개하지 않는다. */
  async onModuleInit(): Promise<void> {
    const count = await this.store.failOrphans();
    if (count > 0) this.logger.warn(`기동 시 고아 분석 ${count}건을 FAILED(SERVER_RESTART)로 정리했습니다.`);
  }

  private cfg(): UtteranceAnalysisConfig {
    return readUtteranceAnalysisConfig(this.config);
  }

  private maskDeps(): MaskDeps {
    return {
      maskBanned: (t) => this.bannedFilter.maskPlainText(t),
      maskPii: (t) => maskPii(t).maskedText,
    };
  }

  private async getRowOrThrow(chatbotId: string, analysisId: string) {
    const row = await this.prisma.utteranceAnalysis.findFirst({ where: { id: analysisId, chatbotId } });
    if (!row) throw new ApiException('NOT_FOUND', 404, NOT_FOUND_MESSAGE);
    return row;
  }

  /** 멀티파트 필드 `conditions`(JSON 문자열)를 파싱·검증한다. 없으면 기본 조건. */
  parseConditions(raw: unknown): UtteranceAnalysisConditions {
    let value: unknown = {};
    if (typeof raw === 'string' && raw.trim() !== '') {
      try {
        value = JSON.parse(raw);
      } catch {
        throw new ApiException('VALIDATION_FAILED', 400, '조건을 확인해 주세요.', [{ field: 'conditions', message: '조건 형식이 올바르지 않습니다.' }]);
      }
    } else if (raw !== undefined && raw !== null && typeof raw === 'object') {
      value = raw;
    }
    const result = UtteranceAnalysisConditionsSchema.safeParse(value);
    if (!result.success) {
      throw new ApiException(
        'VALIDATION_FAILED',
        400,
        '입력값을 확인해 주세요.',
        result.error.issues.map((i) => ({ field: i.path.length > 0 ? i.path.join('.') : 'conditions', message: i.message })),
      );
    }
    return result.data;
  }

  /** 파일 → 정리·마스킹 결과(§7.1~7.2). 원본 파일 버퍼는 이 함수를 벗어나지 않는다. */
  private async prepare(file: UploadedUtteranceFile | undefined, cfg: UtteranceAnalysisConfig): Promise<{ kind: 'XLSX' | 'CSV'; result: PrepareResult }> {
    if (!file) throw new ApiException('IMPORT_FILE_INVALID', 400, '업로드할 파일을 선택해 주세요.');
    const parsed = await this.parser.parse(file, { maxRows: cfg.maxRows, maxFileBytes: cfg.maxFileBytes });
    const result = await prepareUtterances(parsed.rows, this.maskDeps(), { maxChars: cfg.maxChars, yieldEvery: yieldToEventLoop });
    return { kind: parsed.kind, result };
  }

  /**
   * 임베딩 공급원 가용성(③) + 출구 사전 판정(④) 공통 함수(요청·미리보기). 출구가 막혀 연결 자체가 실패한 경우에도
   * 원인(허용되지 않은 주소)을 그대로 알리도록 두 판정을 함께 본다.
   */
  private async assertEmbeddingReady(cfg: UtteranceAnalysisConfig): Promise<void> {
    const blocked = !!cfg.embeddingBaseUrl && checkEgress('EMBEDDING', `${cfg.embeddingBaseUrl}/embed`) === 'BLOCKED';
    const provider = blocked ? undefined : await this.embeddingSource.get();
    if (blocked) {
      throw new ApiException('EGRESS_HOST_NOT_ALLOWED', 409, '데이터 거버넌스 설정에서 문장 분석 서비스 주소가 허용되지 않았습니다. 관리자에게 문의해 주세요.');
    }
    if (!provider) {
      throw new ApiException('EMBEDDING_UNAVAILABLE', 503, '문장 분석 서비스에 연결할 수 없습니다. 잠시 뒤 다시 시도하거나 관리자에게 문의해 주세요.');
    }
  }

  /* ── capability ── */

  async capability(chatbotId: string): Promise<UtteranceAnalysisCapability> {
    const { prodVersionId } = await this.scope.assertReadable(chatbotId);
    const cfg = this.cfg();
    const [serverBusy, chatbotBusy, storedCount] = await Promise.all([
      this.prisma.utteranceAnalysis.count({ where: { activeLock: 'ACTIVE' } }),
      this.prisma.utteranceAnalysis.count({ where: { chatbotId, activeLock: 'ACTIVE' } }),
      this.prisma.utteranceAnalysis.count({ where: { chatbotId } }),
    ]);
    return {
      // 네트워크 호출 0 — 주소 설정 여부 + 출구 허용 판정(순수 계산)만 본다(실제 연결 실패는 요청 시 503).
      embeddingAvailable: cfg.embeddingBaseUrl !== undefined && checkEgress('EMBEDDING', `${cfg.embeddingBaseUrl}/embed`) !== 'BLOCKED',
      nameSuggestAvailable: this.nameFactory.isAvailable(),
      busy: { server: serverBusy > 0, chatbot: chatbotBusy > 0 },
      stored: { count: storedCount, max: cfg.maxStoredPerChatbot },
      limits: { maxFileBytes: cfg.maxFileBytes, maxRows: cfg.maxRows, maxChars: cfg.maxChars },
      retentionDays: cfg.retentionDays,
      envModeEnabled: prodVersionId !== null,
    };
  }

  /* ── 미리보기(저장 0 · 감사 0) ── */

  async preview(chatbotId: string, file: UploadedUtteranceFile | undefined, rawQuery: unknown): Promise<UtterancePreviewResponse> {
    await this.scope.assertReadable(chatbotId);
    const query = UtterancePreviewQuerySchema.safeParse(rawQuery ?? {});
    if (!query.success) {
      throw new ApiException(
        'VALIDATION_FAILED',
        400,
        '입력값을 확인해 주세요.',
        query.error.issues.map((i) => ({ field: i.path.join('.') || '(root)', message: i.message })),
      );
    }
    const minClusterSize = query.data.minClusterSize ?? 5;
    const cfg = this.cfg();
    // 요청과 같은 사전 조건(§7.4 ③④) — 분석할 수 없는 서버면 미리보기 단계에서 알린다.
    await this.assertEmbeddingReady(cfg);
    const { kind, result } = await this.prepare(file, cfg);
    const minValidCount = minClusterSize * 2;
    const canAnalyze = result.counts.validCount >= minValidCount;
    return { ...result.counts, fileKind: kind, canAnalyze, ...(canAnalyze ? {} : { reasonIfNot: 'TOO_FEW' as const }), minValidCount };
  }

  /* ── 요청(§7.4 사전 검사 순서) ── */

  async create(chatbotId: string, file: UploadedUtteranceFile | undefined, conditionsRaw: unknown): Promise<StartUtteranceAnalysisResponse> {
    // ① 기능 스위치는 가드가 처리한다. 보관 챗봇 = 409.
    await this.scope.assertWritable(chatbotId);
    const cfg = this.cfg();

    // ② 조건 검증 — 이름 제안 요청인데 서버에서 꺼져 있으면 400.
    const conditions = this.parseConditions(conditionsRaw);
    if (conditions.nameSuggest && !this.nameFactory.isAvailable()) {
      throw new ApiException('VALIDATION_FAILED', 400, '이 서버에서는 이름 제안을 쓸 수 없습니다.', [{ field: 'nameSuggest', message: '이 서버에서는 이름 제안을 쓸 수 없습니다.' }]);
    }

    // ③ 임베딩 공급원 가용성 · ④ 출구 사전 판정(FR-DC9-4) — 미리보기와 같은 공통 함수.
    await this.assertEmbeddingReady(cfg);
    if (conditions.nameSuggest && cfg.nameSuggestBaseUrl && checkEgress('AUGMENT_LOCAL', `${cfg.nameSuggestBaseUrl}/cluster-label`) === 'BLOCKED') {
      throw new ApiException('EGRESS_HOST_NOT_ALLOWED', 409, '데이터 거버넌스 설정에서 이름 제안 서비스 주소가 허용되지 않았습니다.', [
        { field: 'nameSuggest', message: '이름 제안 서비스 주소가 허용되지 않았습니다. 이름 제안을 끄고 다시 요청해 주세요.' },
      ]);
    }

    // ⑤ 보관 상한(자동 삭제 아님)
    const stored = await this.prisma.utteranceAnalysis.count({ where: { chatbotId } });
    if (stored >= cfg.maxStoredPerChatbot) {
      throw new ApiException('UTTERANCE_ANALYSIS_STORE_FULL', 409, '보관할 수 있는 분석이 가득 찼습니다. 목록에서 오래된 분석을 삭제한 뒤 다시 요청해 주세요.');
    }

    // ⑥ 파일 파싱·정리
    const { kind, result } = await this.prepare(file, cfg);

    // ⑦ 발화 부족
    if (result.counts.validCount < conditions.minClusterSize * 2) {
      throw new ApiException(
        'UTTERANCE_ANALYSIS_TOO_FEW',
        400,
        '발화가 너무 적어 묶을 수 없습니다. 발화를 더 추가하거나 \'묶음 최소 발화 수\'를 줄여 주세요.',
        [{ field: 'minClusterSize', message: `유효한 발화가 ${conditions.minClusterSize * 2}개 이상 필요합니다(현재 ${result.counts.validCount}개).` }],
      );
    }

    // ⑧ 행 생성 = 동시 실행 잠금(서버 전체 1건). 사전 조회는 빠른 거절용일 뿐, 최종 방어선은 유일 제약이다.
    const busyMessage = '다른 분석이 진행 중입니다. 끝난 뒤 다시 요청해 주세요.';
    if (await this.prisma.utteranceAnalysis.findFirst({ where: { activeLock: 'ACTIVE' }, select: { id: true } })) {
      throw new ApiException('UTTERANCE_ANALYSIS_BUSY', 409, busyMessage);
    }
    const fileName = await maskFileName(file?.originalname ?? '', this.maskDeps());
    const actor = this.auditLog.currentActorSnapshot();
    let created: { id: string };
    try {
      created = await this.store.createQueued({
        chatbotId,
        fileName,
        fileKind: kind,
        conditionsJson: JSON.stringify(conditions),
        countsJson: JSON.stringify(result.counts),
        algorithmVersion: CLUSTERING_ALGORITHM.version,
        expiresAt: new Date(Date.now() + cfg.retentionDays * 86_400_000),
        requestedById: actor?.id ?? null,
        requestedByEmail: actor?.email ?? null,
      });
    } catch (e) {
      if (isUniqueConstraintViolation(e)) throw new ApiException('UTTERANCE_ANALYSIS_BUSY', 409, busyMessage);
      throw e;
    }

    // ⑨ 감사(CREATE — 외부 데이터 반입 기록) → 작업 적재 → 202
    await this.auditLog.record({
      action: 'CREATE',
      targetType: 'UtteranceAnalysis',
      targetId: created.id,
      targetName: `분석 ${created.id.slice(0, 8)}`,
      chatbotId,
      after: { validCount: result.counts.validCount, totalRows: result.counts.totalRows, conditions, fileKind: kind },
      summary: `발화 묶음 분석 요청(유효 ${result.counts.validCount}건)`,
    });

    this.cancelRegistry.clear(created.id);
    const utterances = result.utterances;
    this.queue.enqueue(created.id, (ctx) => this.runner.run({ analysisId: created.id, chatbotId, conditions, utterances }, ctx), this.statusSink);
    return { analysisId: created.id, status: 'QUEUED' };
  }

  /* ── 조회 ── */

  async list(chatbotId: string, query: UtteranceAnalysisListQuery): Promise<Paginated<UtteranceAnalysisListItem>> {
    await this.scope.assertReadable(chatbotId);
    const where = { chatbotId, ...(query.status && query.status.length > 0 ? { status: { in: query.status } } : {}) };
    const [rows, total] = await Promise.all([
      this.prisma.utteranceAnalysis.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
      this.prisma.utteranceAnalysis.count({ where }),
    ]);
    return toPaginated(rows.map(toListItem), total, query.page, query.pageSize);
  }

  /** 대표 발화 텍스트 — 묶음의 `representativeSeqs`를 한 번에 조회한다. */
  private async loadRepresentatives(analysisId: string, clusterRows: { representativeSeqs: string }[]): Promise<ClusterRepresentativeTexts> {
    const seqs = new Set<number>();
    for (const c of clusterRows) {
      try {
        const parsed = JSON.parse(c.representativeSeqs) as unknown;
        if (Array.isArray(parsed)) for (const s of parsed) if (typeof s === 'number') seqs.add(s);
      } catch {
        // 손상된 JSON은 대표 발화 없이 진행한다.
      }
    }
    if (seqs.size === 0) return { bySeq: new Map() };
    const rows = await this.prisma.analyzedUtterance.findMany({ where: { analysisId, seq: { in: [...seqs] } }, select: { id: true, seq: true, text: true } });
    return { bySeq: new Map(rows.map((r) => [r.seq, { utteranceId: r.id, text: r.text }])) };
  }

  async getDetail(chatbotId: string, analysisId: string): Promise<UtteranceAnalysisDetail> {
    await this.scope.assertReadable(chatbotId);
    const row = await this.getRowOrThrow(chatbotId, analysisId);
    let clusters: UtteranceCluster[] = [];
    let wouldUseRagCount = 0;
    let staleModel = false;
    if (row.status === 'SUCCEEDED') {
      const clusterRows = await this.prisma.utteranceCluster.findMany({ where: { analysisId }, orderBy: { ordinal: 'asc' } });
      const reps = await this.loadRepresentatives(analysisId, clusterRows);
      clusters = clusterRows.map((c) => toClusterDto(c, reps, row.probeStatus === 'DONE'));
      wouldUseRagCount = await this.prisma.analyzedUtterance.count({ where: { analysisId, wouldUseRag: true } });
      if (row.embeddingModelId) {
        // 네트워크 확인 없이 — 마지막으로 연결된 제공자의 modelId(연결된 적이 없으면 판정하지 않는다).
        const current = this.embeddingSource.knownModelId();
        staleModel = current !== undefined && current !== row.embeddingModelId;
      }
    }
    return toDetail(row, clusters, { staleModel, wouldUseRagCount });
  }

  /** 발화 목록(`seq` 순) — 거버넌스 모드에서 `@AuditView`가 열람 감사를 남긴다. */
  async listUtterances(chatbotId: string, analysisId: string, query: AnalyzedUtteranceListQuery): Promise<Paginated<AnalyzedUtterance>> {
    await this.scope.assertReadable(chatbotId);
    const analysis = await this.getRowOrThrow(chatbotId, analysisId);
    const where = {
      analysisId,
      ...(query.clusterId ? { clusterId: query.clusterId } : {}),
      ...(query.candidateOnly ? { learningCandidate: true } : {}),
      ...(query.unappliedOnly ? { appliedAt: null } : {}),
      ...(query.q ? { text: { contains: query.q } } : {}),
    };
    const [rows, total, clusterRows] = await Promise.all([
      this.prisma.analyzedUtterance.findMany({ where, orderBy: { seq: 'asc' }, skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
      this.prisma.analyzedUtterance.count({ where }),
      this.prisma.utteranceCluster.findMany({ where: { analysisId }, select: { id: true, ordinal: true, autoName: true, customName: true } }),
    ]);
    const clusterById = new Map(clusterRows.map((c) => [c.id, { ordinal: c.ordinal, displayName: c.customName ?? c.autoName }]));
    const probeDone = analysis.probeStatus === 'DONE';
    return toPaginated(
      rows.map((r) => toUtteranceDto(r, clusterById.get(r.clusterId) ?? { ordinal: 0, displayName: '' }, probeDone)),
      total,
      query.page,
      query.pageSize,
    );
  }

  /* ── 쓰기(메모·취소·삭제) ── */

  /** 묶음 이름 수정(§15.6) — 메모 성격이라 자산·감사·스냅샷 0. `null` = 자동 이름으로 되돌림. */
  async renameCluster(chatbotId: string, analysisId: string, clusterId: string, dto: ClusterRenameRequest): Promise<UtteranceCluster> {
    await this.scope.assertWritable(chatbotId);
    const analysis = await this.getRowOrThrow(chatbotId, analysisId);

    let saved: string | null = null;
    if (dto.customName !== null) {
      const evaluated = await this.bannedFilter.evaluateInbound(dto.customName);
      if (evaluated.decision === 'BLOCK') {
        throw new ApiException('BANNED_WORD_BLOCKED', 400, '이름에 사용할 수 없는 표현이 들어 있습니다. 다른 말로 바꿔 주세요.', [
          { field: 'customName', message: '사용할 수 없는 표현이 들어 있습니다.' },
        ]);
      }
      saved = maskPii(dto.customName).maskedText;
    }
    const changed = await this.store.renameCluster(analysisId, clusterId, saved);
    if (changed === 0) throw new ApiException('NOT_FOUND', 404, '요청하신 묶음을 찾을 수 없습니다.');

    const row = await this.prisma.utteranceCluster.findFirstOrThrow({ where: { id: clusterId, analysisId } });
    const reps = await this.loadRepresentatives(analysisId, [row]);
    return toClusterDto(row, reps, analysis.probeStatus === 'DONE');
  }

  /** 취소 CAS(§8.3) — 처리 중·대기 중이고 결과 커밋 전인 분석만. 취소는 감사하지 않는다(TC 실행 취소와 같은 판단). */
  async cancel(chatbotId: string, analysisId: string): Promise<void> {
    await this.scope.assertWritable(chatbotId);
    await this.getRowOrThrow(chatbotId, analysisId);
    const changed = await this.store.cancel(analysisId, chatbotId);
    if (changed === 0) {
      throw new ApiException('INVALID_STATUS_TRANSITION', 409, '이미 끝났거나 저장 중인 분석은 취소할 수 없습니다. 목록에서 결과를 확인해 주세요.');
    }
    this.cancelRegistry.cancel(analysisId);
  }

  /** 수동 삭제(§14.3) — 종결 상태만. 이미 의도에 넣은 예문은 지워지지 않는다. */
  async remove(chatbotId: string, analysisId: string): Promise<void> {
    await this.scope.assertWritable(chatbotId);
    const row = await this.getRowOrThrow(chatbotId, analysisId);
    if (!(TERMINAL as readonly string[]).includes(row.status)) {
      throw new ApiException('INVALID_STATUS_TRANSITION', 409, '처리 중인 분석은 삭제할 수 없습니다. 먼저 취소하거나 끝날 때까지 기다려 주세요.');
    }
    if (row.activeLock !== null) {
      // 취소는 됐지만 러너가 아직 마무리 중이다 — 지우면 잠금이 사라져 새 분석이 겹쳐 돈다.
      throw new ApiException('INVALID_STATUS_TRANSITION', 409, '취소를 정리하는 중입니다. 잠시 뒤 다시 삭제해 주세요.');
    }
    const deleted = await this.store.deleteAnalysis(analysisId, chatbotId);
    if (deleted === 0) throw new ApiException('INVALID_STATUS_TRANSITION', 409, '처리 중인 분석은 삭제할 수 없습니다. 먼저 취소하거나 끝날 때까지 기다려 주세요.');
    // 삭제가 성공한 뒤에 기록한다(실패한 삭제가 감사에 남지 않게).
    await this.auditLog.record({
      action: 'DELETE',
      targetType: 'UtteranceAnalysis',
      targetId: row.id,
      targetName: `분석 ${row.id.slice(0, 8)}`,
      chatbotId,
      after: { clusters: row.clusterCount ?? 0, utterances: parseCounts(row.counts).validCount, appliedCount: row.appliedCount },
      summary: '발화 묶음 분석 결과 삭제',
    });
  }
}
