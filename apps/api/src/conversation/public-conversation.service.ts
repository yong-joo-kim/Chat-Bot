import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { resolveTurn, willSurveyConsumeInput } from '@chat-bot/dialogue-engine';
import { CONVERSATION_STATE_VERSION, ConversationStateSchema, WIDGET_FEATURE_HANDOFF_V1 } from '@chat-bot/shared-types';
import type { PublicFeedbackOffer } from '@chat-bot/shared-types';
import { isFeedbackOffered } from '../feedback/lib/feedback-offer';
import type {
  ConversationState,
  DialogOutput,
  DialogueBundle,
  PendingAnswerPollResponse,
  PublicChatbotConfig,
  PublicMessageRequestDto,
  PublicMessageResponse,
  WebChannelConfig,
} from '@chat-bot/shared-types';
import { parseSkin } from '../chatbots/lib/skin.util';
import { DialogueBundleService } from '../dialogue-common/dialogue-bundle.service';
import { PublicAccessService } from './public-access.service';
import { ConversationLogService } from './conversation-log.service';
import { ChannelAdapterFactory } from './adapters/channel-adapter.factory';
import type { InboundTurn } from './adapters/channel-adapter';
import { parseChannelConfig } from '../channels/lib/channel-config';
import { buildBotResponseText, judgeAnswered } from './lib/conversation-log';
import { resolveAnsweredTopicId } from './lib/answered-topic';
import { BannedWordFilterService } from '../banned-words/banned-word-filter.service';
import type { InputKind } from '../learning/lib/collect-decision';
import { ApiException } from '../common/api.exception';
import { SemanticMatchService } from '../embedding/semantic-match.service';
import { AnswerSettingsCacheService } from '../answer-settings/answer-settings-cache.service';
import { RagHttpClient } from '../rag/rag-http.client';
import { RagGateService } from '../rag/rag-gate.service';
import { RagAnswerService } from '../rag/rag-answer.service';
import type { PendingAnswerStore } from '../rag/pending-answer.store';
import { shouldRunRag } from '../rag/lib/should-run-rag';
import { LegacyApiService } from '../legacy-api/legacy-api.service';
import { SurveyResponseService } from '../survey-responses/survey-response.service';
import { HandoffGateService } from '../handoff/handoff-gate.service';

/** 대기 안내 문구(FR-N2-34, S-4) — "RAG"·"LLM"·"벡터" 같은 내부 용어를 쓰지 않는다(FR-N2-24). */
const RAG_WAITING_TEXT = '문서에서 찾아보고 있어요. 잠시만요.';

/** 금지어 차단 시 반환하는 고정 안내(FR-12-38, S-11). 관리자 문구 커스터마이즈는 이번 Phase 범위 밖이다. */
const BANNED_WORD_GUIDANCE_TEXT = '바람직하지 않은 표현이 포함되어 있습니다. 다시 입력해 주세요.';

/** [신규 No.44] 평가 가능 표식(ADR-0038 §1) — 응답에 실을 때는 조건부 전개로만 채운다(§6.2). */
const FEEDBACK_OFFER: PublicFeedbackOffer = { rateable: true };

/**
 * 공개 대화 1턴 파이프라인(FR-11-14~27, §8.3). `resolveTurn` 한 경로만 호출한다(FR-0-19).
 * No.12부터 금지어 필터 2지점이 추가된다(②.5 입구 / ⑤.5 출구, FR-12-38/40, §10.2).
 * FAQ/의도 매칭 고도화 그룹부터 ③④(의미 유사도 주입)·⑦(2단계 분기, PENDING 반환)이 추가된다
 * (nlu-rag-answering-설계.md §3). ⑨ 응답 반환 → ⑩ 로그 적재(await 하지 않는다, FR-11-24/NFR-P6) 순서가 계약이다.
 */
@Injectable()
export class PublicConversationService {
  constructor(
    private readonly access: PublicAccessService,
    private readonly bundleService: DialogueBundleService,
    private readonly adapterFactory: ChannelAdapterFactory,
    private readonly logService: ConversationLogService,
    private readonly bannedWordFilter: BannedWordFilterService,
    private readonly semanticMatch: SemanticMatchService,
    private readonly answerSettingsCache: AnswerSettingsCacheService,
    private readonly ragHttpClient: RagHttpClient,
    private readonly ragGate: RagGateService,
    private readonly ragAnswer: RagAnswerService,
    @Inject('PendingAnswerStore') private readonly pendingStore: PendingAnswerStore,
    private readonly config: ConfigService,
    private readonly legacyApi: LegacyApiService,
    private readonly surveyResponses: SurveyResponseService,
    // [No.27 선례를 따라 15번째 인자로 추가 — No.24] 단언 변경 0(E-7). 상담 폴링(`HandoffPublicPollService`)
    // 은 이 서비스에 주입하지 않는다 — `pollHandoff` 핸들러가 직접 호출한다(생성자 인자 +1만 유지).
    private readonly handoffGate: HandoffGateService,
  ) {}

  async getConfig(slug: string): Promise<PublicChatbotConfig> {
    const { chatbot, channel } = await this.access.resolve(slug);
    const { skin } = parseSkin(chatbot.skin);
    const config = parseChannelConfig('WEB', channel.config) as WebChannelConfig;

    return {
      slug: chatbot.slug,
      name: chatbot.name,
      avatarUrl: chatbot.avatarUrl ?? undefined,
      skin,
      greetingMessage: config.greetingMessage,
      quickReplies: config.quickReplies,
      launcherPosition: config.launcherPosition,
      showLauncher: config.showLauncher,
    };
  }

  async sendMessage(slug: string, dto: PublicMessageRequestDto, opts?: { handoffToken?: string }): Promise<PublicMessageResponse> {
    const { chatbot, channel } = await this.access.resolve(slug);
    const adapter = this.adapterFactory.getAdapter('WEB');
    const inbound = adapter.normalizeInbound(dto);

    // ②.5 입구 금지어 필터(FR-12-38/39) — BLOCK이면 엔진을 호출하지 않는다.
    // `NODE` 버튼은 사용자 입력이 아니라 봇이 제공한 선택지라 대상이 아니다(§10.2, 항상 PASS).
    // ★ [No.24] 이 경로는 상담이 꺼진 챗봇과 바이트 단위로 동일해야 한다 — 상담 게이트는 이 뒤(②.7)
    // 에서만 조회한다(BLOCK이면 상담 조회도 하지 않는다, ADR-0036 §1).
    const filterableText = resolveFilterableInboundText(inbound);
    const { decision } = filterableText !== undefined ? await this.bannedWordFilter.evaluateInbound(filterableText) : { decision: 'PASS' as const };
    if (decision === 'BLOCK') {
      const messageId = randomUUID();
      const outputs = [{ type: 'TEXT' as const, payload: { text: BANNED_WORD_GUIDANCE_TEXT } }];

      void this.logService.record({
        id: messageId,
        chatbotId: chatbot.id,
        groupId: chatbot.groupId,
        channelType: 'WEB',
        sessionId: dto.sessionId,
        rawUserMessage: resolveUserMessageText(inbound),
        rawBotResponse: BANNED_WORD_GUIDANCE_TEXT,
        isAnswered: false,
        blockedByFilter: true,
        inputKind: resolveInputKind(inbound),
      });

      // 슬롯이 채워지지 않고 세션도 끊기지 않는다 — 요청에 실려온 상태를 그대로 반환한다(EX-12-26).
      // 상태가 없거나 형식이 어긋나면(첫 턴 등) 빈 봉투로 대체한다 — 엔진을 호출하지 않으므로
      // 재검증·기본값 구성 로직(sanitizeConversationState)을 탈 수 없다.
      const parsedState = ConversationStateSchema.safeParse(inbound.state);
      const preservedState: ConversationState = parsedState.success
        ? parsedState.data
        : { version: CONVERSATION_STATE_VERSION, contextSession: null };
      return { messageId, outputs, state: preservedState, stateReset: false };
    }

    // ②.7 [신규 No.24] 하이브리드 CS 게이트(ADR-0036 §1·§5) — 개입 중이면 엔진을 건너뛴다(기존 BLOCK
    // 경로와 같은 모양). 상담 꺼진 챗봇 + 토큰 헤더 없음이면 설정 캐시 조회 1회 후 즉시 PASS다
    // (추가 DB 조회 0 — FR-0-119).
    const gateResult = await this.handoffGate.evaluate({
      chatbotId: chatbot.id,
      sessionId: dto.sessionId,
      now: new Date(),
      channelOpen: true, // access.resolve()가 이미 ACTIVE·WEB 활성을 확인했다(①).
      features: dto.features,
      tokenHeader: opts?.handoffToken,
      inbound,
      rawState: inbound.state,
    });
    if (gateResult.kind === 'HANDLED') {
      void this.logService.record({
        id: gateResult.response.messageId,
        chatbotId: chatbot.id,
        groupId: chatbot.groupId,
        channelType: 'WEB',
        sessionId: dto.sessionId,
        rawUserMessage: gateResult.rawUserMessage,
        rawBotResponse: gateResult.botResponseForLog,
        isAnswered: true,
        inputKind: resolveInputKind(inbound),
        handoffTurn: true,
      });
      return gateResult.response;
    }
    inbound.state = gateResult.state;
    // G-8(§5.3) — 구버전(LEGACY) 상담이 시간 종료로 끝나 미전달 메시지가 있으면, 이번 봇 출력
    // 앞에 전치할 TEXT 아웃풋을 게이트가 실어 보낸다(코드리뷰 1회차 Medium #4). 없으면 빈 배열.
    const handoffPrependOutputs = gateResult.prependOutputs ?? [];

    const { bundle, index } = await this.bundleService.getCached(chatbot.id);
    const settings = await this.answerSettingsCache.get(chatbot.id);
    const now = new Date();
    const turnInput = inbound.buttonAction ? { buttonAction: inbound.buttonAction } : { message: inbound.message ?? '' };

    // ③.5 [신규 No.27] 설문이 이번 입력을 소비할 것으로 예상되면 의미 점수 계산을 생략한다(§22 D-14) —
    // 설문 답("4점"·"1,3")에 임베딩 1회·질의 LRU 캐시 오염을 쓰지 않는다.
    const surveyExpected = willSurveyConsumeInput(inbound.state, bundle, now);

    // ③④ [신규] 1단계 의미 유사도 점수 주입(ADR-0020) — `NODE` 버튼(=filterableText undefined)은
    // 후보 대상이 아니다. `semanticEnabled=false`이면 엔진은 저하 모드(현행 규칙 매칭)로 동작한다.
    const semanticText = filterableText;
    const semantic =
      !surveyExpected && settings.semanticEnabled && semanticText !== undefined
        ? await this.semanticMatch.score(chatbot.id, semanticText, bundle, {
            accept: settings.acceptThreshold,
            low: settings.lowThreshold,
            margin: settings.marginThreshold,
          })
        : undefined;

    let result = resolveTurn(turnInput, inbound.state, bundle, now, { index, semantic });
    // messageId 생성을 resolveTurn 직후로 앞당긴다(No.26) — 값만 쓰므로 동작은 기존과 동일하고,
    // ④.5(외부 API 턴 완결)의 `ApiCallLog.conversationLogId`가 이 값을 참조할 수 있게 한다.
    const messageId = randomUUID();
    const apiTurn = !!result.apiCall;

    // ④.5 [신규] 외부 API 호출이 정지된 턴만 완결한다(§6.1). 예상 밖 예외는 `completeTurn` 내부에서
    // 전부 삼켜지므로 여기서는 항상 유효한 결과가 돌아온다(폴백 동봉본 그대로일 수 있다).
    if (result.apiCall) {
      result = await this.legacyApi.completeTurn(result, {
        chatbotId: chatbot.id,
        conversationLogId: messageId,
        source: 'PUBLIC',
        bundle,
        now,
      });
    }

    // ④.6 [신규 No.27] 설문 응답 적재 — 엔진 뒤·출구 필터 앞, RAG 분기보다 앞(§7.1). 설문 턴만 await한다
    // (다음 턴 가드가 이 턴의 적재를 전제한다 — 순서 보장). 예외를 던지지 않는다(AC-SV3-6).
    if (result.surveyEvents && result.surveyEvents.length > 0) {
      await this.surveyResponses.apply(result.surveyEvents, {
        chatbotId: chatbot.id,
        groupId: chatbot.groupId,
        sessionId: dto.sessionId,
        channelType: 'WEB',
        conversationLogId: messageId,
        now,
        bundle,
      });
    }

    const rendered = adapter.renderOutbound(result.outputs);
    // ⑤.5 출구 금지어 필터(FR-12-40) — 정책 무관, 항상 마스킹만 한다(차단하지 않는다). 외부 API
    // 값이 섞인 최종 출력 전체가 이 필터를 통과한다(FR-L4-14 · AC-L3-10). G-8 전치 아웃풋도 같은
    // 필터를 통과한다(이미 마스킹된 텍스트라 멱등이지만, "최종 출력 전체가 필터를 통과한다"는
    // 규약을 예외 없이 지킨다).
    const outputs = await this.bannedWordFilter.maskOutbound([...handoffPrependOutputs, ...(rendered[0]?.outputs ?? [])]);
    const stateReset = result.stateDiscarded.length > 0;
    const isAnswered = judgeAnswered(result.trace);
    const inputKind = resolveInputKind(inbound);
    const apiNotice = result.apiStep?.branch === 'NOTICE';
    const surveyTurn = result.surveyTurn === true;
    // [신규 No.44] 평가 가능 판정(ADR-0038 §1) — 이 지점은 BLOCK·HANDLED 조기 반환 뒤라
    // blockedByFilter·handoffTurn이 항상 false다(방어적으로 명시 전달).
    const feedbackOffered = isFeedbackOffered({
      features: dto.features,
      webChannelConfigJson: channel.config,
      blockedByFilter: false,
      surveyTurn,
      handoffTurn: false,
    });

    // ⑦ [신규] 2단계(외부 RAG) 분기 판정 — 9조건(FR-N2-1) + 유량 여유(회로·동시성·레이트리밋)까지
    // 전부 통과해야 PENDING으로 넘어간다. 하나라도 막히면 기존 폴백 경로로 수렴한다(FR-0-43).
    // [No.26] 외부 API가 개입한 턴은 항상 false다(FR-L4-12 · AC-L3-15).
    const shouldTryRag = apiTurn ? false : this.evaluateRagEligibility(settings, bundle, result, inbound, isAnswered, inputKind, surveyTurn);
    if (shouldTryRag && this.ragGate.tryAcquire()) {
      return this.startPendingRagAnswer({
        slug,
        chatbotId: chatbot.id,
        groupId: chatbot.groupId,
        sessionId: dto.sessionId,
        messageId,
        inbound,
        settings,
        fallbackText: buildBotResponseText(outputs),
        inputKind,
        nextState: result.nextState,
        stateReset,
        features: dto.features,
        prependOutputs: handoffPrependOutputs,
        feedbackOffered,
      });
    }

    const response: PublicMessageResponse = {
      messageId,
      outputs,
      state: result.nextState,
      stateReset,
      // §5.5 관찰 창 — 상담이 켜진 챗봇 + 위젯이 기능을 선언 + 이번 턴이 미응답(BLOCK 제외 — 이미
      // 반환됨) + 활성 상담 없음(HANDLED로 반환되지 않았다는 것 자체가 활성 상담이 없었다는 뜻이다).
      handoff: await this.buildWatchHint(chatbot.id, dto.features, isAnswered),
      // [신규 No.44] 평가 가능 턴에만 존재한다 — 없으면 바이트 단위로 현행과 동일(§6.2, 마지막 키).
      ...(feedbackOffered ? { feedback: FEEDBACK_OFFER } : {}),
    };

    // ⑩ 로그 적재 — await 하지 않는다. 실패해도 응답은 이미 유효하다(FR-11-24, NFR-P6).
    void this.logService.record({
      id: messageId,
      chatbotId: chatbot.id,
      groupId: chatbot.groupId,
      channelType: 'WEB',
      sessionId: dto.sessionId,
      rawUserMessage: resolveUserMessageText(inbound),
      rawBotResponse: buildBotResponseText(outputs),
      matchedIntentId: result.matchedIntentId,
      matchedNodeId: result.matchedNodeId,
      matchedFaqId: result.matchedFaqId,
      isAnswered,
      inputKind,
      apiNotice,
      surveyTurn,
      feedbackOffered,
      // [신규 No.22 — §6.6] 이미 가진(필터된 운영) 번들에서 찾는다 — 추가 조회 0 · 생성자 인자 추가 0.
      topicId: resolveAnsweredTopicId(bundle, result, isAnswered),
    });

    return response;
  }

  /** `GET /public/chatbots/:slug/messages/:messageId`(`@Public()` 6번째, ADR-0023). */
  async pollMessage(slug: string, messageId: string): Promise<PendingAnswerPollResponse> {
    const snapshot = this.pendingStore.get(messageId, slug);
    if (!snapshot) {
      throw new ApiException('PENDING_ANSWER_NOT_FOUND', 404, '요청하신 답변을 찾을 수 없거나 만료되었습니다.');
    }
    return { status: snapshot.status, outputs: snapshot.outputs, sources: snapshot.sources };
  }

  private evaluateRagEligibility(
    settings: Awaited<ReturnType<AnswerSettingsCacheService['get']>>,
    bundle: DialogueBundle,
    result: ReturnType<typeof resolveTurn>,
    inbound: InboundTurn,
    isAnswered: boolean,
    inputKind: InputKind,
    surveyTurn: boolean,
  ): boolean {
    if (!this.ragHttpClient.isConfigured()) return false; // EX-N2-1 — 미설정 시 PENDING 자체가 없다.

    const stateParsed = ConversationStateSchema.safeParse(inbound.state);
    const sessionInProgress = stateParsed.success && stateParsed.data.contextSession?.status === 'IN_PROGRESS';
    const wasClarifyResolution = stateParsed.success && !!stateParsed.data.pendingClarify;
    const hasFallbackNode = bundle.dialogNodes.some((n) => n.nodeType === 'FALLBACK' && n.enabled);

    return shouldRunRag({
      ragEnabled: settings.ragEnabled,
      ragCompany: settings.ragCompany,
      judgeAnswered: isAnswered,
      inputKind,
      blockedByFilter: false,
      sessionInProgress: !!sessionInProgress,
      wasClarifyResolution: !!wasClarifyResolution,
      normalizedLength: result.normalizedInput.length,
      fallbackPolicy: settings.fallbackPolicy,
      hasFallbackNode,
      surveyTurn,
    });
  }

  private async startPendingRagAnswer(input: {
    slug: string;
    chatbotId: string;
    groupId: string;
    sessionId: string;
    messageId: string;
    inbound: InboundTurn;
    settings: Awaited<ReturnType<AnswerSettingsCacheService['get']>>;
    fallbackText: string;
    inputKind: InputKind;
    nextState: ConversationState;
    stateReset: boolean;
    features?: string[];
    /** G-8 전치 아웃풋(§5.3) — 보류 응답 대기 문구 앞에도 같은 규약으로 붙인다. */
    prependOutputs?: DialogOutput[];
    /** [신규 No.44] POST 응답(대기 문구)에 표식을 싣고, 로그는 백그라운드 완료 시 같은 값으로 적재한다(§6.4). */
    feedbackOffered: boolean;
  }): Promise<PublicMessageResponse> {
    const ttlMs = this.config.get<number>('PENDING_ANSWER_TTL_MS') ?? 300_000;
    const expiresAt = new Date(Date.now() + ttlMs);

    // `sendMessage()`가 `ragGate.tryAcquire()`로 이미 슬롯을 확보해 둔 상태다. 아래
    // `pendingStore.create()`/`maskOutbound()`가 예외를 던지면 `ragAnswer.enqueue()`(→
    // `RagAnswerService.run()`의 `try/finally`)에 슬롯 반납 책임이 인계되지 않으므로,
    // 여기서 직접 반납해야 한다(슬롯 영구 누수 방지). `enqueue()` 호출 이후에는 `run()`이
    // 유일한 반납 지점이 되어야 하므로 이중 반납(double-release)이 없도록 아래 두 줄만 감싼다.
    let waitingOutputs: DialogOutput[];
    try {
      this.pendingStore.create(input.messageId, { chatbotId: input.chatbotId, slug: input.slug, expiresAt });
      waitingOutputs = await this.bannedWordFilter.maskOutbound([...(input.prependOutputs ?? []), { type: 'TEXT', payload: { text: RAG_WAITING_TEXT } }]);
    } catch (error) {
      this.ragGate.release();
      throw error;
    }

    this.ragAnswer.enqueue(
      {
        messageId: input.messageId,
        chatbotId: input.chatbotId,
        groupId: input.groupId,
        sessionId: input.sessionId,
        question: resolveUserMessageText(input.inbound),
        scope: { company: input.settings.ragCompany as string, category: input.settings.ragCategory, subcategory: input.settings.ragSubcategory },
        similarityThreshold: input.settings.ragSimilarityThreshold,
        timeoutMs: input.settings.ragTimeoutMs,
        showSources: input.settings.showSources,
        fallbackText: input.fallbackText,
        inputKind: input.inputKind,
        feedbackOffered: input.feedbackOffered,
      },
      { record: (params) => this.logService.record(params) },
    );

    return {
      messageId: input.messageId,
      outputs: waitingOutputs,
      state: input.nextState,
      stateReset: input.stateReset,
      pendingAnswer: { id: input.messageId, pollAfterMs: 1200, expiresAt },
      // §5.5 — 결과를 모르는 보류 턴은 관찰 창을 바로 열지 않고, 위젯이 보류 폴링 실패/만료 시 연다
      // (`IF_PENDING_FAILS`). 보류 답변 폴링 서버 코드·스키마는 무변경이다(ADR-0023 경로 불가침).
      handoff: await this.buildWatchHint(input.chatbotId, input.features, false, 'IF_PENDING_FAILS'),
      // [신규 No.44] 없으면 바이트 단위로 현행과 동일(§6.2, 마지막 키).
      ...(input.feedbackOffered ? { feedback: FEEDBACK_OFFER } : {}),
    };
  }

  /** §5.5 관찰 창 힌트 조립 — `HandoffGateService.isHandoffEnabled()`만 재사용한다(새 export 0). */
  private async buildWatchHint(
    chatbotId: string,
    features: string[] | undefined,
    isAnswered: boolean,
    trigger: 'NOW' | 'IF_PENDING_FAILS' = 'NOW',
  ): Promise<PublicMessageResponse['handoff']> {
    if (isAnswered) return undefined;
    if (!(features ?? []).includes(WIDGET_FEATURE_HANDOFF_V1)) return undefined;
    const enabled = await this.handoffGate.isHandoffEnabled(chatbotId);
    if (!enabled) return undefined;
    return {
      status: 'NONE',
      watch: {
        windowMs: this.config.get<number>('HANDOFF_WATCH_WINDOW_MS') ?? 180_000,
        pollAfterMs: this.config.get<number>('HANDOFF_WATCH_INTERVAL_MS') ?? 5_000,
        trigger,
      },
    };
  }
}

/** 로그의 `userMessage`는 사용자가 실제로 본 것을 기록한다 — NODE 버튼의 `nodeId`는 저장하지 않는다(§8.5). */
function resolveUserMessageText(inbound: InboundTurn): string {
  if (inbound.buttonAction?.kind === 'NODE') return inbound.buttonAction.label ?? '[버튼 선택]';
  if (inbound.buttonAction?.kind === 'MESSAGE') return inbound.buttonAction.text;
  return inbound.message ?? '';
}

/**
 * 입구 필터 판정 대상 텍스트(FR-12-38, §10.2) — `message` 또는 `buttonAction.kind==='MESSAGE'`의 `text`만.
 * `NODE` 버튼은 사용자 입력이 아니라 봇이 제공한 선택지라 대상이 아니다(`undefined` = 필터 건너뜀).
 * 1단계 의미 유사도 주입 대상 판정에도 재사용한다(같은 분기, 복제 금지).
 */
function resolveFilterableInboundText(inbound: InboundTurn): string | undefined {
  if (inbound.buttonAction?.kind === 'NODE') return undefined;
  if (inbound.buttonAction?.kind === 'MESSAGE') return inbound.buttonAction.text;
  return inbound.message ?? '';
}

/**
 * 미응답 질문 수집기(DD-52, FR-15-2)의 버튼 턴 판별 기준 — `resolveFilterableInboundText()`와
 * **동일한 분기**를 쓴다(판정식을 복제하지 않는다, ADR-0019). `ConversationLog` 컬럼을 늘리지 않고
 * 파이프라인이 `record()`의 파라미터로 직접 전달한다.
 */
function resolveInputKind(inbound: InboundTurn): InputKind {
  if (inbound.buttonAction?.kind === 'NODE') return 'BUTTON_NODE';
  if (inbound.buttonAction?.kind === 'MESSAGE') return 'BUTTON_MESSAGE';
  return 'TEXT';
}
