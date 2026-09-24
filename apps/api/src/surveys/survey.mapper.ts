import { Logger } from '@nestjs/common';
import type { Survey as SurveyRow } from '@prisma/client';
import type { Survey, SurveyDetail, SurveyListItem, SurveyQuestion, SurveyStatus } from '@chat-bot/shared-types';

const logger = new Logger('SurveyMapper');

function safeParseArray<T>(json: string, context: string): T[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    logger.warn(`JSON 파싱 실패 — 기본값([])으로 폴백: ${context}`);
    return [];
  }
}

export function parseQuestions(row: Pick<SurveyRow, 'id' | 'questions'>): SurveyQuestion[] {
  return safeParseArray<SurveyQuestion>(row.questions, `Survey.questions(${row.id})`);
}

export function toSurveyEntity(row: SurveyRow): Survey {
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
    questions: parseQuestions(row),
    structureVersion: row.structureVersion,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function toSurveyDetail(
  row: SurveyRow,
  extra: { locked: boolean; responseCount: number; referencingNodes: { id: string; name: string }[] },
): SurveyDetail {
  return {
    ...toSurveyEntity(row),
    locked: extra.locked,
    responseCount: extra.responseCount,
    referencingNodeCount: extra.referencingNodes.length,
    referencingNodes: extra.referencingNodes.slice(0, 5),
  };
}

export function toSurveyListItem(
  row: SurveyRow,
  extra: { locked: boolean; referencingNodeCount: number; last30d: { exposed: number; completed: number } },
): SurveyListItem {
  return {
    id: row.id,
    name: row.name,
    status: row.status as SurveyStatus,
    activeFrom: row.activeFrom ?? undefined,
    activeTo: row.activeTo ?? undefined,
    questionCount: parseQuestions(row).length,
    structureVersion: row.structureVersion,
    locked: extra.locked,
    referencingNodeCount: extra.referencingNodeCount,
    last30d: extra.last30d,
    updatedAt: row.updatedAt,
  };
}

/** 감사 스냅샷용(§12) — 문항 본문을 담지 않고 건수만 싣는다. */
export function toAuditSnapshot(row: SurveyRow) {
  return {
    name: row.name,
    status: row.status,
    activeFrom: row.activeFrom,
    activeTo: row.activeTo,
    questionCount: parseQuestions(row).length,
    structureVersion: row.structureVersion,
    sessionTimeoutMinutes: row.sessionTimeoutMinutes,
  };
}
