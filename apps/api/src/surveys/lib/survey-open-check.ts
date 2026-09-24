import type { SurveyQuestion } from '@chat-bot/shared-types';

export interface SurveyOpenCheckInput {
  questions: readonly SurveyQuestion[];
  activeTo?: Date;
}

export interface SurveyOpenCheckDetail {
  field: string;
  message: string;
}

/** 오픈 검증(FR-SV2-5) — 문항 ≥ 1 · 선택지 ≥ 2(스키마가 이미 강제하나 방어적으로 재확인) · 기간 미종료. */
export function checkSurveyOpenable(input: SurveyOpenCheckInput, now: Date): SurveyOpenCheckDetail[] {
  const details: SurveyOpenCheckDetail[] = [];
  if (input.questions.length === 0) {
    details.push({ field: 'questions', message: '문항을 1개 이상 등록해야 진행 중 상태로 바꿀 수 있습니다.' });
  }
  input.questions.forEach((q, i) => {
    if ((q.type === 'SINGLE_CHOICE' || q.type === 'MULTI_CHOICE') && q.choices.length < 2) {
      details.push({ field: `questions[${i}].choices`, message: '선택지를 2개 이상 등록해야 합니다.' });
    }
  });
  if (input.activeTo && input.activeTo.getTime() <= now.getTime()) {
    details.push({ field: 'activeTo', message: '종료 시각이 이미 지났습니다. 기간을 다시 설정해 주세요.' });
  }
  return details;
}
