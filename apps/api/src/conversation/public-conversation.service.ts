import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { resolveTurn, willSurveyConsumeInput } from '@chat-bot/dialogue-engine';
import { CONVERSATION_STATE_VERSION, ConversationStateSchema, WIDGET_FEATURE_HANDOFF_V1, WIDGET_FEATURE_SPEECH_V1 } from '@chat-bot/shared-types';
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
import { bundleSourceOf } from '../environment/serving/lib/bundle-source';
import { VersionBundleService, ServingVersionUnavailableError } from '../environment/serving/version-bundle.service';
import type { SemanticMatchVectorSource } from '../embedding/semantic-match.service';
import { WorkflowTriggerService } from '../workflow/triggers/workflow-trigger.service';
import { InboxIdentityService } from '../inbox/identity/inbox-identity.service';
import { ProactivePublicService } from '../proactive/public/proactive-public.service';
import { GuardrailRuntimeService } from '../guardrails/runtime/guardrail-runtime.service';
import type { PublicChatbotConfigResponse, PublicProactiveEventDto, PublicSpeechTranscriptionResponse, SpeechReplyPlan } from '@chat-bot/shared-types';
import { SpeechTranscriptionService, speechUnavailable } from '../speech/public/speech-transcription.service';
import type { SpeechRequestInput } from '../speech/public/speech-transcription.service';
import { VoicePublicService } from '../speech/reply/voice-public.service';

/** [신규 No.40] §7.6 — 버전 읽기 실패 시 엔진을 호출하지 않는 고정 폴백 문구(엔진 상수를 새로 export하지
 * 않는다 — packages/dialogue-engine 변경 0). */
const VERSION_UNAVAILABLE_FALLBACK_TEXT = '죄송해요, 잠시 답변을 준비하지 못했어요. 잠시 후 다시 시도해 주세요.';

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
    // [신규 No.40 — 16번째 인자(끝), 선택] 초안 경로 호출 불변 — 이 서비스가 버전 경로 유일 진입점이다
    // (E-9). 선택 인자라 기존 15인자 생성자 호출(단위 시험)은 무수정 통과한다(§24.2 회귀 감시).
    private readonly versionBundles?: VersionBundleService,
    // [신규 No.41 — 17번째 인자(끝), 선택] `WORKFLOW` 노드 방출 적재(§6.1). 선택 인자라 기존 16인자
    // 생성자 호출(단위 시험)은 무수정 통과한다.
    private readonly workflowTriggers?: WorkflowTriggerService,
    // [신규 No.42 — 18번째 인자(끝), 선택] 고객 식별 요청(§2.3 ①.5). 선택 인자라 기존 17인자
    // 생성자 호출(단위 시험)은 무수정 통과한다.
    private readonly inboxIdentity?: InboxIdentityService,
    // [신규 No.35 — 19번째 인자(끝), 선택] `getConfig`의 `?proactive=1` 선택 확장 + 수집 처리
    // (§5.1·§5.3). 선택 인자라 기존 18인자 생성자 호출(단위 시험)은 무수정 통과한다.
    private readonly proactivePublic?: ProactivePublicService,
    // [신규 No.36 — 20번째 인자(끝), 선택] 입구 가드레일 판정(③.6)·이벤트 적재. 선택 인자라 기존 19인자
    // 생성자 호출(단위 시험)은 무수정 통과한다 — 없으면 입구 판정 0(도입 전 동작).
    private readonly guardrails?: GuardrailRuntimeService,
    // [신규 No.32 — 21번째 인자(끝), 선택] 공개 설정 `voice` 조립 · 응답 `speech` 계획·조립(봇 답변 반환 2지점 — H-3 · DD-136).
    // 선택 인자라 기존 20인자 생성자 호출(단위 시험)은 무수정 통과한다 — 없으면 음성 0(도입 전 동작). 공급자·세마포어는 받지 않는다(VO-5).
    private readonly voicePublic?: VoicePublicService,
    // [신규 No.32 — 22번째 인자(끝), 선택] 공개 인식 처리 전용 — 대화 턴 경로(메시지 전송·보류 폴링)에서는 쓰지 않는다(VO-5).
    private readonly speechTranscription?: SpeechTranscriptionService,
  ) {}

  /**
   * [신규 No.40] §7.2 — 공개 경로의 소스 선택 지점 1곳. `bundleSourceOf(` · `.getCached(` ·
   * `versionBundles.get(` 각 정확히 1회(정적 검사 E-9). 초안 경로는 기존 두 호출을 **같은 순서로** 한다.
   * 버전 경로의 `semanticSlots`는 호출자가 `SemanticMatchService.score()`의 5번째 인자를 조립할 때 쓴다.
   */
  private async loadServing(chatbot: Awaited<ReturnType<PublicAccessService['resolve']>>['chatbot']): Promise<{
    bundle: DialogueBundle;
    index: Awaited<ReturnType<DialogueBundleService['getCached']>>['index'];
    settings: Awaited<ReturnType<AnswerSettingsCacheService['get']>>;
    versionId: string | null;
    semanticSource?: SemanticMatchVectorSource;
  }> {
    const source = bundleSourceOf(chatbot);
    if (source.kind === 'DRAFT') {
      const { bundle, index } = await this.bundleService.getCached(chatbot.id);
      const settings = await this.answerSettingsCache.get(chatbot.id);
      return { bundle, index, settings, versionId: null };
    }

    const s = await this.versionBundles!.get(chatbot.id, source.versionId, { topics: 'ACTIVE_ONLY' });
    return { bundle: s.bundle, index: s.index, settings: s.settings, versionId: source.versionId, semanticSource: s.semanticSource };
  }

  async getConfig(slug: string, opts?: { proactive?: boolean }): Promise<PublicChatbotConfigResponse> {
    const { chatbot, channel } = await this.access.resolve(slug);
    const config = parseChannelConfig('WEB', channel.config) as WebChannelConfig;

    // [신규 No.40 · P-10] 모드 켜짐 = 표시 3필드(이름·아바타·스킨) 출처는 운영 버전 프로필. 버전
    // 읽기 실패 시 챗봇 행 값으로 폴백한다(표시 설정은 답변이 아니므로 가용성 우선, §16).
    let name = chatbot.name;
    let avatarUrl = chatbot.avatarUrl ?? undefined;
    let skin = parseSkin(chatbot.skin).skin;
    if (chatbot.prodVersionId) {
      try {
        const core = await this.versionBundles!.getCore(chatbot.prodVersionId, chatbot.id);
        name = core.profile.name;
        avatarUrl = core.profile.avatarUrl ?? undefined;
        skin = core.profile.skin;
      } catch {
        // 폴백 — 챗봇 행 값 그대로.
      }
    }

    const config8Keys: PublicChatbotConfig = {
      slug: chatbot.slug,
      name,
      avatarUrl,
      skin,
      greetingMessage: config.greetingMessage,
      quickReplies: config.quickReplies,
      launcherPosition: config.launcherPosition,
      showLauncher: config.showLauncher,
    };

    // [신규 No.32] §5.1 — 음성 설정이 없는 챗봇은 `voice`가 `undefined`(전역 색인 캐시 적중 시 추가 쿼리 0) → 조건부 전개로 키 자체가 없다.
    // `voice`는 항상 **마지막 키**다(`proactive` 뒤). 선제 경로(`?proactive=1`)도 같은 객체를 쓴다(설정의 진실 1벌 — R-12).
    const voice = this.voicePublic ? await this.voicePublic.buildConfigVoice(chatbot.id) : undefined;

    // [신규 No.35] §5.1 — 쿼리가 없거나(또는 `?proactive=1`이 아니거나) 선제 모듈이 없으면 선제 코드는 건너뛴다
    // (음성 키가 없으면 바이트 동일 · 추가 쿼리 0). 선제 코드는 이 줄 뒤에만 있다.
    if (!opts?.proactive || !this.proactivePublic) return voice ? { ...config8Keys, voice } : config8Keys;

    const proactive = await this.proactivePublic.buildPayload({ id: chatbot.id }, new Date(), () => this.loadServing(chatbot).then((s) => ({ index: s.index })));
    return { ...config8Keys, proactive, ...(voice ? { voice } : {}) };
  }

  /**
   * [신규 No.32] `POST /public/chatbots/:slug/speech/transcriptions`(`@Public()` 10번째, ADR-0052) — voice-ai-설계.md §5.3 처리 순서의
   * ①~⑤(서버 스위치 · 세션 헤더 · 형식 · 길이 헤더 · 슬러그 판정)를 여기서 하고 ⑥~⑫는 `SpeechTranscriptionService`가 한다.
   * 슬러그 판정 실패(없음·비공개·WEB 꺼짐)는 404/403이 아니라 **같은 503 `SPEECH_UNAVAILABLE`**로 통일한다(R-8).
   */
  async transcribeSpeech(slug: string, input: SpeechRequestInput): Promise<PublicSpeechTranscriptionResponse> {
    const transcription = this.speechTranscription;
    if (!transcription || !transcription.isServerEnabled()) throw speechUnavailable();
    transcription.precheck(input);
    let chatbotId: string;
    try {
      chatbotId = (await this.access.resolve(slug)).chatbot.id;
    } catch (e) {
      if (e instanceof ApiException) throw speechUnavailable();
      throw e;
    }
    return transcription.transcribe(chatbotId, input);
  }

  /** `POST /public/chatbots/:slug/proactive-events`(`@Public()` 9번째, §5.3) — 결합 검증 불일치·
   * 중복·서버 스위치 꺼짐 모두 같은 `204`(존재 탐지 불가). 중복 억제 조회는 슬러그 판정(DB 조회 2회)
   * **전에** 한다(스팸에 대한 비용 최소화). */
  async recordProactiveEvent(slug: string, dto: PublicProactiveEventDto): Promise<void> {
    if (!this.proactivePublic) return;
    const now = new Date();
    if (this.proactivePublic.isDuplicateEvent(dto, now)) return;

    const { chatbot } = await this.access.resolve(slug);
    await this.proactivePublic.recordEvent({ chatbot: { id: chatbot.id }, dto, now });
  }

  async sendMessage(slug: string, dto: PublicMessageRequestDto, opts?: { handoffToken?: string; identityToken?: string }): Promise<PublicMessageResponse> {
    const { chatbot, channel } = await this.access.resolve(slug);
    // [신규 No.32] 읽기 계획 — `speech-v1` 선언이 없으면 동기 `undefined`(캐시 조회조차 0 · 대화 턴 첫 쿼리 수 17 불변 — C-14).
    const speechPlan = this.voicePublic && (dto.features ?? []).includes(WIDGET_FEATURE_SPEECH_V1) ? await this.voicePublic.plan(chatbot.id, dto.features) : undefined;
    const adapter = this.adapterFactory.getAdapter('WEB');
    const inbound = adapter.normalizeInbound({ ...dto, identityToken: opts?.identityToken });

    // ①.5 [신규 No.42] 고객 식별 요청(ADR-0042 §2.3) — 동기 반환 · 예외 없음 · 응답·엔진 입력 무관.
    // 헤더가 없으면 `inbound.identity` 키 자체가 없어 이 분기에 들어오지 않는다(AC-OC1-1).
    if (inbound.identity) {
      this.inboxIdentity?.observe({ chatbotId: chatbot.id, sessionId: dto.sessionId, channelType: 'WEB', identity: inbound.identity, now: new Date() });
    }

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
        servedVersionId: chatbot.prodVersionId ?? undefined,
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
        servedVersionId: chatbot.prodVersionId ?? undefined,
      });
      return gateResult.response;
    }
    inbound.state = gateResult.state;
    // G-8(§5.3) — 구버전(LEGACY) 상담이 시간 종료로 끝나 미전달 메시지가 있으면, 이번 봇 출력
    // 앞에 전치할 TEXT 아웃풋을 게이트가 실어 보낸다(코드리뷰 1회차 Medium #4). 없으면 빈 배열.
    const handoffPrependOutputs = gateResult.prependOutputs ?? [];

    let serving;
    try {
      serving = await this.loadServing(chatbot);
    } catch (e) {
      if (e instanceof ServingVersionUnavailableError) {
        // §7.6 — 초안으로 몰래 대체하지 않는다. 엔진을 호출하지 않고 고정 폴백 문구로 응답한다.
        const messageId = randomUUID();
        const outputs = await this.bannedWordFilter.maskOutbound([...handoffPrependOutputs, { type: 'TEXT' as const, payload: { text: VERSION_UNAVAILABLE_FALLBACK_TEXT } }]);
        void this.logService.record({
          id: messageId,
          chatbotId: chatbot.id,
          groupId: chatbot.groupId,
          channelType: 'WEB',
          sessionId: dto.sessionId,
          rawUserMessage: resolveUserMessageText(inbound),
          rawBotResponse: VERSION_UNAVAILABLE_FALLBACK_TEXT,
          isAnswered: false,
          inputKind: resolveInputKind(inbound),
          servedVersionId: chatbot.prodVersionId ?? undefined,
        });
        const parsedState = ConversationStateSchema.safeParse(inbound.state);
        const preservedState: ConversationState = parsedState.success ? parsedState.data : { version: CONVERSATION_STATE_VERSION, contextSession: null };
        return { messageId, outputs, state: preservedState, stateReset: false };
      }
      throw e;
    }
    const { bundle, index, settings } = serving;
    const now = new Date();
    const turnInput = inbound.buttonAction ? { buttonAction: inbound.buttonAction } : { message: inbound.message ?? '' };

    // ③.5 [신규 No.27] 설문이 이번 입력을 소비할 것으로 예상되면 의미 점수 계산을 생략한다(§22 D-14) —
    // 설문 답("4점"·"1,3")에 임베딩 1회·질의 LRU 캐시 오염을 쓰지 않는다.
    const surveyExpected = willSurveyConsumeInput(inbound.state, bundle, now);

    // ③.6 [신규 No.36] 입구 가드레일(ai-guardrails-설계.md §5.1) — 금지어 BLOCK(②.5)·상담 HANDLED(②.7)·버전 읽기 실패
    // 폴백은 이미 반환했다. 설문이 소비할 턴·`NODE` 버튼(=filterableText undefined)은 판정하지 않는다. 전역 색인에
    // 없는 챗봇은 메모리 조회 1회로 `PASS`(쿼리 0 · 정규화 0).
    const guardrailVerdict = !surveyExpected && filterableText !== undefined ? await this.guardrails?.evaluateInbound(chatbot.id, filterableText) : undefined;
    if (guardrailVerdict?.action === 'REPLACE' && guardrailVerdict.replacementText) {
      // 엔진·의미 점수·설문·RAG·워크플로를 부르지 않고 안전 문구를 즉시 돌려준다. 상태는 보존한다(BLOCK과 같은 모양).
      const messageId = randomUUID();
      const outputs = await this.bannedWordFilter.maskOutbound([...handoffPrependOutputs, { type: 'TEXT' as const, payload: { text: guardrailVerdict.replacementText } }]);
      void this.logService.record({
        id: messageId,
        chatbotId: chatbot.id,
        groupId: chatbot.groupId,
        channelType: 'WEB',
        sessionId: dto.sessionId,
        rawUserMessage: resolveUserMessageText(inbound),
        rawBotResponse: buildBotResponseText(outputs),
        isAnswered: false,
        inputKind: resolveInputKind(inbound),
        servedVersionId: serving.versionId ?? undefined,
        guardrailStage: 'INBOUND',
      });
      this.guardrails?.recordEvents({ chatbotId: chatbot.id, messageId, verdict: guardrailVerdict });
      const parsedState = ConversationStateSchema.safeParse(inbound.state);
      const preservedState: ConversationState = parsedState.success ? parsedState.data : { version: CONVERSATION_STATE_VERSION, contextSession: null };
      // 위기 질문 → 상담 연결이 가능한 챗봇이면 관찰 창 힌트를 싣는다(미응답 턴 · 출구 대체 `FAILED`와 대칭 — R-5).
      const watchHint = await this.buildWatchHint(chatbot.id, dto.features, false);
      const safetyResponse: PublicMessageResponse = { messageId, outputs, state: preservedState, stateReset: false, ...(watchHint ? { handoff: watchHint } : {}) };
      // [신규 No.32 · H-3] 입구 안전 문구 대체 = 봇 답변(DD-136) — 읽기 글자는 봇 출력만(전치 상담원 메시지 제외 — C-16). 말투는 CALM 고정.
      return speechPlan ? withSpeech(this.voicePublic!, safetyResponse, speechPlan, 'SAFETY', outputs.slice(handoffPrependOutputs.length)) : safetyResponse;
    }

    // ③④ [신규] 1단계 의미 유사도 점수 주입(ADR-0020) — `NODE` 버튼(=filterableText undefined)은
    // 후보 대상이 아니다. `semanticEnabled=false`이면 엔진은 저하 모드(현행 규칙 매칭)로 동작한다.
    // [신규 No.40] 버전 경로는 5번째 인자로 리졸버 결과를 넘긴다(초안 경로는 4인자 그대로, `undefined`).
    const semanticText = filterableText;
    const semantic =
      !surveyExpected && settings.semanticEnabled && semanticText !== undefined
        ? await this.semanticMatch.score(
            chatbot.id,
            semanticText,
            bundle,
            { accept: settings.acceptThreshold, low: settings.lowThreshold, margin: settings.marginThreshold },
            serving.semanticSource,
          )
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

    // ④.7 [신규 No.41] 업무 자동화 워크플로우 — `WORKFLOW` 방출이 있을 때만(키 부재 = 분기 1개 ·
    // 추가 조회 0). 예외를 던지지 않는다(내부 try/catch — 경고 로그만, §6.1). 봇 응답은 바뀌지 않는다.
    if (result.workflowEvents && result.workflowEvents.length > 0) {
      await this.workflowTriggers?.enqueueNodeEmissions(result.workflowEvents, {
        chatbot: { id: chatbot.id, name: chatbot.name },
        sessionId: dto.sessionId,
        messageId,
        channel: 'WEB',
        servedVersionId: serving.versionId ?? null,
        now,
      });
    }

    // [신규 No.46] 위젯 기능 선언(`features`)을 넘기기만 한다 — 프로필 선택은 어댑터 안(RM-11).
    const rendered = adapter.renderOutbound(result.outputs, { features: dto.features });
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
    const ragEligible = apiTurn ? false : this.evaluateRagEligibility(settings, bundle, result, inbound, isAnswered, inputKind, surveyTurn);
    // [신규 No.36] "AI로 보내지 않음" — 엔진 결과는 그대로 두고 외부 RAG 진입만 막는다(유량 슬롯을 소비하지 않는다).
    const shouldTryRag = ragEligible && guardrailVerdict?.action !== 'NO_RAG';
    if (guardrailVerdict && guardrailVerdict.action !== 'PASS') {
      this.guardrails?.recordEvents({ chatbotId: chatbot.id, messageId, verdict: guardrailVerdict, ragEligible });
    }
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
        servedVersionId: serving.versionId ?? undefined,
        ...(speechPlan ? { speechPlan } : {}),
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
      // [신규 No.40] R-4 — 엔진·BLOCK·상담 턴 공통으로 이 시점 운영 포인터를 적재한다(§14).
      servedVersionId: serving.versionId ?? undefined,
    });

    // [신규 No.32 · H-3] 정상 턴 = 봇 답변(DD-136) — `judgeAnswered`로 ANSWERED/UNANSWERED, 노드 꼬리표는 최종 노드(`matchedNodeId`) 기준.
    // 읽기 글자는 봇 출력만(`slice` — 전치 상담원 메시지 제외, C-16). `logService.record()` 인자는 불변이다(speech 글자 미저장 — VO-8).
    return speechPlan
      ? withSpeech(this.voicePublic!, response, speechPlan, isAnswered ? 'ANSWERED' : 'UNANSWERED', outputs.slice(handoffPrependOutputs.length), result.matchedNodeId)
      : response;
  }

  /** `GET /public/chatbots/:slug/messages/:messageId`(`@Public()` 6번째, ADR-0023). */
  async pollMessage(slug: string, messageId: string): Promise<PendingAnswerPollResponse> {
    const snapshot = this.pendingStore.get(messageId, slug);
    if (!snapshot) {
      throw new ApiException('PENDING_ANSWER_NOT_FOUND', 404, '요청하신 답변을 찾을 수 없거나 만료되었습니다.');
    }
    // [신규 No.32] 최종 답(`READY`·`FAILED`)이고 말투 계획이 있으면 `speech`를 마지막 키로 붙인다 — `FAILED` + 안전 대체 표식 = `SAFETY`(CALM),
    // 그 밖의 `FAILED`(챗봇 폴백 문구) = `UNANSWERED`. `PENDING`·만료(404)에는 붙지 않는다. 폴링 결과 출력에는 G-8 전치 출력이 없다.
    const speech =
      this.voicePublic && snapshot.speech && snapshot.outputs && (snapshot.status === 'READY' || snapshot.status === 'FAILED')
        ? this.voicePublic.build(snapshot.speech, snapshot.status === 'READY' ? 'ANSWERED' : snapshot.safetyReplaced ? 'SAFETY' : 'UNANSWERED', snapshot.outputs)
        : undefined;
    return { status: snapshot.status, outputs: snapshot.outputs, sources: snapshot.sources, ...(speech ? { speech } : {}) };
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
    /** [신규 No.40] POST 시점의 운영 포인터 — 백그라운드 완료 시 같은 값으로 적재한다(§14). */
    servedVersionId?: string;
    /** [신규 No.32] 폴링 최종 답용 말투 계획(보류 저장소에만 둔다). */
    speechPlan?: SpeechReplyPlan;
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
      // [신규 No.32] 말투 **계획**만 저장한다(글자 아님) — 폴링 최종 답(READY·FAILED)의 `speech` 조립용. 대기 문구 응답에는 `speech`가 붙지 않는다(H-3).
      this.pendingStore.create(input.messageId, { chatbotId: input.chatbotId, slug: input.slug, expiresAt, ...(input.speechPlan ? { speech: input.speechPlan } : {}) });
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
        servedVersionId: input.servedVersionId,
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

/**
 * [신규 No.32] 봇 답변 반환 지점(DD-136)에서만 호출하는 `speech` 조립 — **정확히 2곳**(입구 안전 문구 대체 · 정상 턴, VO-17). 읽기 글자가 비면
 * 응답을 그대로(같은 참조) 돌려준다. `speech`는 항상 **마지막 키**다(조건부 전개). 시스템 안내 3종(BLOCK·버전 읽기 실패·보류 시작)·상담 HANDLED 반환문에는
 * 쓰지 않는다.
 */
function withSpeech(
  voicePublic: VoicePublicService,
  response: PublicMessageResponse,
  plan: SpeechReplyPlan,
  kind: 'ANSWERED' | 'UNANSWERED' | 'SAFETY',
  botOutputs: readonly DialogOutput[],
  matchedNodeId?: string | null,
): PublicMessageResponse {
  const speech = voicePublic.build(plan, kind, botOutputs, matchedNodeId);
  return speech ? { ...response, speech } : response;
}
