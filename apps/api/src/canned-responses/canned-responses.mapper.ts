import type { CannedResponse as CannedResponseRow } from '@prisma/client';
import type { CannedResponse } from '@chat-bot/shared-types';

export function toCannedResponseDto(row: CannedResponseRow): CannedResponse {
  return {
    id: row.id,
    chatbotId: row.chatbotId,
    title: row.title,
    body: row.body,
    category: row.category,
    shortcut: row.shortcut,
    sortOrder: row.sortOrder,
    enabled: row.enabled,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
