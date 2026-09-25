import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { buildDialogueIndex, judgeBand, mergeOverlay, resolveTurn } from '@chat-bot/dialogue-engine';
import type { ApiCallSuspension, DialogueTurnResult } from '@chat-bot/dialogue-engine';
import { maskPii } from '@chat-bot/pii-mask';
import {
  hasPermission,
  isApiConditionV2,
  isOverlayEmpty,
  type ApiConditionOutputPayloadV2,
  type ApiStepView,
  type CompareRequestDto,
  type CompareResponse,
  type CompareTurnResult,
  type DialogOutput,
  type DialogueBundle,
  type MatchTrace,
  type SimulateApiMode,
  type SimulateRequestDto,
  type SimulateResponse,
} from '@chat-bot/shared-types';
import { ApiException } from '../common/api.exception';
import type { SessionUser } from '../common/auth/session-context';
import { ChatbotScopeService } from '../chatbots/chatbot-scope.service';
import { DialogueBundleService } from '../dialogue-common/dialogue-bundle.service';
import { TopicLookupService } from '../topics/topic-lookup.service';
import { resolveAnsweredTopicId } from '../conversation/lib/answered-topic';
import { SemanticMatchService } from '../embedding/semantic-match.service';
import { AnswerSettingsCacheService } from '../answer-settings/answer-settings-cache.service';
import { RagHttpClient } from '../rag/rag-http.client';
import { RagGateService } from '../rag/rag-gate.service';
import { judgeRagResponse } from '../rag/lib/judge-rag-response';
import { RagQueryResponseSchema } from '../rag/lib/rag-response.schema';
import { LegacyApiService } from '../legacy-api/legacy-api.service';
import { ApiConnectionCatalogService } from '../api-connections/catalog/api-connection-catalog.service';
import type { MockSource } from '../api-connections/catalog/api-connection-catalog.service';
import { resolveMockOutcome } from '../api-connections/catalog/lib/mock-outcome';
import { completeApiTurnSync } from '../common/lib/api-turn';
import { serializeOutputsForDiff } from '../common/lib/output-diff';
import { assertOverlaySize, toBundleOverlayPatch } from './lib/overlay-convert';
import { compareDiff } from './lib/compare-diff';
import { computeAssetCounts, enrichNames } from './lib/resolution-enrich';
import { buildSurveyStepView } from './lib/survey-step';

/**
 * No.10 응답 테스트/시뮬레이션(FR-10-1~31). **읽기 전용** — `ConversationLogService`를 주입하지
 * 않는다(FR-0-21, AC-10-14 — 규약이 아니라 의존성 그래프로 로그 불가를 보장한다).
 * 시뮬레이션은 챗봇 상태와 무관하게 허용한다(FR-10-2) — `assertReadable`만 호출하고
 * `assertWritable`(ARCHIVED 차단)은 호출하지 않는다.
 * FAQ/의도 매칭 고도화 그룹부터 `matchTrace`(1단계 top3·구간 판정)와 `useRag`(명시적일 때만
 * 2단계 직접 호출, FR-N2-3/AC-N2-25)를 추가한다 — 이 경우에도 `ConversationLog`는 적재하지 않는다.
 * [No.26] 외부 API 호출은 기본 목(MOCK) — 실제 호출(LIVE)은 `simulation:write` + GET + **저장된
 * 노드와 직렬화 동일한 아웃풋** + 단건일 때만이며, 불충족은 거부가 아니라 MOCK 격하다(§6.2).
 */
@Injectable()
export class SimulationService {
  constructor(
    private readonly scope: ChatbotScopeService,
    private readonly bundleService: DialogueBundleService,
    private readonly semanticMatch: SemanticMatchService,
    private readonly answerSettingsCache: AnswerSettingsCacheService,
    private readonly ragHttpClient: RagHttpClient,
    private readonly ragGate: RagGateService,
    private readonly legacyApiService: LegacyApiService,
    private readonly apiConnectionCatalog: ApiConnectionCatalogService,
    private readonly config: ConfigService,
    private readonly topicLookup: TopicLookupService,
  ) {}

  /** [신규 No.22 — §6.5] 답한 자산의 topicId가 있을 때만 `{id,name,enabled}`를 채운다(추가 조회 0 — 맵은 호출부가 1회 조회). */
  private answeredTopicFromMap(topics: Map<string, { id: string; name: string; enabled: boolean }>, topicId: string | undefined): SimulateResponse['answeredTopic'] {
    if (!topicId) return undefined;
    const topic = topics.get(topicId);
    if (!topic) return undefined;
    return { id: topic.id, name: topic.name, enabled: topic.enabled };
  }

  /** 답한 자산이 있을 가능성이 있을 때만(토픽이 1개 이상 있을 때만) 토픽 맵을 조회한다(§6.5 — 요청당 최대 1회). */
  private async loadTopicsIfAny(chatbotId: string): Promise<Map<string, { id: string; name: string; enabled: boolean }>> {
    return this.topicLookup.mapForChatbot(chatbotId);
  }

  async simulate(chatbotId: string, dto: SimulateRequestDto, actor: SessionUser): Promise<SimulateResponse> {
    await this.scope.assertReadable(chatbotId);
    assertOverlaySize(dto.overlay);

    const now = new Date();
    const start = Date.now();
    // [신규 No.22 — P-13] "비활성 토픽 포함" — 켜면 필터 없는 번들(별도 소형 캐시)을 쓴다.
    const { bundle: baseBundle, index: baseIndex } = dto.includeInactiveTopics
      ? await this.bundleService.getCachedUnfiltered(chatbotId)
      : await this.bundleService.getCached(chatbotId);

    const overlayApplied = !!dto.overlay && !isOverlayEmpty(dto.overlay);
    let bundle: DialogueBundle = baseBundle;
    let index = baseIndex;
    if (overlayApplied) {
      const patch = toBundleOverlayPatch(chatbotId, dto.overlay, now);
      bundle = mergeOverlay(baseBundle, patch);
      index = buildDialogueIndex(bundle);
    }

    const settings = await this.answerSettingsCache.get(chatbotId);
    const thresholds = { accept: settings.acceptThreshold, low: settings.lowThreshold, margin: settings.marginThreshold };
    // NODE 버튼은 의미 매칭 후보가 아니다(공개 대화 경로와 동일한 분기, 복제가 아니라 같은 판단 재적용).
    const semanticText = dto.buttonAction?.kind === 'NODE' ? undefined : dto.buttonAction?.kind === 'MESSAGE' ? dto.buttonAction.text : dto.message;
    const semantic =
      settings.semanticEnabled && semanticText !== undefined && semanticText.length > 0
        ? await this.semanticMatch.score(chatbotId, semanticText, bundle, thresholds)
        : undefined;

    const turnInput = dto.buttonAction ? { buttonAction: dto.buttonAction } : { message: dto.message ?? '' };
    let result: DialogueTurnResult = resolveTurn(turnInput, dto.state, bundle, now, { index, semantic, surveyPreview: dto.surveyPreview });

    let apiStep: ApiStepView | undefined;
    if (result.apiCall) {
      const outcome = await this.completeApiStep(chatbotId, result, dto, bundle, baseBundle, now, actor);
      result = outcome.turn;
      apiStep = outcome.view;
    }

    const names = enrichNames(bundle, result);

    const matchTrace = semantic
      ? await this.buildMatchTrace(semantic, thresholds, settings, dto.useRag, semanticText)
      : settings.semanticEnabled
        ? ({ band: 'SKIPPED', top3: [], ragUsed: false } as MatchTrace)
        : undefined;

    const elapsedMs = Date.now() - start;
    const matchedTopicId = resolveAnsweredTopicId(bundle, result, true);
    const topicsMap = matchedTopicId ? await this.loadTopicsIfAny(chatbotId) : new Map<string, { id: string; name: string; enabled: boolean }>();
    const answeredTopic = this.answeredTopicFromMap(topicsMap, matchedTopicId);

    return {
      input: result.input,
      normalizedInput: result.normalizedInput,
      matchedNodeId: result.matchedNodeId,
      matchedIntentId: result.matchedIntentId,
      matchedFaqId: result.matchedFaqId,
      homonymResolution: result.homonymResolution,
      outputs: result.outputs,
      nextSession: result.nextSession,
      pendingClarify: result.pendingClarify,
      unsupportedOutputs: result.unsupportedOutputs,
      trace: result.trace,
      state: result.nextState,
      stateDiscarded: result.stateDiscarded,
      matchedNodeName: names.matchedNodeName,
      matchedIntentName: names.matchedIntentName,
      matchedFaqQuestion: names.matchedFaqQuestion,
      elapsedMs,
      resolvedAt: now,
      assetCounts: computeAssetCounts(bundle),
      overlayApplied,
      matchTrace,
      apiStep,
      surveyStep: buildSurveyStepView(result.trace, result.surveyEvents, bundle, dto.surveyPreview),
      answeredTopic,
    };
  }

  /**
   * [No.26] 외부 API 단계 완결(§6.2) — LIVE 조건 4개를 모두 만족해야 실제 호출한다. 불충족은
   * 격하 사유(`downgradeReason`)와 함께 MOCK으로 처리한다(오류가 아니다, FR-L7-2).
   */
  private async completeApiStep(
    chatbotId: string,
    result: DialogueTurnResult,
    dto: SimulateRequestDto,
    bundle: DialogueBundle,
    baseBundle: DialogueBundle,
    now: Date,
    actor: SessionUser,
  ): Promise<{ turn: DialogueTurnResult; view: ApiStepView }> {
    const suspension = result.apiCall as ApiCallSuspension;
    const payload = suspension.payload;

    let mode: SimulateApiMode = 'MOCK';
    let downgradeReason: string | undefined;
    let connectionName = payload.connectionId;

    if (dto.apiMode === 'LIVE') {
      if (!hasPermission(actor.role, 'simulation:write')) {
        downgradeReason = 'NO_PERMISSION';
      } else if (payload.method !== 'GET') {
        downgradeReason = 'METHOD_NOT_GET';
      } else if (!this.isSavedNode(baseBundle, suspension, payload)) {
        downgradeReason = 'UNSAVED_NODE';
      } else if (!(this.config.get<boolean>('LEGACY_API_ENABLED') ?? true)) {
        downgradeReason = 'FEATURE_DISABLED';
      } else {
        const connection = await this.apiConnectionCatalog.findForCall(payload.connectionId);
        if (!connection || !connection.enabled) {
          downgradeReason = 'CONNECTION_DISABLED';
        } else {
          mode = 'LIVE';
          connectionName = connection.name;
        }
      }
    }

    if (mode === 'LIVE') {
      const turn = await this.legacyApiService.completeTurn(result, { chatbotId, source: 'SIMULATION_LIVE', bundle, now });
      return { turn, view: this.buildApiStepView(mode, downgradeReason, payload, turn, connectionName) };
    }

    const sources = await this.apiConnectionCatalog.loadMockSources([payload.connectionId]);
    const source: MockSource | undefined = sources.get(payload.connectionId);
    connectionName = source?.name ?? connectionName;

    let sampleLabel: string | undefined;
    let noSample: boolean | undefined;
    const { turn } = completeApiTurnSync(
      result,
      () => {
        const outcome = resolveMockOutcome(source?.samples ?? [], dto.mockResponse);
        sampleLabel = outcome.sampleLabel;
        noSample = outcome.noSample;
        return { result: outcome.result, mock: { sampleHash8: outcome.sampleHash8, sampleLabel: outcome.sampleLabel, noSample: outcome.noSample } };
      },
      bundle,
      now,
    );

    return { turn, view: this.buildApiStepView(mode, downgradeReason, payload, turn, connectionName, sampleLabel, noSample) };
  }

  /** "저장된 노드" 판정 — id뿐 아니라 정지한 아웃풋이 저장본과 직렬화 동일해야 한다(오버레이 우회 차단, AC-L6-3). */
  private isSavedNode(baseBundle: DialogueBundle, suspension: ApiCallSuspension, payload: ApiConditionOutputPayloadV2): boolean {
    const baseNode = baseBundle.dialogNodes.find((n) => n.id === suspension.nodeId);
    const baseOutput = baseNode?.outputs[suspension.outputIndex];
    if (!baseOutput || baseOutput.type !== 'API_CONDITION' || !isApiConditionV2(baseOutput.payload)) return false;
    const suspendedOutput: DialogOutput = { type: 'API_CONDITION', payload };
    return serializeOutputsForDiff([baseOutput]) === serializeOutputsForDiff([suspendedOutput]);
  }

  private buildApiStepView(
    mode: SimulateApiMode,
    downgradeReason: string | undefined,
    payload: ApiConditionOutputPayloadV2,
    turn: DialogueTurnResult,
    connectionName: string,
    sampleLabel?: string,
    noSample?: boolean,
  ): ApiStepView {
    const step = turn.apiStep;
    return {
      mode,
      downgradeReason,
      connectionId: payload.connectionId,
      connectionName,
      method: payload.method,
      pathTemplate: payload.path,
      outcome: step?.outcome ?? 'NETWORK_ERROR',
      httpStatus: step?.httpStatus,
      branch: step?.branch ?? 'NOTICE',
      conditionIndex: step?.conditionIndex,
      sampleLabel,
      ...(noSample ? { noSample: true } : {}),
      variables: Object.entries(step?.variables ?? {}).map(([name, value]) => ({ name, value: maskPii(value).maskedText })),
    };
  }

  /**
   * 시뮬레이터 결과 패널의 매칭 근거(FR-N3-10, AC-N3-7) — 엔진과 동일한 `judgeBand`를 재사용한다
   * (NFR-M2). `useRag: true`이고 1단계가 실패(FAILED) 구간일 때만 `RagHttpClient`를 **직접**
   * 호출한다 — `ConversationLog`/`RagCallLog`는 남기지 않는다(FR-N2-3, AC-N2-25).
   */
  private async buildMatchTrace(
    semantic: NonNullable<Awaited<ReturnType<SemanticMatchService['score']>>>,
    thresholds: { accept: number; low: number; margin: number },
    settings: Awaited<ReturnType<AnswerSettingsCacheService['get']>>,
    useRag: boolean,
    questionText: string | undefined,
  ): Promise<MatchTrace> {
    const band = judgeBand(semantic.ranked, thresholds);
    const top3 = semantic.ranked.slice(0, 3).map((c) => ({ kind: c.kind, id: c.id, label: c.matchedText, score: c.score }));

    let ragUsed = false;
    let ragLatencyMs: number | undefined;
    let ragSourceCount: number | undefined;

    const canTryRag = useRag && band.kind === 'FAILED' && settings.ragEnabled && !!settings.ragCompany && this.ragHttpClient.isConfigured() && !!questionText;

    if (canTryRag && this.ragGate.tryAcquire()) {
      const ragStart = Date.now();
      try {
        const maskedQuestion = maskPii(questionText as string).maskedText;
        const httpResult = await this.ragHttpClient.query(
          {
            question: maskedQuestion,
            company: settings.ragCompany as string,
            category: settings.ragCategory ?? undefined,
            subcategory: settings.ragSubcategory ?? undefined,
            similarityThreshold: settings.ragSimilarityThreshold ?? undefined,
          },
          settings.ragTimeoutMs,
        );
        if (!httpResult.networkError && httpResult.httpStatus === 200) {
          const parsed = RagQueryResponseSchema.safeParse(httpResult.body);
          if (parsed.success) {
            const judgement = judgeRagResponse(parsed.data);
            this.ragGate.recordSuccess();
            if (judgement.ok) {
              ragUsed = true;
              ragSourceCount = judgement.response.source_info?.total_sources;
            }
          } else {
            this.ragGate.recordFailure();
          }
        } else {
          this.ragGate.recordFailure();
        }
      } finally {
        this.ragGate.release();
        ragLatencyMs = Date.now() - ragStart;
      }
    }

    return { band: band.kind, top3, ragUsed, ragLatencyMs, ragSourceCount };
  }

  async compare(chatbotId: string, dto: CompareRequestDto): Promise<CompareResponse> {
    await this.scope.assertReadable(chatbotId);
    if (isOverlayEmpty(dto.overlay)) {
      throw new ApiException('NO_CHANGES_TO_COMPARE', 400, '비교할 변경 내용이 없습니다.');
    }
    assertOverlaySize(dto.overlay);

    const now = new Date();
    const start = Date.now();
    // [신규 No.22 — §6.5] 비교도 단건과 같은 토글 의미다.
    const { bundle: bundleA, index: indexA } = dto.includeInactiveTopics
      ? await this.bundleService.getCachedUnfiltered(chatbotId)
      : await this.bundleService.getCached(chatbotId);
    const patch = toBundleOverlayPatch(chatbotId, dto.overlay, now);
    const bundleB = mergeOverlay(bundleA, patch);
    const indexB = buildDialogueIndex(bundleB);

    // [No.26] A/B 두 번들의 v2 connectionId 합집합으로 목 원천을 요청당 1회 로드한다(FR-L7-4).
    const connectionIds = new Set<string>();
    for (const b of [bundleA, bundleB]) {
      for (const node of b.dialogNodes) {
        for (const output of node.outputs) {
          if (output.type === 'API_CONDITION' && isApiConditionV2(output.payload)) connectionIds.add(output.payload.connectionId);
        }
      }
    }
    const mockSources = await this.apiConnectionCatalog.loadMockSources([...connectionIds]);
    const mockExecutor = (suspension: ApiCallSuspension) => {
      const source = mockSources.get(suspension.payload.connectionId);
      const outcome = resolveMockOutcome(source?.samples ?? []);
      return { result: outcome.result, mock: { sampleHash8: outcome.sampleHash8, sampleLabel: outcome.sampleLabel, noSample: outcome.noSample } };
    };

    let stateA: unknown = dto.initialState;
    let stateB: unknown = dto.initialState;
    const turns: CompareResponse['turns'] = [];
    let same = 0;
    // [신규 No.22 — §6.5] 요청당 조회 최대 1회 — 턴마다 새로 조회하지 않는다.
    const topicsMap = await this.loadTopicsIfAny(chatbotId);

    for (let i = 0; i < dto.messages.length; i++) {
      const message = dto.messages[i];
      let a = resolveTurn({ message }, stateA, bundleA, now, { index: indexA, surveyPreview: true });
      if (a.apiCall) a = completeApiTurnSync(a, mockExecutor, bundleA, now).turn;
      stateA = a.nextState;

      let b = resolveTurn({ message }, stateB, bundleB, now, { index: indexB, surveyPreview: true });
      if (b.apiCall) b = completeApiTurnSync(b, mockExecutor, bundleB, now).turn;
      stateB = b.nextState;

      const diff = compareDiff(a, b);
      if (diff.status === 'SAME') same += 1;

      const answeredTopicA = this.answeredTopicFromMap(topicsMap, resolveAnsweredTopicId(bundleA, a, true));
      const answeredTopicB = this.answeredTopicFromMap(topicsMap, resolveAnsweredTopicId(bundleB, b, true));

      turns.push({
        index: i,
        message,
        a: { ...toCompareTurnResult(bundleA, a), answeredTopic: answeredTopicA },
        b: { ...toCompareTurnResult(bundleB, b), answeredTopic: answeredTopicB },
        diff,
      });
    }

    return {
      turns,
      summary: { total: turns.length, same, different: turns.length - same },
      elapsedMs: Date.now() - start,
      resolvedAt: now,
    };
  }
}

function toCompareTurnResult(bundle: DialogueBundle, result: DialogueTurnResult): CompareTurnResult {
  const names = enrichNames(bundle, result);
  return {
    outputs: result.outputs,
    matchedNodeId: result.matchedNodeId,
    matchedNodeName: names.matchedNodeName,
    matchedIntentId: result.matchedIntentId,
    matchedFaqId: result.matchedFaqId,
    unsupportedOutputs: result.unsupportedOutputs,
    trace: result.trace,
  };
}
