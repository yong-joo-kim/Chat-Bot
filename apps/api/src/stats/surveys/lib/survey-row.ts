import { Logger } from '@nestjs/common';
import type { Survey as SurveyRow } from '@prisma/client';
import type { Survey, SurveyQuestion, SurveyStatus } from '@chat-bot/shared-types';

const logger = new Logger('SurveyStatsRowParser');

/**
 * [No.27] `stats/surveys/`는 `surveys/`·`survey-responses/`를 import하지 않는다(설계 §2.2 — 읽기는
 * Prisma 직접). `dialogue-bundle.service.ts` 선례와 같은 독립 파싱 함수를 둔다.
 */
function safeParseArray<T>(json: string, context: string): T[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    logger.warn(`JSON 파싱 실패 — 기본값([])으로 폴백: ${context}`);
    return [];
  }
}

export function parseSurveyRow(row: SurveyRow): Survey {
  return {
    id: row.id,
    chatbotId: row.chatbotId,
    name: row.name,
    description: row.description ?? undefined,
    status: row.status as SurveyStatus,
    activeFrom: row.activeFrom ?? undefined,
    activeTo: row.activeTo ?? undefined,
    introMessage: row.introMessage ?? undefined,
    completionMessage: row.completionMessage,
    cancelKeywords: safeParseArray<string>(row.cancelKeywords, `Survey.cancelKeywords(${row.id})`),
    sessionTimeoutMinutes: row.sessionTimeoutMinutes,
    questions: safeParseArray<SurveyQuestion>(row.questions, `Survey.questions(${row.id})`),
    structureVersion: row.structureVersion,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
