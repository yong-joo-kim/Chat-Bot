import { Logger } from '@nestjs/common';
import type { ContextVariable as PrismaContext } from '@prisma/client';
import type { ContextListItem, ContextSlot, ContextVariable } from '@chat-bot/shared-types';

const logger = new Logger('ContextMapper');

function parseSlots(json: string, id: string): ContextSlot[] {
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    // NFR-M4: label 누락 시 name으로 폴백(요구사항 §4.2(d) 주석)
    return parsed.map((s: Partial<ContextSlot>) => ({ ...s, label: s.label ?? s.name ?? '' })) as ContextSlot[];
  } catch {
    logger.warn(`slots 파싱 실패(contextId=${id}) — 기본값([])으로 폴백`);
    return [];
  }
}

function parseCancelKeywords(json: string, id: string): string[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : ['취소', '그만', '처음으로'];
  } catch {
    logger.warn(`cancelKeywords 파싱 실패(contextId=${id})`);
    return ['취소', '그만', '처음으로'];
  }
}

export function toContextEntity(row: PrismaContext): ContextVariable {
  return {
    id: row.id,
    chatbotId: row.chatbotId,
    name: row.name,
    description: row.description ?? undefined,
    slots: parseSlots(row.slots, row.id),
    completionMessage: row.completionMessage ?? undefined,
    cancelKeywords: parseCancelKeywords(row.cancelKeywords, row.id),
    sessionTimeoutMinutes: row.sessionTimeoutMinutes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function toContextListItem(row: PrismaContext): ContextListItem {
  const entity = toContextEntity(row);
  return {
    id: entity.id,
    name: entity.name,
    description: entity.description,
    slotCount: entity.slots.length,
    updatedAt: entity.updatedAt,
  };
}
