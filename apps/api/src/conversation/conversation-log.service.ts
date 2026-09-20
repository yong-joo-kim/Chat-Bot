import { Injectable, Logger } from '@nestjs/common';
import type { ChannelType } from '@chat-bot/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { maskPii } from './lib/pii-mask';

export interface RecordConversationLogParams {
  /** 공개 대화 API의 `messageId`를 그대로 쓴다(§8.3) — 향후 피드백(No.44)이 이 값을 앵커로 쓸 수 있다. */
  id?: string;
  chatbotId: string;
  channelType: ChannelType;
  sessionId: string;
  rawUserMessage: string;
  rawBotResponse: string;
  matchedIntentId?: string;
  matchedNodeId?: string;
  matchedFaqId?: string;
  isAnswered: boolean;
}

/**
 * `ConversationLog` 적재 단일 진입점(FR-11-20, §6 규약 ②). PII 마스킹은 **이 안에서만** 적용한다
 * (ADR-0013) — 다른 곳에서 `prisma.conversationLog.create`를 직접 호출하지 않는다.
 * 적재 실패는 대화 응답을 실패시키지 않는다(FR-11-24) — 호출부가 `await` 없이 fire-and-forget으로
 * 부르고, 여기서 모든 예외를 삼켜 경고 로그만 남긴다.
 */
@Injectable()
export class ConversationLogService {
  private readonly logger = new Logger('ConversationLogService');

  constructor(private readonly prisma: PrismaService) {}

  async record(params: RecordConversationLogParams): Promise<void> {
    try {
      const userMessage = maskPii(params.rawUserMessage).maskedText;
      // ⚠ botResponse도 마스킹 대상이다 — completionMessage의 {슬롯} 치환값에 사용자가 입력한
      // 전화번호/이메일이 그대로 들어갈 수 있다(§8.4).
      const botResponse = maskPii(params.rawBotResponse).maskedText;

      await this.prisma.conversationLog.create({
        data: {
          ...(params.id ? { id: params.id } : {}),
          chatbotId: params.chatbotId,
          channelType: params.channelType,
          sessionId: params.sessionId,
          userMessage,
          botResponse,
          matchedIntentId: params.matchedIntentId,
          matchedNodeId: params.matchedNodeId,
          matchedFaqId: params.matchedFaqId,
          isAnswered: params.isAnswered,
        },
      });
    } catch (e) {
      // 경고 로그에도 메시지 본문을 넣지 않는다(chatbotId/sessionId/오류코드만, NFR-S4).
      const errorMessage = e instanceof Error ? e.message : 'unknown error';
      this.logger.warn(`ConversationLog 적재 실패: chatbotId=${params.chatbotId} sessionId=${params.sessionId} error=${errorMessage}`);
    }
  }
}
