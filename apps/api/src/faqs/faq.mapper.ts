import { Logger } from '@nestjs/common';
import type { FaqEntry as PrismaFaq } from '@prisma/client';
import type { FaqCategory, FaqEntry } from '@chat-bot/shared-types';

const logger = new Logger('FaqMapper');

function parseAltQuestions(json: string, id: string): string[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    logger.warn(`altQuestions 파싱 실패(faqId=${id}) — 기본값([])으로 폴백`);
    return [];
  }
}

export function toFaqEntity(row: PrismaFaq): FaqEntry {
  return {
    id: row.id,
    chatbotId: row.chatbotId,
    category: row.category as FaqCategory,
    question: row.question,
    answer: row.answer,
    altQuestions: parseAltQuestions(row.altQuestions, row.id),
    enabled: row.enabled,
    topicId: row.topicId ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
