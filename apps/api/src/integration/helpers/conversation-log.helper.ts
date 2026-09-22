import type { ChannelType } from '@chat-bot/shared-types';
import { toKstDayBucket, toKstHourOfDay } from '@chat-bot/shared-types';
import { PrismaService } from '../../prisma/prisma.service';

export interface CreateConversationLogInput {
  chatbotId: string;
  userMessage: string;
  botResponse?: string;
  isAnswered: boolean;
  blockedByFilter?: boolean;
  channelType?: ChannelType;
  sessionId?: string | null;
  matchedNodeId?: string;
  matchedFaqId?: string;
  createdAt?: Date;
}

/**
 * 통합 테스트 전용 `ConversationLog` 생성 헬퍼(NFR-M8, §13.2). `dayBucket`/`hourBucket`을
 * `@chat-bot/shared-types`의 순수 함수로 계산해 채운다 — 센티넬(`""`/`-1`)을 만드는 새 테스트가
 * 늘어나면 "버킷 없는 로그"가 정상처럼 보이기 시작하므로, 신규 통계 스펙은 반드시 이 헬퍼를 쓴다.
 */
export async function createConversationLog(prisma: PrismaService, input: CreateConversationLogInput) {
  const createdAt = input.createdAt ?? new Date();
  return prisma.conversationLog.create({
    data: {
      chatbotId: input.chatbotId,
      channelType: input.channelType ?? 'WEB',
      sessionId: input.sessionId ?? undefined,
      userMessage: input.userMessage,
      botResponse: input.botResponse ?? '안내해 드리겠습니다.',
      isAnswered: input.isAnswered,
      blockedByFilter: input.blockedByFilter ?? false,
      matchedNodeId: input.matchedNodeId,
      matchedFaqId: input.matchedFaqId,
      dayBucket: toKstDayBucket(createdAt),
      hourBucket: toKstHourOfDay(createdAt),
      createdAt,
    },
  });
}
