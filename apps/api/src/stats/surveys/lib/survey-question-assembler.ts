import { SURVEY_LIMITS, averageOf, npsOf } from '@chat-bot/shared-types';
import type { Survey, SurveyQuestionStatItem, SurveyQuestionStats } from '@chat-bot/shared-types';

export interface ReachedRow {
  lastQuestionIndex: number;
  count: number;
}
export interface AnswerKindRow {
  questionKey: string;
  kind: string;
  count: number;
}
export interface ChoiceDistRow {
  questionKey: string;
  choiceKey: string;
  count: number;
}
export interface ScaleDistRow {
  questionKey: string;
  numericValue: number;
  count: number;
}

/** 문항별 통계 조립(§9.3, 순수 함수) — 현재 정의 순서·현재 라벨로 표시한다(키 기준 집계). */
export function assembleSurveyQuestionStats(params: {
  survey: Survey;
  exposed: number;
  reachedRows: readonly ReachedRow[];
  answerKindRows: readonly AnswerKindRow[];
  choiceDistRows: readonly ChoiceDistRow[];
  scaleDistRows: readonly ScaleDistRow[];
  from: string;
  to: string;
  generatedAt: Date;
}): SurveyQuestionStats {
  const totalByIndexOrAbove = (idx: number) => params.reachedRows.filter((r) => r.lastQuestionIndex >= idx).reduce((s, r) => s + r.count, 0);

  const questions: SurveyQuestionStatItem[] = params.survey.questions.map((q, index) => {
    const reached = index === 0 ? params.exposed : totalByIndexOrAbove(index - 1);
    const answered = params.answerKindRows.filter((r) => r.questionKey === q.key && r.kind === 'ANSWERED').reduce((s, r) => s + r.count, 0);
    const skipped = params.answerKindRows.filter((r) => r.questionKey === q.key && r.kind === 'SKIPPED').reduce((s, r) => s + r.count, 0);
    const lowSample = answered < SURVEY_LIMITS.lowSampleThreshold;

    if (q.type === 'SINGLE_CHOICE' || q.type === 'MULTI_CHOICE') {
      const distRows = params.choiceDistRows.filter((r) => r.questionKey === q.key);
      const choiceDistribution = q.choices.map((c) => {
        const count = distRows.find((r) => r.choiceKey === c.key)?.count ?? 0;
        return { choiceKey: c.key, label: c.label, count, ratio: answered > 0 ? Math.round((count / answered) * 1000) / 1000 : null };
      });
      return {
        questionKey: q.key,
        prompt: q.prompt,
        type: q.type,
        kind: 'CHOICE' as const,
        reached,
        answered,
        skipped,
        choiceDistribution,
        multiSelectCaption: q.type === 'MULTI_CHOICE',
        lowSample,
      };
    }

    if (q.type === 'SCALE') {
      const distRows = params.scaleDistRows.filter((r) => r.questionKey === q.key);
      const scaleDistribution = distRows.map((r) => ({ value: r.numericValue, count: r.count }));
      const dist = distRows.map((r) => ({ value: r.numericValue, count: r.count }));
      return {
        questionKey: q.key,
        prompt: q.prompt,
        type: q.type,
        kind: 'SCALE' as const,
        reached,
        answered,
        skipped,
        scaleDistribution,
        average: averageOf(dist),
        nps: q.scale === 'NPS_11' ? npsOf(dist) : null,
        lowSample,
      };
    }

    return { questionKey: q.key, prompt: q.prompt, type: q.type, kind: 'TEXT' as const, reached, answered, skipped, lowSample };
  });

  return { surveyId: params.survey.id, period: { from: params.from, to: params.to }, generatedAt: params.generatedAt, questions };
}
