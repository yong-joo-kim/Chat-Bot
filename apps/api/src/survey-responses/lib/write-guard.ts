import { validateSurveyAnswerValue } from '@chat-bot/shared-types';
import type { Survey, SurveyAnswerValue } from '@chat-bot/shared-types';

export type WriteGuardCode = 'NO_ROW' | 'BAD_STATUS' | 'VERSION_MISMATCH' | 'KEY_MISMATCH' | 'OUT_OF_ORDER' | 'DUPLICATE_ANSWER' | 'INVALID_VALUE';
export type WriteGuardResult = { ok: true } | { ok: false; code: WriteGuardCode };

export interface ResponseRowSnapshot {
  id: string;
  status: string;
  structureVersion: number;
  lastQuestionIndex: number;
}

const OPEN_STATUSES = new Set(['EXPOSED', 'IN_PROGRESS']);

/** ANSWERED·SKIPPED 쓰기 가드(§8.2) — 행 존재·상태·구조 버전·문항 키 일치·순서 증가·값 재검증. */
export function guardQuestionEvent(
  row: ResponseRowSnapshot | null,
  survey: Survey | undefined,
  event: { questionKey: string; questionIndex: number; value?: SurveyAnswerValue },
): WriteGuardResult {
  if (!row) return { ok: false, code: 'NO_ROW' };
  if (!OPEN_STATUSES.has(row.status)) return { ok: false, code: 'BAD_STATUS' };
  if (!survey || survey.structureVersion !== row.structureVersion) return { ok: false, code: 'VERSION_MISMATCH' };
  const question = survey.questions[event.questionIndex];
  if (!question || question.key !== event.questionKey) return { ok: false, code: 'KEY_MISMATCH' };
  if (event.questionIndex <= row.lastQuestionIndex) return { ok: false, code: 'OUT_OF_ORDER' };
  if (event.value && !validateSurveyAnswerValue(question, event.value)) return { ok: false, code: 'INVALID_VALUE' };
  return { ok: true };
}

/** COMPLETED 쓰기 가드(§8.2) — 행 존재·상태·구조 버전. */
export function guardCompletedEvent(row: ResponseRowSnapshot | null, survey: Survey | undefined): WriteGuardResult {
  if (!row) return { ok: false, code: 'NO_ROW' };
  if (!OPEN_STATUSES.has(row.status)) return { ok: false, code: 'BAD_STATUS' };
  if (!survey || survey.structureVersion !== row.structureVersion) return { ok: false, code: 'VERSION_MISMATCH' };
  return { ok: true };
}

/** ABANDONED 쓰기 가드(§8.2) — 행 존재·상태. */
export function guardAbandonedEvent(row: ResponseRowSnapshot | null): WriteGuardResult {
  if (!row) return { ok: false, code: 'NO_ROW' };
  if (!OPEN_STATUSES.has(row.status)) return { ok: false, code: 'BAD_STATUS' };
  return { ok: true };
}
