import { Logger } from '@nestjs/common';
import type { Intent as PrismaIntent } from '@prisma/client';
import type { Intent, IntentDetail, IntentListItem, ResourceRef } from '@chat-bot/shared-types';

const logger = new Logger('IntentMapper');

function parseExamples(json: string, intentId: string): string[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    logger.warn(`examples 파싱 실패(intentId=${intentId}) — 기본값([])으로 폴백`);
    return [];
  }
}

/** Prisma row → 엔티티(NFR-M3, JSON ↔ 객체 변환은 mapper에서만). */
export function toIntentEntity(row: PrismaIntent): Intent {
  return {
    id: row.id,
    chatbotId: row.chatbotId,
    name: row.name,
    description: row.description ?? undefined,
    examples: parseExamples(row.examples, row.id),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function toIntentListItem(row: PrismaIntent & { _count: { nodeLinks: number } }): IntentListItem {
  const entity = toIntentEntity(row);
  return {
    id: entity.id,
    name: entity.name,
    description: entity.description,
    exampleCount: entity.examples.length,
    linkedNodeCount: row._count.nodeLinks,
    updatedAt: entity.updatedAt,
  };
}

export function toIntentDetail(row: PrismaIntent, linkedNodes: ResourceRef[]): IntentDetail {
  return { ...toIntentEntity(row), linkedNodes };
}
