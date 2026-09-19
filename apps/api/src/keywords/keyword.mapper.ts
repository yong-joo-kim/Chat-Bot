import { Logger } from '@nestjs/common';
import type { Keyword as PrismaKeyword } from '@prisma/client';
import type { Keyword, KeywordDetail, KeywordListItem, ResourceRef } from '@chat-bot/shared-types';

const logger = new Logger('KeywordMapper');

function parseSynonyms(json: string, keywordId: string): string[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    logger.warn(`synonyms 파싱 실패(keywordId=${keywordId}) — 기본값([])으로 폴백`);
    return [];
  }
}

export function toKeywordEntity(row: PrismaKeyword): Keyword {
  return {
    id: row.id,
    chatbotId: row.chatbotId,
    name: row.name,
    description: row.description ?? undefined,
    synonyms: parseSynonyms(row.synonyms, row.id),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function toKeywordListItem(row: PrismaKeyword & { _count: { nodeLinks: number } }): KeywordListItem {
  const entity = toKeywordEntity(row);
  return {
    id: entity.id,
    name: entity.name,
    description: entity.description,
    synonymCount: entity.synonyms.length,
    linkedNodeCount: row._count.nodeLinks,
    updatedAt: entity.updatedAt,
  };
}

export function toKeywordDetail(row: PrismaKeyword, linkedNodes: ResourceRef[]): KeywordDetail {
  return { ...toKeywordEntity(row), linkedNodes };
}
