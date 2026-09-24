import type { Survey, SurveyQuestion, SurveyResponseDisplayStatus } from '@chat-bot/shared-types';

/** 응답 번호(FR-SV7-1) — `id` 앞 8자 대문자. `sessionId`는 절대 쓰지 않는다. */
export function toResponseNo(id: string): string {
  return id.slice(0, 8).toUpperCase();
}

/** 표시 상태(§9.5) — 무응답 이탈은 조회 시점 판정(IDLE, EX-SV-21). */
export function displayStatusOf(
  row: { status: string; lastInteractedAt: Date },
  now: Date,
  sessionTimeoutMinutes: number,
): SurveyResponseDisplayStatus {
  if (row.status === 'COMPLETED') return 'COMPLETED';
  if (row.status === 'ABANDONED') return 'ABANDONED';
  const elapsedMinutes = (now.getTime() - row.lastInteractedAt.getTime()) / 60000;
  return elapsedMinutes > sessionTimeoutMinutes ? 'IDLE' : 'IN_PROGRESS';
}

export interface AnswerRowForDisplay {
  questionKey: string;
  kind: string;
  choiceKey: string;
  numericValue: number | null;
  textValue: string | null;
  isHead: boolean;
}

/** 문항 답 표시 문자열(§9.5·§10) — 라벨 `; ` 결합 · 점수 · 마스킹 텍스트 · `건너뜀`. */
export function displayAnswer(question: SurveyQuestion | undefined, rows: readonly AnswerRowForDisplay[]): string {
  if (rows.length === 0) return '';
  if (rows[0].kind === 'SKIPPED') return '(건너뜀)';
  if (!question) return '';
  if (question.type === 'SINGLE_CHOICE' || question.type === 'MULTI_CHOICE') {
    const labelByKey = new Map(question.choices.map((c) => [c.key, c.label]));
    return rows.map((r) => labelByKey.get(r.choiceKey) ?? '').filter(Boolean).join('; ');
  }
  if (question.type === 'SCALE') {
    const head = rows.find((r) => r.isHead) ?? rows[0];
    return head.numericValue !== null ? String(head.numericValue) : '';
  }
  const head = rows.find((r) => r.isHead) ?? rows[0];
  return head.textValue ?? '';
}

export function findQuestion(survey: Survey, key: string): SurveyQuestion | undefined {
  return survey.questions.find((q) => q.key === key);
}
