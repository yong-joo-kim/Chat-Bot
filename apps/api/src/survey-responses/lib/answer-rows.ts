import type { SurveyAnswerValue } from '@chat-bot/shared-types';

export interface AnswerRowInput {
  surveyId: string;
  questionKey: string;
  questionIndex: number;
  kind: 'ANSWERED' | 'SKIPPED';
  choiceKey: string;
  numericValue: number | null;
  textValue: string | null;
  isHead: boolean;
  dayBucket: string;
  channelType: string;
  isDuplicate: boolean;
  answeredAt: Date;
}

interface CommonParams {
  surveyId: string;
  questionKey: string;
  questionIndex: number;
  dayBucket: string;
  channelType: string;
  isDuplicate: boolean;
  answeredAt: Date;
}

/**
 * 응답 값 → 답 행 목록(§8.3, 순수 함수). 선택 유형은 선택지 1개당 1행(대표 행 `isHead` 1개),
 * 척도·자유 텍스트는 1행. 라벨 문자열은 담지 않는다(키만). 자유 텍스트는 **마스킹된 값**을 받는다
 * (마스킹 자체는 이 함수의 책임이 아니다 — 호출부가 `maskPlainText`→`maskPii` 순서로 처리한 뒤 넘긴다).
 */
export function buildAnsweredRows(common: CommonParams, value: SurveyAnswerValue): AnswerRowInput[] {
  const base = { ...common, kind: 'ANSWERED' as const };
  if (value.type === 'CHOICE') {
    return value.choiceKeys.map((choiceKey, i) => ({
      ...base,
      choiceKey,
      numericValue: null,
      textValue: null,
      isHead: i === 0,
    }));
  }
  if (value.type === 'SCALE') {
    return [{ ...base, choiceKey: '', numericValue: value.value, textValue: null, isHead: true }];
  }
  // TEXT — `value.text`는 이미 마스킹된 값이어야 한다(호출부 책임).
  return [{ ...base, choiceKey: '', numericValue: null, textValue: value.text, isHead: true }];
}

export function buildSkippedRow(common: CommonParams): AnswerRowInput {
  return { ...common, kind: 'SKIPPED', choiceKey: '', numericValue: null, textValue: null, isHead: true };
}
