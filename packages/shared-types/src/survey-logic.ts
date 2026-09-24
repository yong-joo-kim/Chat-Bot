import { normalizeText } from './common';
import type { DialogOutput } from './dialogue';
import { SURVEY_LIMITS } from './survey';
import type { Survey, SurveyQuestion, SurveyScaleKind, SurveySkipReason } from './survey';

/**
 * 설문 응답 판정·출력 순수 함수(No.27). 엔진(`survey-session.ts`)·웹 편집기 미리보기·API 쓰기
 * 가드가 같은 1벌을 쓴다(`api-mapping.ts` 배치 선례). 위젯은 이 파일을 import하지 않는다.
 * `docs/02-spec/survey-management-설계.md` §4.4 근거.
 */

export type SurveyAnswerValue =
  | { type: 'CHOICE'; choiceKeys: string[] }
  | { type: 'SCALE'; value: number }
  | { type: 'TEXT'; text: string };

export type SurveyRetryCode = 'NOT_A_CHOICE' | 'TOO_FEW' | 'TOO_MANY' | 'OUT_OF_RANGE' | 'NOT_A_NUMBER' | 'EMPTY' | 'TOO_LONG';

export type SurveyJudgeResult = { ok: true; value: SurveyAnswerValue } | { ok: false; code: SurveyRetryCode };

export const SURVEY_SKIP_BUTTON_VALUE = '건너뛰기';
export const SURVEY_STOP_BUTTON_VALUE = '그만하기';

function stripControlChars(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
}

/** 선택지 라벨 정규화 전체 일치 또는 번호(`^(\d{1,2})\s*(번)?\.?$`) 판정. */
function matchSingleChoice(question: Extract<SurveyQuestion, { type: 'SINGLE_CHOICE' }>, raw: string): SurveyJudgeResult {
  const norm = normalizeText(raw);
  const byLabel = question.choices.find((c) => normalizeText(c.label) === norm);
  if (byLabel) return { ok: true, value: { type: 'CHOICE', choiceKeys: [byLabel.key] } };
  const numMatch = /^(\d{1,2})\s*(번)?\.?$/.exec(raw.trim());
  if (numMatch) {
    const idx = Number(numMatch[1]) - 1;
    const choice = question.choices[idx];
    if (choice) return { ok: true, value: { type: 'CHOICE', choiceKeys: [choice.key] } };
  }
  return { ok: false, code: 'NOT_A_CHOICE' };
}

function resolveToken(question: { choices: { key: string; label: string }[] }, token: string): string | undefined {
  const norm = normalizeText(token);
  const byLabel = question.choices.find((c) => normalizeText(c.label) === norm);
  if (byLabel) return byLabel.key;
  const numMatch = /^(\d{1,2})\s*(번)?\.?$/.exec(token.trim());
  if (numMatch) {
    const idx = Number(numMatch[1]) - 1;
    return question.choices[idx]?.key;
  }
  return undefined;
}

function matchMultiChoice(question: Extract<SurveyQuestion, { type: 'MULTI_CHOICE' }>, raw: string): SurveyJudgeResult {
  const trimmed = raw.trim();
  const wholeLabel = question.choices.find((c) => normalizeText(c.label) === normalizeText(trimmed));
  let tokens: string[];
  if (wholeLabel) {
    tokens = [trimmed];
  } else {
    let parts = trimmed.split(/[,，、·]/).map((t) => t.trim()).filter((t) => t.length > 0);
    if (parts.length === 1 && /^\d+(\s+\d+)+$/.test(trimmed)) {
      parts = trimmed.split(/\s+/);
    }
    tokens = parts;
  }
  if (tokens.length === 0) return { ok: false, code: 'NOT_A_CHOICE' };

  const keys: string[] = [];
  for (const token of tokens) {
    const key = resolveToken(question, token);
    if (!key) return { ok: false, code: 'NOT_A_CHOICE' };
    keys.push(key);
  }
  const unique = [...new Set(keys)].sort((a, b) => {
    const ia = question.choices.findIndex((c) => c.key === a);
    const ib = question.choices.findIndex((c) => c.key === b);
    return ia - ib;
  });
  if (unique.length < question.minSelect) return { ok: false, code: 'TOO_FEW' };
  if (unique.length > question.maxSelect) return { ok: false, code: 'TOO_MANY' };
  return { ok: true, value: { type: 'CHOICE', choiceKeys: unique } };
}

const SCALE_RANGE: Record<SurveyScaleKind, { min: number; max: number }> = {
  STAR_5: { min: 1, max: 5 },
  NPS_11: { min: 0, max: 10 },
};

function matchScale(question: Extract<SurveyQuestion, { type: 'SCALE' }>, raw: string): SurveyJudgeResult {
  const m = /^★?\s*(-?\d{1,2})\s*(점)?/.exec(raw.trim());
  if (!m) return { ok: false, code: 'NOT_A_NUMBER' };
  const value = Number(m[1]);
  const range = SCALE_RANGE[question.scale];
  if (value < range.min || value > range.max) return { ok: false, code: 'OUT_OF_RANGE' };
  return { ok: true, value: { type: 'SCALE', value } };
}

function matchText(question: Extract<SurveyQuestion, { type: 'TEXT' }>, raw: string): SurveyJudgeResult {
  const cleaned = stripControlChars(raw).trim();
  if (cleaned.length === 0) return { ok: false, code: 'EMPTY' };
  if (Array.from(cleaned).length > question.maxLength) return { ok: false, code: 'TOO_LONG' };
  return { ok: true, value: { type: 'TEXT', text: cleaned } };
}

/** 건너뛰기·취소는 판정하지 않는다(엔진 전이 단계의 책임 — 토큰이 엔진 상수). */
export function judgeSurveyAnswer(question: SurveyQuestion, raw: string): SurveyJudgeResult {
  switch (question.type) {
    case 'SINGLE_CHOICE':
      return matchSingleChoice(question, raw);
    case 'MULTI_CHOICE':
      return matchMultiChoice(question, raw);
    case 'SCALE':
      return matchScale(question, raw);
    case 'TEXT':
      return matchText(question, raw);
  }
}

/** 서버 재검증(§8.3) — 적재 직전 값을 다시 검증한다(위조 봉투·경합 대비). */
export function validateSurveyAnswerValue(question: SurveyQuestion, value: SurveyAnswerValue): boolean {
  if (question.type === 'SINGLE_CHOICE') {
    if (value.type !== 'CHOICE' || value.choiceKeys.length !== 1) return false;
    return question.choices.some((c) => c.key === value.choiceKeys[0]);
  }
  if (question.type === 'MULTI_CHOICE') {
    if (value.type !== 'CHOICE') return false;
    const unique = new Set(value.choiceKeys);
    if (unique.size !== value.choiceKeys.length) return false;
    if (unique.size < question.minSelect || unique.size > question.maxSelect) return false;
    const keySet = new Set(question.choices.map((c) => c.key));
    return value.choiceKeys.every((k) => keySet.has(k));
  }
  if (question.type === 'SCALE') {
    if (value.type !== 'SCALE' || !Number.isInteger(value.value)) return false;
    const range = SCALE_RANGE[question.scale];
    return value.value >= range.min && value.value <= range.max;
  }
  // TEXT
  if (value.type !== 'TEXT') return false;
  const len = Array.from(value.text).length;
  return len >= 1 && len <= question.maxLength;
}

const RETRY_MESSAGES: Record<SurveyRetryCode, string> = {
  NOT_A_CHOICE: '제시된 선택지 중에서 골라 답해 주세요.',
  TOO_FEW: '더 선택해 주세요.',
  TOO_MANY: '너무 많이 선택했어요. 개수를 줄여 다시 답해 주세요.',
  OUT_OF_RANGE: '제시된 범위 안의 숫자로 답해 주세요.',
  NOT_A_NUMBER: '숫자로 답해 주세요.',
  EMPTY: '내용을 입력해 주세요.',
  TOO_LONG: '입력하신 내용이 너무 길어요. 조금 줄여서 다시 입력해 주세요.',
};

export function retryGuidance(_question: SurveyQuestion, code: SurveyRetryCode): string {
  return RETRY_MESSAGES[code];
}

function truncateCodePoints(s: string, max: number): string {
  const chars = Array.from(s);
  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : s;
}

function textOutput(text: string): DialogOutput {
  return { type: 'TEXT', payload: { text } };
}

function buttonOutput(buttons: { label: string; action: 'MESSAGE'; value: string }[]): DialogOutput {
  return { type: 'BUTTON', payload: { buttons } };
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** 문항 출력(§5.11) — TEXT 1개 + BUTTON 최대 3블록(5개 단위). 위젯 변경 0(기존 TEXT·BUTTON만 사용). */
export function buildSurveyQuestionOutputs(survey: Survey, index: number, opts?: { withIntro?: boolean }): DialogOutput[] {
  const question = survey.questions[index];
  const outputs: DialogOutput[] = [];
  if (opts?.withIntro && survey.introMessage) outputs.push(textOutput(survey.introMessage));

  const n = index + 1;
  const total = survey.questions.length;
  let guide = '';
  if (question.type === 'MULTI_CHOICE') guide = '\n여러 개면 번호를 쉼표로 입력해 주세요 (예: 1,3)';
  if (question.type === 'SCALE') {
    const low = question.lowLabel ? ` ${question.lowLabel}` : '';
    const high = question.highLabel ? ` ~ ${question.highLabel}` : '';
    guide = `\n(${SCALE_RANGE[question.scale].min}${low} ~ ${SCALE_RANGE[question.scale].max}${high})`;
  }
  outputs.push(textOutput(`${n}/${total} ${question.prompt}${guide}`));

  const buttonValues: { label: string; value: string }[] = [];
  if (question.type === 'SINGLE_CHOICE' || question.type === 'MULTI_CHOICE') {
    question.choices.forEach((c, i) => {
      const label = question.type === 'MULTI_CHOICE' ? truncateCodePoints(`${i + 1}. ${c.label}`, 40) : truncateCodePoints(c.label, 40);
      buttonValues.push({ label, value: c.label });
    });
  } else if (question.type === 'SCALE') {
    const range = SCALE_RANGE[question.scale];
    for (let v = range.min; v <= range.max; v++) {
      const suffix = v === range.min && question.lowLabel ? ` ${question.lowLabel}` : v === range.max && question.highLabel ? ` ${question.highLabel}` : '';
      buttonValues.push({ label: truncateCodePoints(`${v}점${suffix}`, 40), value: question.scale === 'STAR_5' ? `${v}점` : `${v}` });
    }
  }
  if (!question.required) buttonValues.push({ label: SURVEY_SKIP_BUTTON_VALUE, value: SURVEY_SKIP_BUTTON_VALUE });
  buttonValues.push({ label: SURVEY_STOP_BUTTON_VALUE, value: SURVEY_STOP_BUTTON_VALUE });

  if (buttonValues.length > 0) {
    const blocks = chunk(buttonValues, SURVEY_LIMITS.buttonsPerBlock).slice(0, SURVEY_LIMITS.buttonBlocksMax);
    for (const block of blocks) {
      outputs.push(buttonOutput(block.map((b) => ({ label: b.label, action: 'MESSAGE' as const, value: b.value }))));
    }
  }
  return outputs;
}

/** 참여 가능 판정(FR-SV4-1) — 판정 순서 = ①②⑤③④. */
export function evaluateSurveyAvailability(
  survey: Survey | undefined,
  now: Date,
  completedIds: readonly string[],
  preview: boolean,
): { ok: true } | { ok: false; reason: SurveySkipReason } {
  if (!survey) return { ok: false, reason: 'NOT_FOUND' };
  if (survey.questions.length === 0) return { ok: false, reason: 'EMPTY' };
  if (completedIds.includes(survey.id)) return { ok: false, reason: 'ALREADY_RESPONDED' };
  if (!preview && survey.status !== 'OPEN') return { ok: false, reason: 'NOT_OPEN' };
  if (!preview) {
    if (survey.activeFrom && now.getTime() < survey.activeFrom.getTime()) return { ok: false, reason: 'OUT_OF_PERIOD' };
    if (survey.activeTo && now.getTime() >= survey.activeTo.getTime()) return { ok: false, reason: 'OUT_OF_PERIOD' };
  }
  return { ok: true };
}

/** 진행 중 세션의 계속 가능 판정(§5.3 S0 ②) — 구조 버전·상태·기간. */
export function isSurveyLive(
  survey: Survey | undefined,
  session: { structureVersion: number },
  now: Date,
  preview: boolean,
): { live: true } | { live: false; reason: 'CLOSED' | 'DEFINITION_CHANGED' } {
  if (!survey) return { live: false, reason: 'DEFINITION_CHANGED' };
  if (survey.structureVersion !== session.structureVersion) return { live: false, reason: 'DEFINITION_CHANGED' };
  if (!preview) {
    if (survey.status !== 'OPEN') return { live: false, reason: 'CLOSED' };
    if (survey.activeTo && now.getTime() >= survey.activeTo.getTime()) return { live: false, reason: 'CLOSED' };
  }
  return { live: true };
}

export function npsOf(dist: readonly { value: number; count: number }[]): number | null {
  const total = dist.reduce((sum, d) => sum + d.count, 0);
  if (total === 0) return null;
  const promoters = dist.filter((d) => d.value >= 9).reduce((sum, d) => sum + d.count, 0);
  const detractors = dist.filter((d) => d.value <= 6).reduce((sum, d) => sum + d.count, 0);
  return Math.round(((promoters - detractors) / total) * 100);
}

export function averageOf(dist: readonly { value: number; count: number }[]): number | null {
  const total = dist.reduce((sum, d) => sum + d.count, 0);
  if (total === 0) return null;
  const sum = dist.reduce((s, d) => s + d.value * d.count, 0);
  return Math.round((sum / total) * 10) / 10;
}
