import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { resolveTurn } from '@chat-bot/dialogue-engine';
import { CONVERSATION_STATE_VERSION, ConversationStateSchema } from '@chat-bot/shared-types';
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

/** 대기 안내 문구(FR-N2-34, S-4) — "RAG"·"LLM"·"벡터" 같은 내부 용어를 쓰지 않는다(FR-N2-24). */
const RAG_WAITING_TEXT = '문서에서 찾아보고 있어요. 잠시만요.';

/** 금지어 차단 시 반환하는 고정 안내(FR-12-38, S-11). 관리자 문구 커스터마이즈는 이번 Phase 범위 밖이다. */
const BANNED_WORD_GUIDANCE_TEXT = '바람직하지 않은 표현이 포함되어 있습니다. 다시 입력해 주세요.';

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

  async sendMessage(slug: string, dto: PublicMessageRequestDto): Promise<PublicMessageResponse> {
    const { chatbot } = await this.access.resolve(slug);
    const adapter = this.adapterFactory.getAdapter('WEB');
    const inbound = adapter.normalizeInbound(dto);

    // ②.5 입구 금지어 필터(FR-12-38/39) — BLOCK이면 엔진을 호출하지 않는다.
    // `NODE` 버튼은 사용자 입력이 아니라 봇이 제공한 선택지라 대상이 아니다(§10.2, 항상 PASS).
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

    const { bundle, index } = await this.bundleService.getCached(chatbot.id);
    const settings = await this.answerSettingsCache.get(chatbot.id);
    const now = new Date();
    const turnInput = inbound.buttonAction ? { buttonAction: inbound.buttonAction } : { message: inbound.message ?? '' };

    // ③④ [신규] 1단계 의미 유사도 점수 주입(ADR-0020) — `NODE` 버튼(=filterableText undefined)은
    // 후보 대상이 아니다. `semanticEnabled=false`이면 엔진은 저하 모드(현행 규칙 매칭)로 동작한다.
    const semanticText = filterableText;
    const semantic =
      settings.semanticEnabled && semanticText !== undefined
        ? await this.semanticMatch.score(chatbot.id, semanticText, bundle, {
            accept: settings.acceptThreshold,
            low: settings.lowThreshold,
            margin: settings.marginThreshold,
          })
        : undefined;

    const result = resolveTurn(turnInput, inbound.state, bundle, now, { index, semantic });

    const rendered = adapter.renderOutbound(result.outputs);
    // ⑤.5 출구 금지어 필터(FR-12-40) — 정책 무관, 항상 마스킹만 한다(차단하지 않는다).
    const outputs = await this.bannedWordFilter.maskOutbound(rendered[0]?.outputs ?? []);
    const messageId = randomUUID();
    const stateReset = result.stateDiscarded.length > 0;
    const isAnswered = judgeAnswered(result.trace);
    const inputKind = resolveInputKind(inbound);

    // ⑦ [신규] 2단계(외부 RAG) 분기 판정 — 9조건(FR-N2-1) + 유량 여유(회로·동시성·레이트리밋)까지
    // 전부 통과해야 PENDING으로 넘어간다. 하나라도 막히면 기존 폴백 경로로 수렴한다(FR-0-43).
    const shouldTryRag = this.evaluateRagEligibility(settings, bundle, result, inbound, isAnswered, inputKind);
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
      });
    }

    const response: PublicMessageResponse = {
      messageId,
      outputs,
      state: result.nextState,
      stateReset,
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
      waitingOutputs = await this.bannedWordFilter.maskOutbound([{ type: 'TEXT', payload: { text: RAG_WAITING_TEXT } }]);
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
      },
      { record: (params) => this.logService.record(params) },
    );

    return {
      messageId: input.messageId,
      outputs: waitingOutputs,
      state: input.nextState,
      stateReset: input.stateReset,
      pendingAnswer: { id: input.messageId, pollAfterMs: 1200, expiresAt },
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
