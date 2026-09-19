import { Logger } from '@nestjs/common';
import type { Chatbot as PrismaChatbot } from '@prisma/client';
import { Chatbot, ChatbotListItem, ChatbotStatus } from '@chat-bot/shared-types';
import { parseSkin } from './lib/skin.util';

const logger = new Logger('ChatbotMapper');

/**
 * Prisma row → zod DTO 변환 전담(§7.5). null → undefined, skin JSON 문자열 → 객체,
 * status 파싱 실패 시 DRAFT 폴백 + 경고 로그를 여기서 처리한다.
 */
export function toChatbotDto(row: PrismaChatbot): Chatbot {
  const statusResult = ChatbotStatus.safeParse(row.status);
  if (!statusResult.success) {
    logger.warn(`알 수 없는 status 값(chatbotId=${row.id}): "${row.status}" → DRAFT로 폴백`);
  }
  const status = statusResult.success ? statusResult.data : 'DRAFT';

  const { skin, fellBackToDefault, warning } = parseSkin(row.skin);
  if (fellBackToDefault) {
    logger.warn(`skin 파싱 실패(chatbotId=${row.id}): ${warning}`);
  }

  return {
    id: row.id,
    groupId: row.groupId,
    name: row.name,
    avatarUrl: row.avatarUrl ?? undefined,
    description: row.description ?? undefined,
    slug: row.slug,
    status,
    skin,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** 목록 행 — 소속 그룹명 포함(FR-1-11). N+1 방지를 위해 호출자가 `include: { group: { select: { name: true } } }`로 조회한다. */
export function toChatbotListItemDto(row: PrismaChatbot & { group: { name: string } }): ChatbotListItem {
  return {
    ...toChatbotDto(row),
    groupName: row.group.name,
  };
}
