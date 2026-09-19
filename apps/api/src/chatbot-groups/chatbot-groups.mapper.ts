import type { ChatbotGroup as PrismaChatbotGroup } from '@prisma/client';
import { ChatbotGroupWithCount } from '@chat-bot/shared-types';

type GroupRowWithCount = PrismaChatbotGroup & { _count: { chatbots: number } };

/** Prisma row(+ `_count`) → `ChatbotGroupWithCount` DTO 변환(FR-1-2). */
export function toChatbotGroupWithCountDto(row: GroupRowWithCount): ChatbotGroupWithCount {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    chatbotCount: row._count.chatbots,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
