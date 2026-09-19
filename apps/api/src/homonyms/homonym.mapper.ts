import { Logger } from '@nestjs/common';
import type { HomonymDictionary as PrismaHomonym } from '@prisma/client';
import type { HomonymDictionary, HomonymListItem, HomonymMeaning, HomonymPolicy } from '@chat-bot/shared-types';

const logger = new Logger('HomonymMapper');

function parseMeanings(json: string, id: string): HomonymMeaning[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? (parsed as HomonymMeaning[]) : [];
  } catch {
    logger.warn(`meanings 파싱 실패(homonymId=${id}) — 기본값([])으로 폴백`);
    return [];
  }
}

export function toHomonymEntity(row: PrismaHomonym): HomonymDictionary {
  return {
    id: row.id,
    chatbotId: row.chatbotId,
    word: row.word,
    description: row.description ?? undefined,
    meanings: parseMeanings(row.meanings, row.id),
    policy: (row.policy as HomonymPolicy) ?? 'ASK',
    clarifyPrompt: row.clarifyPrompt ?? undefined,
    defaultMeaningIndex: row.defaultMeaningIndex ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function toHomonymListItem(row: PrismaHomonym): HomonymListItem {
  const entity = toHomonymEntity(row);
  return {
    id: entity.id,
    word: entity.word,
    meaningCount: entity.meanings.length,
    policy: entity.policy,
    updatedAt: entity.updatedAt,
  };
}
