import { Injectable } from '@nestjs/common';
import type { Chatbot as ChatbotRow, Channel as ChannelRow } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ApiException } from '../common/api.exception';

export interface PublicAccessResult {
  chatbot: ChatbotRow;
  channel: ChannelRow;
}

/**
 * `slug` → {챗봇, WEB 채널} 접근 판정(FR-11-16). **캐시하지 않는다** — 챗봇 상태·채널 활성화는
 * 긴급 중단(S-10)이 캐시 TTL과 무관하게 즉시 반영되어야 하므로 매 요청 직접 조회한다(§8.1).
 * 존재하지 않는 slug는 404, 존재하지만 비공개/채널 비활성은 403이다(NFR-S10 예외, ADR-0011 §3).
 */
@Injectable()
export class PublicAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(slug: string): Promise<PublicAccessResult> {
    const chatbot = await this.prisma.chatbot.findUnique({ where: { slug } });
    if (!chatbot) {
      throw new ApiException('NOT_FOUND', 404, '요청하신 챗봇을 찾을 수 없습니다.');
    }
    if (chatbot.status !== 'ACTIVE') {
      throw new ApiException('CHATBOT_NOT_PUBLISHED', 403, '현재 상담을 이용할 수 없습니다.');
    }
    const channel = await this.prisma.channel.findUnique({ where: { chatbotId_type: { chatbotId: chatbot.id, type: 'WEB' } } });
    if (!channel || !channel.enabled) {
      throw new ApiException('CHANNEL_DISABLED', 403, '현재 상담을 이용할 수 없습니다.');
    }
    return { chatbot, channel };
  }
}
