import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { resolveTurn } from '@chat-bot/dialogue-engine';
import { CONVERSATION_STATE_VERSION, ConversationStateSchema } from '@chat-bot/shared-types';
import type {
  ConversationState,
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

/** 금지어 차단 시 반환하는 고정 안내(FR-12-38, S-11). 관리자 문구 커스터마이즈는 이번 Phase 범위 밖이다. */
const BANNED_WORD_GUIDANCE_TEXT = '바람직하지 않은 표현이 포함되어 있습니다. 다시 입력해 주세요.';

/**
 * 공개 대화 1턴 파이프라인(FR-11-14~27, §8.3). `resolveTurn` 한 경로만 호출한다(FR-0-19).
 * No.12부터 금지어 필터 2지점이 추가된다(②.5 입구 / ⑤.5 출구, FR-12-38/40, §10.2).
 * ⑨ 응답 반환 → ⑩ 로그 적재(await 하지 않는다, FR-11-24/NFR-P6) 순서가 계약이다.
 */
@Injectable()
export class PublicConversationService {
  constructor(
    private readonly access: PublicAccessService,
    private readonly bundleService: DialogueBundleService,
    private readonly adapterFactory: ChannelAdapterFactory,
    private readonly logService: ConversationLogService,
    private readonly bannedWordFilter: BannedWordFilterService,
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
    const now = new Date();
    const turnInput = inbound.buttonAction ? { buttonAction: inbound.buttonAction } : { message: inbound.message ?? '' };
    const result = resolveTurn(turnInput, inbound.state, bundle, now, { index });

    const rendered = adapter.renderOutbound(result.outputs);
    // ⑤.5 출구 금지어 필터(FR-12-40) — 정책 무관, 항상 마스킹만 한다(차단하지 않는다).
    const outputs = await this.bannedWordFilter.maskOutbound(rendered[0]?.outputs ?? []);
    const messageId = randomUUID();
    const stateReset = result.stateDiscarded.length > 0;

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
      channelType: 'WEB',
      sessionId: dto.sessionId,
      rawUserMessage: resolveUserMessageText(inbound),
      rawBotResponse: buildBotResponseText(outputs),
      matchedIntentId: result.matchedIntentId,
      matchedNodeId: result.matchedNodeId,
      matchedFaqId: result.matchedFaqId,
      isAnswered: judgeAnswered(result.trace),
      inputKind: resolveInputKind(inbound),
    });

    return response;
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
