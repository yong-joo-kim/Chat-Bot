import type { Topic as PrismaTopicRow } from '@prisma/client';
import type { Topic } from '@chat-bot/shared-types';

export function toTopicDto(row: PrismaTopicRow): Topic {
  return {
    id: row.id,
    chatbotId: row.chatbotId,
    name: row.name,
    description: row.description ?? undefined,
    sortOrder: row.sortOrder,
    enabled: row.enabled,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
