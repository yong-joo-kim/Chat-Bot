import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { buildDialogueIndex, judgeBand, mergeOverlay, normalizeText, resolveTurn } from '@chat-bot/dialogue-engine';
import type { DialogueIndex } from '@chat-bot/dialogue-engine';
import {
  isApiConditionV2,
  type ChatbotAnswerSetting,
  type DialogOutput,
  type DialogOutputType,
  type DialogueBundle,
  type DialogueOverlay,
  type ResolvedBundleTarget,
  type TestCaseExpectedKind,
  type TestCaseResultKind,
  type TestRunOverlaySource,
  type TestRunResultBand,
  type TestRunSideSummary,
} from '@chat-bot/shared-types';
import { PrismaService } from '../../prisma/prisma.service';
import { DialogueBundleService } from '../../dialogue-common/dialogue-bundle.service';
import { ApiConnectionCatalogService } from '../../api-connections/catalog/api-connection-catalog.service';
import type { MockSource } from '../../api-connections/catalog/api-connection-catalog.service';
import { resolveMockOutcome } from '../../api-connections/catalog/lib/mock-outcome';
import { completeApiTurnSync } from '../../common/lib/api-turn';
import { EmbeddingProviderFactory } from '../../embedding/embedding-provider.factory';
import { VectorCacheService } from '../../embedding/vector-cache.service';
import type { CachedVectorEntry } from '../../embedding/vector-cache.service';
import { AnswerSettingsCacheService } from '../../answer-settings/answer-settings-cache.service';
import { assembleSemanticInput } from '../../embedding/lib/assemble-semantic-input';
import { textHashOf } from '../../embedding/lib/text-hash';
import { VersionBundleService } from '../../environment/serving/version-bundle.service';
import { VersionVectorResolver } from '../../embedding/version-vectors/version-vector.resolver';
import type { SemanticMatchVectorSource } from '../../embedding/semantic-match.service';
import { assertOverlaySize, toBundleOverlayPatch } from '../../simulation/lib/overlay-convert';
import { serializeOutputsForDiff } from '../../common/lib/output-diff';
import { detect, decide } from '../../banned-words/lib/banned-word-filter';
import type { BannedWordEntry } from '../../banned-words/lib/banned-word-filter';
import { judgeTestCase } from '../lib/judge-test-case';
import type { JudgeTestCaseLiveIds } from '../lib/judge-test-case';
import { summarizeRun } from '../lib/summarize-run';
import { buildEnvFingerprint } from '../lib/env-fingerprint';
import { buildOutputsPreview } from '../lib/build-outputs-preview';
import { TestRunEmbeddingService } from './test-run-embedding.service';
import { TestRunOverlayBuilder } from './test-run-overlay.builder';
import { TestRunRagService } from './test-run-rag.service';
import { TestRunCancelRegistry } from './test-run-cancel.registry';

const BANNED_WORD_GUIDANCE_TEXT = '바람직하지 않은 표현이 포함되어 있습니다. 다시 입력해 주세요.';
const FLUSH_EVERY = 20;

export interface TestRunExecutionParams {
  chatbotId: string;
  runId: string;
  setId: string;
  mode: 'SINGLE' | 'OVERLAY_COMPARE';
  overlaySource: TestRunOverlaySource;
  overlay?: DialogueOverlay;
  suggestionIds?: string[];
  useRag: boolean;
  /** [신규 No.40 — §12.2] 시작 시점에 해석·고정된 대상(미지정 = 초안, 기존과 동일). */
  target?: { kind: 'STAGING' | 'PROD' | 'VERSION'; versionId: string };
}

interface SideOutcome {
  matchedIntentId?: string;
  matchedFaqId?: string;
  matchedNodeId?: string;
  outputs: DialogOutput[];
  unsupportedOutputs: DialogOutputType[];
  bandKind?: TestRunResultBand;
  top1Score?: number;
  top1Kind?: 'FAQ' | 'INTENT';
  top1Id?: string;
  marginToTop2?: number;
  blockedByFilter: boolean;
  elapsedMs: number;
  /** [No.26] 마지막 턴 기준 — 샘플 해시 앞 8자리 | 'NO_SAMPLE' | null(관여 없음, FR-L7-6). */
  apiMock: string | null;
  /** [No.27] 실행 중 한 턴이라도 설문 미리보기 판정이 관여했는가(§7.4). */
  surveyPreview: boolean;
}

interface ResultRow {
  caseId: string;
  seq: number;
  questionText: string;
  expectedKind: TestCaseExpectedKind;
  expectedTargetId: string | null;
  resultA: TestCaseResultKind;
  a: SideOutcome;
  resultB?: TestCaseResultKind;
  b?: SideOutcome;
  wouldUseRagA: boolean;
  ragAttemptedA: boolean;
  ragLatencyMsA?: number;
  ragSourceCountA?: number;
}

function buildLiveIds(bundle: Pick<DialogueBundle, 'intents' | 'faqs' | 'dialogNodes'>): JudgeTestCaseLiveIds {
  return {
    intents: new Set(bundle.intents.map((i) => i.id)),
    faqs: new Set(bundle.faqs.map((f) => f.id)),
    nodes: new Set(bundle.dialogNodes.map((n) => n.id)),
  };
}

/**
 * 대량 실행 루프(§7, ADR-0030) — **`ConversationLogService`·`QueryEmbeddingService`를 주입하지
 * 않는다**(정적 검사가 단언). 번들·인덱스·벡터 맵은 실행당 각 1회 로드하고(N+1 금지), 질문
 * 임베딩은 실행 로컬 배치로 수행해 전역 질의 임베딩 LRU 캐시를 오염시키지 않는다(J-8).
 */
@Injectable()
export class TestRunExecutor {
  private readonly logger = new Logger('TestRunExecutor');

  constructor(
    private readonly prisma: PrismaService,
    private readonly bundleService: DialogueBundleService,
    private readonly embeddingFactory: EmbeddingProviderFactory,
    private readonly vectorCache: VectorCacheService,
    private readonly answerSettingsCache: AnswerSettingsCacheService,
    private readonly runEmbedding: TestRunEmbeddingService,
    private readonly overlayBuilder: TestRunOverlayBuilder,
    private readonly ragService: TestRunRagService,
    private readonly cancelRegistry: TestRunCancelRegistry,
    private readonly config: ConfigService,
    private readonly apiConnectionCatalog: ApiConnectionCatalogService,
    // [신규 No.40 — §12.2, 생성자 끝] 대상 선택 — 초안 경로 호출 순서·인자는 불변이다.
    private readonly versionBundles: VersionBundleService,
    private readonly versionVectorResolver: VersionVectorResolver,
  ) {}

  /** [No.26] 번들의 v2 API_CONDITION이 참조하는 연결 id를 모은다(목 원천 로드 대상 산출). */
  private collectApiConnectionIds(bundle: DialogueBundle): string[] {
    const ids = new Set<string>();
    for (const node of bundle.dialogNodes) {
      for (const output of node.outputs) {
        if (output.type === 'API_CONDITION' && isApiConditionV2(output.payload)) ids.add(output.payload.connectionId);
      }
    }
    return [...ids];
  }

  async execute(params: TestRunExecutionParams): Promise<{ status: 'SUCCEEDED' | 'FAILED'; resultSummary?: Record<string, unknown>; failureReason?: string }> {
    const { chatbotId, runId, setId, mode, overlaySource, overlay, suggestionIds, useRag } = params;
    const now = new Date(); // 고정된 단일 now — 실행 소요 시간에 재현성이 영향받지 않는다(FR-V1-18).

    const cases = await this.prisma.testCase.findMany({ where: { setId, enabled: true }, orderBy: { seq: 'asc' } });
    if (cases.length === 0) {
      return { status: 'FAILED', failureReason: 'TEST_SET_EMPTY' };
    }

    await this.prisma.testRun.update({ where: { id: runId }, data: { totalCount: cases.length } });

    // [신규 No.40 — §12.2] 대상이 있으면(비초안) 버전 번들에서 A측을 조립한다. 초안 경로는 기존
    // 두 호출(getCached·answerSettingsCache)을 그대로 한다.
    let bundleA: DialogueBundle;
    let indexA: DialogueIndex;
    let settings: ChatbotAnswerSetting;
    let versionSemanticSource: SemanticMatchVectorSource | undefined;
    let resolvedTarget: (ResolvedBundleTarget & { contentHash: string }) | undefined;
    if (params.target) {
      let s;
      try {
        s = await this.versionBundles.get(chatbotId, params.target.versionId, { topics: 'ACTIVE_ONLY' });
      } catch {
        // [신규 No.40 — §7.6] 버전 읽기 실패 — 초안으로 대체하지 않는다.
        return { status: 'FAILED', failureReason: 'TARGET_VERSION_UNREADABLE' };
      }
      bundleA = s.bundle;
      indexA = s.index;
      settings = s.settings;
      versionSemanticSource = s.semanticSource;
      const semanticMissing = s.slots.length - (s.semanticSource?.entries.length ?? 0);
      resolvedTarget = {
        kind: params.target.kind,
        versionId: s.version.id,
        versionNo: s.version.versionNo,
        legacyTiebreak: s.version.legacyTiebreak,
        semanticMissing: Math.max(semanticMissing, 0),
        contentHash: s.version.contentHash,
      };
    } else {
      const r = await this.bundleService.getCached(chatbotId);
      bundleA = r.bundle;
      indexA = r.index;
      settings = await this.answerSettingsCache.get(chatbotId);
    }
    const liveIdsA = buildLiveIds(bundleA);
    const thresholds = { accept: settings.acceptThreshold, low: settings.lowThreshold, margin: settings.marginThreshold };

    let bundleB: DialogueBundle | undefined;
    let indexB: DialogueIndex | undefined;
    let liveIdsB: JudgeTestCaseLiveIds | undefined;
    let excludedSuggestions = 0;

    const provider = await this.embeddingFactory.getProvider();
    let degradedMode = settings.semanticEnabled && !provider;

    let overlayVectorTargets: { intentId: string; slotIndex: number; text: string }[] = [];
    if (mode === 'OVERLAY_COMPARE') {
      if (overlaySource === 'INLINE') {
        assertOverlaySize(overlay);
        const patch = toBundleOverlayPatch(chatbotId, overlay, now);
        bundleB = mergeOverlay(bundleA, patch);
      } else if (overlaySource === 'AUGMENTATION_SUGGESTIONS') {
        const built = await this.overlayBuilder.build(chatbotId, bundleA, suggestionIds ?? [], provider?.modelId);
        bundleB = mergeOverlay(bundleA, built.patch);
        overlayVectorTargets = built.vectorTargets;
        excludedSuggestions = built.excludedSuggestionCount;
      } else {
        bundleB = bundleA;
      }
      indexB = buildDialogueIndex(bundleB);
      liveIdsB = buildLiveIds(bundleB);
    }

    // 실행 로컬 배치 임베딩(J-8) — 고유 정규화 문장만, 전역 캐시를 거치지 않는다.
    let embeddingMap: Map<string, Float32Array> | null = null;
    let entriesA: CachedVectorEntry[] = [];
    let entriesB: CachedVectorEntry[] = [];
    if (settings.semanticEnabled && provider) {
      const allTexts: string[] = [];
      for (const c of cases) allTexts.push(...this.parseMessages(c.messages));
      embeddingMap = await this.runEmbedding.embedUniqueTexts(provider, allTexts);
      if (embeddingMap === null) {
        degradedMode = true;
        this.logger.warn(`실행 ${runId} — 배치 임베딩 실패로 저하 모드(규칙 매칭만)로 전환합니다.`);
      } else if (params.target) {
        // [신규 No.40 — §8.3] 버전 대상 — 리졸버가 이미 조립한 "보존 ∪ 초안 같은 해시" 벡터를 쓴다.
        entriesA = (versionSemanticSource?.entries ?? []).map((e) => ({ ...e, textHash: '' }));
        entriesB = entriesA;
      } else {
        const cached = await this.vectorCache.get(chatbotId, provider.modelId);
        entriesA = cached?.entries ?? [];
        entriesB = entriesA;
        if (overlayVectorTargets.length > 0) {
          const vectors = await this.runEmbedding.embedPassages(
            provider,
            overlayVectorTargets.map((t) => t.text),
          );
          if (vectors) {
            const overlayEntries: CachedVectorEntry[] = overlayVectorTargets.map((t, i) => ({
              ownerType: 'INTENT_EXAMPLE',
              ownerId: t.intentId,
              slotIndex: t.slotIndex,
              vector: vectors[i],
              // [신규 No.40] 오버레이 임시 항목 — 보존 저장소 대상이 아니므로 해시는 조립에만 쓰인다.
              textHash: textHashOf(t.text),
            }));
            entriesB = [...entriesA, ...overlayEntries];
          }
        }
      }
    }

    // [No.26] 실행당 목 원천 1회 로드(N+1 금지, FR-L7-5) — A∪B 번들의 v2 connectionId 합집합.
    const apiConnectionIds = new Set([...this.collectApiConnectionIds(bundleA), ...(bundleB ? this.collectApiConnectionIds(bundleB) : [])]);
    const mockSources = await this.apiConnectionCatalog.loadMockSources([...apiConnectionIds]);

    const bannedDict = await this.loadBannedWordDict();
    const ragMaxCalls = this.config.get<number>('TEST_RUN_RAG_MAX_CALLS') ?? 50;
    let ragCallCount = 0;

    const progressMinIntervalMs = this.config.get<number>('TEST_RUN_PROGRESS_MIN_INTERVAL_MS') ?? 1000;
    let pending: ResultRow[] = [];
    let processed = 0;
    let lastFlushAt = Date.now();
    let cancelled = false;

    for (const testCase of cases) {
      if (this.cancelRegistry.isCancelled(runId)) {
        cancelled = true;
        break;
      }

      const messages = this.parseMessages(testCase.messages);
      const questionText = messages[messages.length - 1] ?? '';

      const outcomeA = this.runSide(messages, bundleA, indexA, entriesA, provider?.modelId, settings.semanticEnabled, embeddingMap, thresholds, now, bannedDict, mockSources);
      const ragResultA = await this.ragService.attempt(questionText, outcomeA.bandKind, settings, useRag, ragCallCount < ragMaxCalls);
      if (ragResultA.ragAttempted) ragCallCount += 1;

      let resultA = judgeTestCase(
        { kind: testCase.expectedKind as TestCaseExpectedKind, targetId: testCase.expectedTargetId },
        { matchedIntentId: outcomeA.matchedIntentId, matchedFaqId: outcomeA.matchedFaqId, matchedNodeId: outcomeA.matchedNodeId },
        liveIdsA,
      );
      if (ragResultA.ragAttempted) resultA = 'NOT_JUDGED';

      const row: ResultRow = {
        caseId: testCase.id,
        seq: testCase.seq,
        questionText,
        expectedKind: testCase.expectedKind as TestCaseExpectedKind,
        expectedTargetId: testCase.expectedTargetId,
        resultA,
        a: outcomeA,
        wouldUseRagA: ragResultA.wouldUseRag,
        ragAttemptedA: !!ragResultA.ragAttempted,
        ragLatencyMsA: ragResultA.ragLatencyMs,
        ragSourceCountA: ragResultA.ragSourceCount,
      };

      if (mode === 'OVERLAY_COMPARE' && bundleB && indexB && liveIdsB) {
        const outcomeB = this.runSide(messages, bundleB, indexB, entriesB, provider?.modelId, settings.semanticEnabled, embeddingMap, thresholds, now, bannedDict, mockSources);
        // B 계열은 RAG를 별도로 시도하지 않는다 — RAG 판정 제외 규칙은 A 계열 기준으로 충분하며
        // 실행당 상한을 A/B가 각각 소모하면 예산이 2배로 늘어난다(J-10 상한 취지 유지).
        row.resultB = judgeTestCase(
          { kind: testCase.expectedKind as TestCaseExpectedKind, targetId: testCase.expectedTargetId },
          { matchedIntentId: outcomeB.matchedIntentId, matchedFaqId: outcomeB.matchedFaqId, matchedNodeId: outcomeB.matchedNodeId },
          liveIdsB,
        );
        row.b = outcomeB;
      }

      pending.push(row);
      processed += 1;

      const shouldFlush = pending.length >= FLUSH_EVERY || Date.now() - lastFlushAt >= progressMinIntervalMs;
      if (shouldFlush) {
        await this.flush(runId, pending, ragCallCount, processed, cases.length);
        pending = [];
        lastFlushAt = Date.now();
        await new Promise((resolve) => setImmediate(resolve)); // 배치 경계마다 이벤트 루프 양보(FR-V1-37)
      }
    }

    if (pending.length > 0) {
      await this.flush(runId, pending, ragCallCount, processed, cases.length);
    }

    const allResults = await this.prisma.testRunResult.findMany({ where: { runId } });
    const summaryA = summarizeRun(allResults.map((r) => ({ result: r.resultA as TestCaseResultKind })));
    let summaryB: TestRunSideSummary | undefined;
    let regressed: number | undefined;
    let improved: number | undefined;
    if (mode === 'OVERLAY_COMPARE') {
      const bResults = allResults.filter((r) => r.resultB !== null);
      summaryB = summarizeRun(bResults.map((r) => ({ result: r.resultB as TestCaseResultKind })));
      regressed = allResults.filter((r) => r.resultA === 'PASS' && r.resultB === 'FAIL').length;
      improved = allResults.filter((r) => r.resultA === 'FAIL' && r.resultB === 'PASS').length;
    }

    const envFingerprint = buildEnvFingerprint({
      bundle: bundleA,
      embeddingModelId: provider?.modelId ?? null,
      semanticEnabled: settings.semanticEnabled,
      thresholds,
      degradedMode,
      useRag,
      overlaySource,
      target: resolvedTarget,
    });

    await this.prisma.testRun.update({
      where: { id: runId },
      data: {
        envFingerprint: JSON.stringify(envFingerprint),
        degradedMode,
        ragCallCount,
        processedCount: processed,
        progress: cases.length > 0 ? Math.round((processed / cases.length) * 100) : 100,
      },
    });

    if (cancelled) {
      // markFinished는 CANCELLED 상태를 덮어쓰지 않는다(CAS) — service.cancel()이 이미 상태를 바꿨다.
      return { status: 'SUCCEEDED', resultSummary: { a: summaryA, b: summaryB, regressed, improved, excludedSuggestions } };
    }

    return { status: 'SUCCEEDED', resultSummary: { a: summaryA, b: summaryB, regressed, improved, excludedSuggestions } };
  }

  private async flush(runId: string, rows: ResultRow[], ragCallCount: number, processed: number, total: number): Promise<void> {
    await this.prisma.testRunResult.createMany({
      data: rows.map((r) => ({
        runId,
        caseId: r.caseId,
        seq: r.seq,
        questionText: r.questionText,
        expectedKind: r.expectedKind,
        expectedTargetId: r.expectedTargetId,
        resultA: r.resultA,
        matchedIntentIdA: r.a.matchedIntentId,
        matchedFaqIdA: r.a.matchedFaqId,
        matchedNodeIdA: r.a.matchedNodeId,
        bandA: r.a.bandKind ?? null,
        top1ScoreA: r.a.top1Score ?? null,
        top1KindA: r.a.top1Kind ?? null,
        top1IdA: r.a.top1Id ?? null,
        marginToTop2A: r.a.marginToTop2 ?? null,
        outputsHashA: serializeOutputsForDiff(r.a.outputs),
        outputsPreviewA: buildOutputsPreview(r.a.outputs),
        unsupportedCountA: r.a.unsupportedOutputs.length,
        blockedByFilterA: r.a.blockedByFilter,
        elapsedMsA: r.a.elapsedMs,
        resultB: r.resultB ?? null,
        matchedIntentIdB: r.b?.matchedIntentId ?? null,
        matchedFaqIdB: r.b?.matchedFaqId ?? null,
        matchedNodeIdB: r.b?.matchedNodeId ?? null,
        bandB: r.b?.bandKind ?? null,
        top1ScoreB: r.b?.top1Score ?? null,
        outputsHashB: r.b ? serializeOutputsForDiff(r.b.outputs) : null,
        outputsPreviewB: r.b ? buildOutputsPreview(r.b.outputs) : null,
        diffStatus: r.b ? (serializeOutputsForDiff(r.a.outputs) !== serializeOutputsForDiff(r.b.outputs) || r.a.matchedIntentId !== r.b.matchedIntentId || r.a.matchedFaqId !== r.b.matchedFaqId || r.a.matchedNodeId !== r.b.matchedNodeId ? 'DIFFERENT' : 'SAME') : null,
        wouldUseRag: r.wouldUseRagA,
        ragAttempted: r.ragAttemptedA,
        ragLatencyMs: r.ragLatencyMsA ?? null,
        ragSourceCount: r.ragSourceCountA ?? null,
        apiMockA: r.a.apiMock,
        apiMockB: r.b?.apiMock ?? null,
        surveyPreviewA: r.a.surveyPreview,
        surveyPreviewB: r.b?.surveyPreview ?? false,
      })),
    });
    await this.prisma.testRun.update({
      where: { id: runId },
      data: { processedCount: processed, progress: total > 0 ? Math.round((processed / total) * 100) : 100, ragCallCount },
    });
  }

  private parseMessages(json: string): string[] {
    try {
      const parsed = JSON.parse(json);
      return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
    } catch {
      return [];
    }
  }

  private async loadBannedWordDict(): Promise<BannedWordEntry[]> {
    const rows = await this.prisma.bannedWord.findMany({ where: { enabled: true } });
    return rows.map((r) => ({
      word: r.word,
      wordNormalized: r.wordNormalized,
      matchType: r.matchType as BannedWordEntry['matchType'],
      policy: r.policy as BannedWordEntry['policy'],
    }));
  }

  private runSide(
    messages: string[],
    bundle: DialogueBundle,
    index: DialogueIndex,
    entries: CachedVectorEntry[],
    modelId: string | undefined,
    semanticEnabled: boolean,
    embeddingMap: Map<string, Float32Array> | null,
    thresholds: { accept: number; low: number; margin: number },
    now: Date,
    bannedDict: BannedWordEntry[],
    mockSources: Map<string, MockSource>,
  ): SideOutcome {
    const start = Date.now();
    let state: unknown;
    let outputs: DialogOutput[] = [];
    let unsupportedOutputs: DialogOutputType[] = [];
    let matchedIntentId: string | undefined;
    let matchedFaqId: string | undefined;
    let matchedNodeId: string | undefined;
    let bandKind: TestRunResultBand | undefined;
    let top1Score: number | undefined;
    let top1Kind: 'FAQ' | 'INTENT' | undefined;
    let top1Id: string | undefined;
    let marginToTop2: number | undefined;
    let blockedByFilter = false;
    let apiMock: string | null = null;
    let surveyPreview = false;

    for (const message of messages) {
      apiMock = null; // 마지막 턴 기준(FR-L7-6) — 매 턴 초기화한다.
      const decision = bannedDict.length > 0 ? decide(detect(message, bannedDict)) : 'PASS';
      // 판정은 **마지막 턴** 기준이므로, 이 플래그도 마지막으로 처리한 턴의 상태만 반영한다.
      blockedByFilter = decision === 'BLOCK';
      if (decision === 'BLOCK') {
        outputs = [{ type: 'TEXT', payload: { text: BANNED_WORD_GUIDANCE_TEXT } }];
        unsupportedOutputs = [];
        matchedIntentId = undefined;
        matchedFaqId = undefined;
        matchedNodeId = undefined;
        bandKind = undefined;
        // 세션은 끊기지 않는다(EX-12-26과 동일) — state를 갱신하지 않고 다음 턴으로 넘어간다.
        continue;
      }

      const norm = normalizeText(message);
      const vector = semanticEnabled ? embeddingMap?.get(norm) : undefined;
      const semantic = vector ? assembleSemanticInput(vector, entries, bundle, thresholds, modelId ?? '') : undefined;

      let result = resolveTurn({ message }, state, bundle, now, { index, semantic, surveyPreview: true });
      if (result.trace.some((t) => t.stage === 'SURVEY')) surveyPreview = true;
      // [No.26] 목 완결 — TC는 항상 목이다(ADR-0030 ① — 실제 호출·`ApiCallLog`·`ConversationLog` 0건).
      if (result.apiCall) {
        const { turn, mock } = completeApiTurnSync(
          result,
          (suspension) => {
            const source = mockSources.get(suspension.payload.connectionId);
            const outcome = resolveMockOutcome(source?.samples ?? []);
            return { result: outcome.result, mock: { sampleHash8: outcome.sampleHash8, sampleLabel: outcome.sampleLabel, noSample: outcome.noSample } };
          },
          bundle,
          now,
        );
        result = turn;
        apiMock = mock?.noSample ? 'NO_SAMPLE' : mock?.sampleHash8 ?? null;
      }
      state = result.nextState;
      outputs = result.outputs;
      unsupportedOutputs = result.unsupportedOutputs;
      matchedIntentId = result.matchedIntentId;
      matchedFaqId = result.matchedFaqId;
      matchedNodeId = result.matchedNodeId;

      if (semantic) {
        bandKind = judgeBand(semantic.ranked, thresholds).kind;
        const top1 = semantic.ranked[0];
        top1Score = top1?.score;
        top1Kind = top1?.kind;
        top1Id = top1?.id;
        marginToTop2 = semantic.ranked.length >= 2 ? semantic.ranked[0].score - semantic.ranked[1].score : undefined;
      } else {
        // 임베딩을 시도하지 않았거나(단문·저하 모드) 의미 매칭이 꺼져 있다 — 규칙 매칭만 적용됐다.
        bandKind = 'SKIPPED';
        top1Score = undefined;
        top1Kind = undefined;
        top1Id = undefined;
        marginToTop2 = undefined;
      }
    }

    return {
      matchedIntentId,
      matchedFaqId,
      matchedNodeId,
      outputs,
      unsupportedOutputs,
      bandKind,
      top1Score,
      top1Kind,
      top1Id,
      marginToTop2,
      blockedByFilter,
      elapsedMs: Date.now() - start,
      apiMock,
      surveyPreview,
    };
  }
}
