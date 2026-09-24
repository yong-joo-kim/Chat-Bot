import type { DialogueBundle, SurveyEvent, SurveyStepView, TraceStep } from '@chat-bot/shared-types';

const OUTCOME_BY_CODE: Partial<Record<string, SurveyStepView['outcomes'][number]>> = {
  SURVEY_STARTED: 'STARTED',
  SURVEY_ANSWERED: 'ANSWERED',
  SURVEY_RETRY: 'RETRY',
  SURVEY_SKIPPED_QUESTION: 'SKIPPED_QUESTION',
  SURVEY_COMPLETED: 'COMPLETED',
  SURVEY_ABANDONED: 'ABANDONED',
  SURVEY_SKIPPED: 'NOT_STARTED',
};

/**
 * 시뮬레이터 결과 패널의 설문 진행 요약(FR-SV9-3, 순수 함수) — trace + `surveyEvents`에서 설문 id·
 * 순번·결과 목록·사유를 만든다. **판정 값을 싣지 않는다**(원문 재노출 경로를 만들지 않는다).
 */
export function buildSurveyStepView(
  trace: readonly TraceStep[],
  events: readonly SurveyEvent[] | undefined,
  bundle: DialogueBundle,
  preview: boolean,
): SurveyStepView | undefined {
  const surveySteps = trace.filter((t) => t.stage === 'SURVEY');
  if (surveySteps.length === 0) return undefined;

  const surveyId = events?.[0]?.attempt.surveyId ?? surveySteps.find((s) => s.targetId)?.targetId;
  if (!surveyId) return undefined;
  const survey = bundle.surveys?.find((s) => s.id === surveyId);

  const outcomes = [...new Set(surveySteps.map((s) => OUTCOME_BY_CODE[s.code]).filter((v): v is NonNullable<typeof v> => !!v))];
  const reasonStep = surveySteps.find((s) => s.code === 'SURVEY_SKIPPED' || s.code === 'SURVEY_ABANDONED' || s.code === 'SURVEY_RETRY');

  const lastEvent = events?.[events.length - 1];
  const questionIndex = lastEvent && 'questionIndex' in lastEvent ? lastEvent.questionIndex : undefined;

  return {
    surveyId,
    surveyName: survey?.name ?? '',
    questionIndex,
    questionCount: survey?.questions.length ?? 0,
    outcomes,
    reason: reasonStep?.message,
    preview,
    saved: false,
  };
}
