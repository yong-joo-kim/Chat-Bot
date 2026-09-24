import type { ChannelType } from '@chat-bot/shared-types';
import { toKstDayBucket, toKstHourOfDay } from '@chat-bot/shared-types';
import { PrismaService } from '../../prisma/prisma.service';

export interface CreateConversationLogInput {
  chatbotId: string;
  /** [신규 No.29] 미지정 시 챗봇의 **현재** `groupId`를 조회해 채운다(센티넬 `''`을 만들지 않는다 —
   * ADR-0017 §6 ④ 선례와 동일한 이유). 과거 그룹 이동을 검증하는 스펙은 명시적으로 지정한다. */
  groupId?: string;
  userMessage: string;
  botResponse?: string;
  isAnswered: boolean;
  blockedByFilter?: boolean;
  channelType?: ChannelType;
  sessionId?: string | null;
  matchedIntentId?: string;
  matchedNodeId?: string;
  matchedFaqId?: string;
  createdAt?: Date;
}

/**
 * 통합 테스트 전용 `ConversationLog` 생성 헬퍼(NFR-M8, §13.2). `dayBucket`/`hourBucket`을
 * `@chat-bot/shared-types`의 순수 함수로 계산해 채운다 — 센티넬(`""`/`-1`)을 만드는 새 테스트가
 * 늘어나면 "버킷 없는 로그"가 정상처럼 보이기 시작하므로, 신규 통계 스펙은 반드시 이 헬퍼를 쓴다.
 * [신규 No.29] `groupId`도 같은 이유로 센티넬(`''`)을 만들지 않는다 — 미지정 시 이 헬퍼가 챗봇의
 * 현재 소속을 조회해 채운다.
 */
export async function createConversationLog(prisma: PrismaService, input: CreateConversationLogInput) {
  const createdAt = input.createdAt ?? new Date();
  const groupId = input.groupId ?? (await resolveCurrentGroupId(prisma, input.chatbotId));
  return prisma.conversationLog.create({
    data: {
      chatbotId: input.chatbotId,
      groupId,
      channelType: input.channelType ?? 'WEB',
      sessionId: input.sessionId ?? undefined,
      userMessage: input.userMessage,
      botResponse: input.botResponse ?? '안내해 드리겠습니다.',
      isAnswered: input.isAnswered,
      blockedByFilter: input.blockedByFilter ?? false,
      matchedIntentId: input.matchedIntentId,
      matchedNodeId: input.matchedNodeId,
      matchedFaqId: input.matchedFaqId,
      dayBucket: toKstDayBucket(createdAt),
      hourBucket: toKstHourOfDay(createdAt),
      createdAt,
    },
  });
}

async function resolveCurrentGroupId(prisma: PrismaService, chatbotId: string): Promise<string> {
  const chatbot = await prisma.chatbot.findUniqueOrThrow({ where: { id: chatbotId }, select: { groupId: true } });
  return chatbot.groupId;
}
