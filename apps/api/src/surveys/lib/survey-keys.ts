import { randomUUID } from 'crypto';
import type { SurveyQuestion, SurveyQuestionInput } from '@chat-bot/shared-types';

/**
 * 신규 문항/선택지 키 발급(FR-SV2-3) — 입력에 `key`가 없으면 새로 발급하고, 있으면 그대로 쓴다
 * (기존 key 보존이 "구조 불변" 판정의 근거 — 누락하면 구조 변경으로 판정된다).
 */
export function assignQuestionKeys(inputs: readonly SurveyQuestionInput[]): SurveyQuestion[] {
  return inputs.map((q) => {
    const key = q.key ?? randomUUID();
    if (q.type === 'SINGLE_CHOICE' || q.type === 'MULTI_CHOICE') {
      const choices = q.choices.map((c) => ({ key: c.key ?? randomUUID(), label: c.label }));
      return { ...q, key, choices } as SurveyQuestion;
    }
    return { ...q, key } as SurveyQuestion;
  });
}

/** 복제 시 문항·선택지 key를 전부 재발급한다(FR-SV2-6 — 새 설문은 과거 응답과 무관하다). */
export function reissueQuestionKeys(questions: readonly SurveyQuestion[]): SurveyQuestion[] {
  return questions.map((q) => {
    const key = randomUUID();
    if (q.type === 'SINGLE_CHOICE' || q.type === 'MULTI_CHOICE') {
      const choices = q.choices.map((c) => ({ key: randomUUID(), label: c.label }));
      return { ...q, key, choices } as SurveyQuestion;
    }
    return { ...q, key } as SurveyQuestion;
  });
}
