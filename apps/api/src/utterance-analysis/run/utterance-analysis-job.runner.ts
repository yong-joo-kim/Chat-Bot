import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import type { UtteranceAnalysisConditions, UtteranceAnalysisStage } from '@chat-bot/shared-types';
import { EgressBlockedError } from '../../common/egress/egress-guard';
import { EmbeddingModelChangedError, EmbeddingProviderUnavailableError } from '../../embedding/embedding-provider.port';
import type { EmbeddingProvider } from '../../embedding/embedding-provider.port';
import { MorphAnalyzerFactory } from '../../learning/morph/morph-analyzer.factory';
import { BannedWordFilterService } from '../../banned-words/banned-word-filter.service';
import type { TrainingJobTaskContext, TrainingJobTaskResult } from '../../training-jobs/training-job.queue';
import { UtteranceAnalysisStore } from '../core/utterance-analysis.store';
import type { CommitClusterRow, CommitSummary, CommitUtteranceRow } from '../core/utterance-analysis.store';
import { ResultCommitRejectedError } from '../core/utterance-analysis.store';
import { ClusteringCancelledError, sphericalKMeans } from '../lib/spherical-kmeans';
import { compareCodeUnit, postprocessClusters, resolveClusterCount } from '../lib/cluster-postprocess';
import type { ClusterItem } from '../lib/cluster-postprocess';
import { extractKeywordTerms } from '../lib/keyword-tokens';
import { autoClusterName, computeClusterKeywords } from '../lib/cluster-keywords';
import type { ClusterKeyword } from '../lib/cluster-keywords';
import { checkSuggestedName, normalizeSuggestedName } from '../lib/name-sanitize';
import { progressOf } from '../lib/analysis-progress';
import { truncateMasked } from '../lib/prepare-utterances';
import type { PreparedUtterance } from '../lib/prepare-utterances';
import { ClusterNameSuggesterFactory } from '../naming/cluster-name-suggester.factory';
import { readUtteranceAnalysisConfig } from '../utterance-analysis.config';
import { AnalysisEmbeddingSource } from './analysis-embedding.source';
import { AnalysisCancelledError, yieldToEventLoop } from './analysis-cancelled.error';
import { UtteranceAnalysisCancelRegistry } from './utterance-analysis-cancel.registry';
import { UtteranceProbeService } from './utterance-probe.service';
import type { ProbeItemResult } from './utterance-probe.service';

export interface AnalysisJobParams {
  readonly analysisId: string;
  readonly chatbotId: string;
  readonly conditions: UtteranceAnalysisConditions;
  /** 마스킹 완료 발화 — 요청 핸들러에서 넘어온 `MaskedUtteranceText`뿐이다(원본 파일·마스킹 전 문자열은 여기 없다, DC-8). */
  readonly utterances: readonly PreparedUtterance[];
}

/** 실패 사유 코드(문장 0 — §8.5). */
class AnalysisFailure extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = 'AnalysisFailure';
  }
}

const KEYWORD_YIELD_EVERY = 200;
/** 군집 계산의 이벤트 루프 양보 간격(점 수). 결과에는 영향이 없고 최장 점유 시간만 줄인다(기본 256 → 64). */
export const CLUSTERING_SLICE_POINTS = 64;
const PROGRESS_MIN_INTERVAL_MS = 1000;
const SAMPLE_MAX = 5;
const SAMPLE_MAX_CHARS = 300;
const KEYWORD_MAX_CHARS = 30;
const NAMING_KEYWORDS_MAX = 20;

/**
 * 분석 작업 본체(No.21 — 설계서 §3 · §8). 단계: EMBEDDING → CLUSTERING → KEYWORDS → PROBING → (NAMING) → SAVING.
 * 단계마다 취소를 확인하고 진행률을 남긴다(DB 쓰기 1초 1회 이하 — 단계 전환은 즉시).
 *
 * ⚠ **`IntentsService`·`KeywordsService` 심볼 0**(정적 검사 S-3이 `*job.runner.ts`를 자동 검사) — 이 작업은 어떤 자산도
 * 쓰지 않는다. 결과는 `store.commitResults()` 한 트랜잭션으로만 저장된다(부분 결과 0 — NFR-DCR1).
 * 로그·오류에 문장·파일 내용을 넣지 않는다(DC-9 — 건수·사유 코드·시간만).
 */
@Injectable()
export class UtteranceAnalysisJobRunner {
  private readonly logger = new Logger('UtteranceAnalysisJobRunner');

  constructor(
    private readonly store: UtteranceAnalysisStore,
    private readonly embeddingSource: AnalysisEmbeddingSource,
    private readonly probe: UtteranceProbeService,
    private readonly morphFactory: MorphAnalyzerFactory,
    private readonly nameFactory: ClusterNameSuggesterFactory,
    private readonly bannedFilter: BannedWordFilterService,
    private readonly cancelRegistry: UtteranceAnalysisCancelRegistry,
    private readonly config: ConfigService,
  ) {}

  /** `TrainingJobQueue`에 넘기는 작업 — 예외를 던지지 않고 사유 코드로 돌려준다(큐가 예외 message를 기록/로그하므로). */
  async run(params: AnalysisJobParams, _ctx?: TrainingJobTaskContext): Promise<TrainingJobTaskResult> {
    const started = Date.now();
    let stage: UtteranceAnalysisStage = 'EMBEDDING';
    const setStage = (s: UtteranceAnalysisStage) => {
      stage = s;
    };
    try {
      await this.execute(params, setStage);
      return { status: 'SUCCEEDED', resultSummary: { durationMs: Date.now() - started } };
    } catch (e) {
      const reason = this.classify(e, stage, params.analysisId);
      // 문장·파일 내용·예외 message를 남기지 않는다 — 사유 코드·단계·경과 시간만.
      this.logger.warn(`발화 묶음 분석 실패: id=${params.analysisId} stage=${stage} reason=${reason} elapsedMs=${Date.now() - started}`);
      return { status: 'FAILED', failureReason: reason };
    }
  }

  private classify(e: unknown, stage: UtteranceAnalysisStage, analysisId: string): string {
    if (e instanceof AnalysisCancelledError || e instanceof ClusteringCancelledError) return 'CANCELLED';
    if (e instanceof AnalysisFailure) return e.reason;
    if (e instanceof ResultCommitRejectedError) return this.cancelRegistry.isCancelled(analysisId) ? 'CANCELLED' : 'SAVE_FAILED';
    if (stage === 'CLUSTERING') return 'CLUSTERING_FAILED';
    if (stage === 'SAVING') return this.cancelRegistry.isCancelled(analysisId) ? 'CANCELLED' : 'SAVE_FAILED';
    return 'INTERNAL_ERROR';
  }

  private async execute(params: AnalysisJobParams, setStage: (s: UtteranceAnalysisStage) => void): Promise<void> {
    const { analysisId, chatbotId, conditions } = params;
    const cfg = readUtteranceAnalysisConfig(this.config);
    const plan = { probe: conditions.probe.enabled, nameSuggest: conditions.nameSuggest };
    const isCancelled = () => this.cancelRegistry.isCancelled(analysisId);
    const now = new Date(); // 작업 시작 시각 1개로 고정(대조 재현성 — §9.2)

    // 진행률 DB 쓰기 1초 1회 이하(단계 전환은 즉시).
    let lastWriteAt = 0;
    const report = async (stage: UtteranceAnalysisStage, fraction: number, force = false): Promise<void> => {
      const nowMs = Date.now();
      if (!force && nowMs - lastWriteAt < PROGRESS_MIN_INTERVAL_MS) return;
      lastWriteAt = nowMs;
      await this.store.updateProgress(analysisId, progressOf(stage, fraction, plan), stage);
    };
    const enterStage = async (s: UtteranceAnalysisStage): Promise<void> => {
      setStage(s);
      if (isCancelled()) throw new AnalysisCancelledError();
      await report(s, 0, true);
    };

    // 입력 순서 = 정규화 문자열 오름차순(파일 행 순서가 결과를 바꾸지 않는다 — §5.3)
    const sorted = [...params.utterances].sort((a, b) => compareCodeUnit(a.normalized, b.normalized));
    const n = sorted.length;

    // ── EMBEDDING ──
    await enterStage('EMBEDDING');
    const provider = await this.embeddingSource.get();
    if (!provider) throw new AnalysisFailure('EMBEDDING_UNAVAILABLE');
    const vectors = await this.embedAll(provider, sorted, cfg, isCancelled, (f) => report('EMBEDDING', f));

    // ── CLUSTERING ──
    await enterStage('CLUSTERING');
    const resolvedK = resolveClusterCount(n, conditions.minClusterSize, conditions.targetClusterCount);
    if (resolvedK.tooFew) throw new AnalysisFailure('CLUSTERING_FAILED');
    const km = await sphericalKMeans(vectors, resolvedK.k, { yieldEvery: yieldToEventLoop, isCancelled, slicePoints: CLUSTERING_SLICE_POINTS });
    const clusterItems: ClusterItem[] = sorted.map((u, i) => ({ normalized: u.normalized, count: u.count, assignment: km.assignments[i], similarity: km.similarities[i] }));
    const post = postprocessClusters({ items: clusterItems, minClusterSize: conditions.minClusterSize, targetClusterCount: conditions.targetClusterCount, usedK: resolvedK.k });

    // ── KEYWORDS ──
    await enterStage('KEYWORDS');
    const analyzer = this.morphFactory.getAnalyzer();
    const notices: string[] = [...post.notices];
    if (analyzer.analyzerId.startsWith('heuristic')) notices.push('HEURISTIC_ANALYZER');
    const termsByItem: string[][] = new Array(n);
    for (let i = 0; i < n; i += 1) {
      if (i % KEYWORD_YIELD_EVERY === 0) {
        if (isCancelled()) throw new AnalysisCancelledError();
        if (i > 0) {
          await report('KEYWORDS', i / n);
          await yieldToEventLoop();
        }
      }
      termsByItem[i] = extractKeywordTerms(sorted[i].text, analyzer, { nounsOnly: conditions.nounsOnly });
    }
    const keywordsByCluster: ClusterKeyword[][] = computeClusterKeywords(
      post.clusters.map((c) => ({ docs: c.itemIndexes.map((i) => termsByItem[i]) })),
      conditions.keywordCount,
    );

    // ── PROBING ──
    let probeItems: readonly ProbeItemResult[] | null = null;
    let probeSummary: Pick<CommitSummary, 'probeStatus' | 'probeFailureReason' | 'probeTargetKind' | 'probeVersionId' | 'probeVersionNo' | 'probeContentHash' | 'probeThreshold'> = {
      probeStatus: 'OFF',
      probeFailureReason: null,
      probeTargetKind: null,
      probeVersionId: null,
      probeVersionNo: null,
      probeContentHash: null,
      probeThreshold: null,
    };
    if (plan.probe) {
      await enterStage('PROBING');
      const outcome = await this.probe.probe({
        chatbotId,
        target: conditions.probe.target,
        scoreThreshold: conditions.probe.scoreThreshold,
        modelId: provider.modelId,
        items: sorted.map((u, i) => ({ text: u.text, vector: vectors[i] })),
        now,
        isCancelled,
        onProgress: (f) => void report('PROBING', f),
      });
      if (outcome.status === 'DONE') {
        probeItems = outcome.items;
        probeSummary = {
          probeStatus: 'DONE',
          probeFailureReason: null,
          probeTargetKind: outcome.targetKind,
          probeVersionId: outcome.versionId,
          probeVersionNo: outcome.versionNo,
          probeContentHash: outcome.contentHash,
          probeThreshold: outcome.threshold,
        };
      } else {
        probeSummary = {
          probeStatus: 'FAILED',
          probeFailureReason: outcome.failureReason,
          probeTargetKind: outcome.targetKind,
          probeVersionId: outcome.versionId,
          probeVersionNo: outcome.versionNo,
          probeContentHash: outcome.contentHash,
          probeThreshold: outcome.threshold,
        };
      }
    }

    // ── NAMING(켰을 때만) ──
    const suggestedByOrdinal = new Map<number, string>();
    let nameStatus: CommitSummary['nameSuggestStatus'] = 'OFF';
    let nameFailure: string | null = null;
    if (plan.nameSuggest) {
      const suggester = this.nameFactory.create();
      if (suggester) {
        await enterStage('NAMING');
        const res = await this.suggestNames(suggester, post.clusters, sorted, keywordsByCluster, cfg.nameSuggestBudgetMs, isCancelled, (f) => report('NAMING', f));
        for (const [ordinal, name] of res.names) suggestedByOrdinal.set(ordinal, name);
        nameStatus = res.status;
        nameFailure = res.failureReason;
      }
    }

    // ── SAVING ──
    await enterStage('SAVING');
    const clusterRows: CommitClusterRow[] = [];
    const clusterIdByOrdinal = new Map<number, string>();
    const candidateByItem = probeItems ? probeItems.map((p) => p.learningCandidate) : null;
    post.clusters.forEach((c, idx) => {
      const id = randomUUID();
      clusterIdByOrdinal.set(c.ordinal, id);
      const keywords = keywordsByCluster[idx] ?? [];
      const candidateCount = candidateByItem ? c.itemIndexes.filter((i) => candidateByItem[i]).length : 0;
      clusterRows.push({
        id,
        ordinal: c.ordinal,
        unassigned: c.unassigned,
        keywordsJson: JSON.stringify(keywords),
        autoName: autoClusterName(keywords, c.ordinal, c.unassigned),
        suggestedName: suggestedByOrdinal.get(c.ordinal) ?? null,
        utteranceCount: c.uniqueCount,
        occurrenceSum: c.occurrenceSum,
        candidateCount,
        representativeSeqsJson: JSON.stringify(c.representativeIndexes.map((i) => post.seqByItem[i])),
      });
    });

    const utteranceRows: CommitUtteranceRow[] = [];
    for (let k = 0; k < post.itemOrder.length; k += 1) {
      const i = post.itemOrder[k];
      const u = sorted[i];
      const p = probeItems ? probeItems[i] : null;
      utteranceRows.push({
        clusterId: clusterIdByOrdinal.get(post.ordinalByItem[i]) as string,
        seq: post.seqByItem[i],
        text: u.text,
        textNormalized: u.normalized,
        occurrenceCount: u.count,
        sourceMemo: u.memo,
        hasBannedWord: u.hasBannedWord,
        hasMaskToken: u.hasMaskToken,
        similarityToCentroid: round4(km.similarities[i]),
        probeAnswered: p ? p.answered : null,
        probeMatchKind: p ? p.matchKind : null,
        probeMatchId: p ? p.matchId : null,
        probeMatchName: p ? p.matchName : null,
        probeBand: p ? p.band : null,
        probeScore: p ? p.score : null,
        wouldUseRag: p ? p.wouldUseRag : false,
        learningCandidate: p ? p.learningCandidate : false,
        suggestedIntentsJson: JSON.stringify(p ? p.suggestedIntents : []),
      });
    }

    if (isCancelled()) throw new AnalysisCancelledError();
    const unassigned = post.clusters.find((c) => c.unassigned);
    const summary: CommitSummary = {
      clusterCount: post.clusterCount,
      unassignedCount: unassigned ? unassigned.uniqueCount : 0,
      candidateCount: candidateByItem ? candidateByItem.filter(Boolean).length : 0,
      noticesJson: JSON.stringify(notices),
      embeddingModelId: provider.modelId,
      analyzerId: analyzer.analyzerId,
      ...probeSummary,
      nameSuggestStatus: nameStatus,
      nameSuggestFailureReason: nameFailure,
    };
    await this.store.commitResults(analysisId, summary, clusterRows, utteranceRows);
  }

  /** §8.6 — 배치 16 · 적응형 양보(배치 소요 × 비율만큼 쉰다) · 모델 변경 감지. */
  private async embedAll(
    provider: EmbeddingProvider,
    sorted: readonly PreparedUtterance[],
    cfg: ReturnType<typeof readUtteranceAnalysisConfig>,
    isCancelled: () => boolean,
    report: (fraction: number) => Promise<void>,
  ): Promise<Float32Array[]> {
    const vectors: Float32Array[] = [];
    const batchSize = Math.max(1, cfg.embedBatchSize);
    for (let i = 0; i < sorted.length; i += batchSize) {
      if (isCancelled()) throw new AnalysisCancelledError();
      const batch = sorted.slice(i, i + batchSize).map((u) => u.text as string);
      const t0 = Date.now();
      let out: Float32Array[];
      try {
        out = await provider.embed(batch, 'QUERY');
      } catch (e) {
        throw new AnalysisFailure(this.embeddingFailureReason(e));
      }
      if (out.length !== batch.length || out.some((v) => v.length !== provider.dimension)) {
        throw new AnalysisFailure('EMBEDDING_MODEL_CHANGED');
      }
      vectors.push(...out);
      await report(vectors.length / sorted.length);
      if (i + batchSize < sorted.length) {
        const elapsed = Date.now() - t0;
        const pause = Math.max(cfg.embedPauseMs, Math.round(elapsed * cfg.embedYieldRatio));
        await sleep(pause);
      }
    }
    return vectors;
  }

  private embeddingFailureReason(e: unknown): string {
    if (e instanceof EgressBlockedError) return 'EGRESS_BLOCKED';
    if (e instanceof EmbeddingModelChangedError) return 'EMBEDDING_MODEL_CHANGED';
    if (e instanceof EmbeddingProviderUnavailableError) {
      if (e.cause instanceof EgressBlockedError) return 'EGRESS_BLOCKED';
    }
    return 'EMBEDDING_UNAVAILABLE';
  }

  /** §16.3 — 묶음 `ordinal` 오름차순 · 직렬 1건씩 · 미분류 제외 · 단계 예산 · 출력 검사(§16.5). */
  private async suggestNames(
    suggester: NonNullable<ReturnType<ClusterNameSuggesterFactory['create']>>,
    clusters: ReturnType<typeof postprocessClusters>['clusters'],
    sorted: readonly PreparedUtterance[],
    keywordsByCluster: readonly ClusterKeyword[][],
    budgetMs: number,
    isCancelled: () => boolean,
    report: (fraction: number) => Promise<void>,
  ): Promise<{ names: Map<number, string>; status: CommitSummary['nameSuggestStatus']; failureReason: string | null }> {
    const names = new Map<number, string>();
    // 미분류·키워드 없는 묶음은 요청하지 않는다(계약: 키워드 1~20).
    const targets = clusters.map((c, idx) => ({ c, idx })).filter((t) => !t.c.unassigned && (keywordsByCluster[t.idx] ?? []).length > 0);
    const deadline = Date.now() + budgetMs;
    let answeredRaw = 0;
    let budgetExhausted = false;

    for (let t = 0; t < targets.length; t += 1) {
      if (isCancelled()) throw new AnalysisCancelledError();
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        budgetExhausted = true;
        break;
      }
      const { c, idx } = targets[t];
      const keywords = (keywordsByCluster[idx] ?? []).map((k) => k.term.slice(0, KEYWORD_MAX_CHARS)).slice(0, NAMING_KEYWORDS_MAX);
      const samples = c.itemIndexes.slice(0, SAMPLE_MAX).map((i) => truncateMasked(sorted[i].text, SAMPLE_MAX_CHARS)); // 계약: 표본 각 ≤300자

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), remaining);
      let raw: string | null = null;
      try {
        raw = await suggester.suggest({ keywords, samples }, controller.signal);
      } catch {
        raw = null; // 포트 계약상 예외는 없지만 방어한다.
      } finally {
        clearTimeout(timer);
      }
      if (raw !== null && raw.trim() !== '') {
        answeredRaw += 1;
        const normalized = normalizeSuggestedName(raw);
        const banned = (await this.bannedFilter.evaluateInbound(normalized)).matches.length > 0;
        const checked = checkSuggestedName(normalized, banned);
        if (checked) names.set(c.ordinal, checked);
      }
      await report((t + 1) / targets.length);
    }

    // 예산이 바닥나 요청하지 못한 묶음이 있으면 성공 수가 요청 대상 수에 못 미친다(PARTIAL/FAILED).
    if (targets.length === 0) return { names, status: 'OFF', failureReason: null };
    if (names.size === targets.length) return { names, status: 'DONE', failureReason: null };
    if (names.size > 0) return { names, status: 'PARTIAL', failureReason: budgetExhausted ? 'TIMEOUT' : null };
    return { names, status: 'FAILED', failureReason: budgetExhausted ? 'TIMEOUT' : answeredRaw === 0 ? 'NAME_SUGGEST_UNAVAILABLE' : 'NAME_REJECTED' };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function round4(x: number): number {
  return Math.round(x * 10000) / 10000;
}
