import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { resolveTurn } from '@chat-bot/dialogue-engine';
import type {
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

/**
 * 공개 대화 1턴 파이프라인(FR-11-14~27, §8.3). `resolveTurn` 한 경로만 호출한다(FR-0-19).
 * ⑨ 응답 반환 → ⑩ 로그 적재(await 하지 않는다, FR-11-24/NFR-P6) 순서가 계약이다.
 */
@Injectable()
export class PublicConversationService {
  constructor(
    private readonly access: PublicAccessService,
    private readonly bundleService: DialogueBundleService,
    private readonly adapterFactory: ChannelAdapterFactory,
    private readonly logService: ConversationLogService,
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

    const { bundle, index } = await this.bundleService.getCached(chatbot.id);
    const now = new Date();
    const turnInput = inbound.buttonAction ? { buttonAction: inbound.buttonAction } : { message: inbound.message ?? '' };
    const result = resolveTurn(turnInput, inbound.state, bundle, now, { index });

    const rendered = adapter.renderOutbound(result.outputs);
    const outputs = rendered[0]?.outputs ?? [];
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
