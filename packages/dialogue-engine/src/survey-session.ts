import {
  ConversationStateSchema,
  buildSurveyQuestionOutputs,
  isSurveyLive,
  judgeSurveyAnswer,
  retryGuidance,
  SURVEY_SKIP_BUTTON_VALUE,
  SURVEY_STOP_BUTTON_VALUE,
} from '@chat-bot/shared-types';
import type { DialogOutput, DialogueBundle, Survey, SurveyAttemptRef, SurveyEvent, SurveySessionState, TraceStep } from '@chat-bot/shared-types';
import { normalizeText } from './normalize';
import {
  SKIP_TOKENS,
  SURVEY_CANCEL_MESSAGE,
  SURVEY_CHANGED_NOTICE,
  SURVEY_MAX_RETRY,
  SURVEY_REQUIRED_PROMPT,
  SURVEY_RETRY_LIMIT_MESSAGE,
  SURVEY_TIMEOUT_NOTICE,
} from './constants';

function textOutput(text: string): DialogOutput {
  return { type: 'TEXT', payload: { text } };
}

/** `resolveTurn`이 sanitize 결과로 채워 `ResolveOptions.surveyState`로 넘긴다(@internal). */
export interface SurveyTurnContext {
  session: SurveySessionState | null;
  completedSurveyIds: readonly string[];
  preview: boolean;
}

/** `EngineResolution.survey`(@internal) — `resolveTurn`이 `DialogueTurnResult`로 풀어 쓴다. */
export interface SurveyTurnOutcome {
  nextSession: SurveySessionState | null;
  completedSurveyIds: string[];
  events: SurveyEvent[];
  /** → `surveyTurn`. */
  consumedInput: boolean;
}

/** 설문 세션 시작(§5.2 ③) — intro + 첫 문항 출력, `EXPOSED` 이벤트. */
export function startSurveySession(
  survey: Survey,
  nodeId: string | null,
  outputIndex: number,
  now: Date,
): { session: SurveySessionState; outputs: DialogOutput[]; event: SurveyEvent } {
  const session: SurveySessionState = {
    surveyId: survey.id,
    structureVersion: survey.structureVersion,
    nodeId,
    outputIndex,
    questionIndex: 0,
    retryCount: 0,
    startedAt: now,
    lastInteractedAt: now,
  };
  const outputs = buildSurveyQuestionOutputs(survey, 0, { withIntro: true });
  const event: SurveyEvent = {
    kind: 'EXPOSED',
    attempt: { surveyId: survey.id, structureVersion: survey.structureVersion, startedAt: now },
    nodeId,
  };
  return { session, outputs, event };
}

export type SurveyAdvance =
  | { kind: 'CONSUMED'; outputs: DialogOutput[]; nextSession: SurveySessionState | null; events: SurveyEvent[]; completed: boolean; trace: TraceStep[] }
  | { kind: 'RELEASED'; carry: DialogOutput[]; events: SurveyEvent[]; trace: TraceStep[] };

function attemptOf(session: SurveySessionState): SurveyAttemptRef {
  return { surveyId: session.surveyId, structureVersion: session.structureVersion, startedAt: session.startedAt };
}

/**
 * 설문 세션 상태 전이(§5.3 S0, 순수 함수). 우선순위: 취소어 → 계속 가능(구조/상태/기간) →
 * 타임아웃 → 건너뛰기 → 판정(재시도) → 다음 문항/완료. `context-session.ts`의 형제 파일이며
 * 예외를 던지지 않는다.
 */
export function advanceSurveySession(
  session: SurveySessionState,
  input: { raw: string; norm: string },
  survey: Survey,
  now: Date,
  preview: boolean,
): SurveyAdvance {
  const attempt = attemptOf(session);
  const trace: TraceStep[] = [];

  // ① 취소 — 정규화 전체 일치(containsWord 아님, §22 D-3).
  const cancelWords = survey.cancelKeywords.map((w) => normalizeText(w));
  const isCancel = input.norm !== '' && (cancelWords.includes(input.norm) || input.norm === normalizeText(SURVEY_STOP_BUTTON_VALUE));
  if (isCancel) {
    trace.push({ stage: 'SURVEY', code: 'SURVEY_ABANDONED', targetId: survey.id, message: 'CANCELLED' });
    return {
      kind: 'CONSUMED',
      outputs: [textOutput(SURVEY_CANCEL_MESSAGE)],
      nextSession: null,
      events: [{ kind: 'ABANDONED', attempt, reason: 'CANCELLED' }],
      completed: false,
      trace,
    };
  }

  // ② 계속 불가(구조 버전·상태·기간)
  const live = isSurveyLive(survey, session, now, preview);
  if (!live.live) {
    trace.push({ stage: 'SURVEY', code: 'SURVEY_ABANDONED', targetId: survey.id, message: live.reason });
    return {
      kind: 'RELEASED',
      carry: [textOutput(SURVEY_CHANGED_NOTICE)],
      events: [{ kind: 'ABANDONED', attempt, reason: live.reason === 'CLOSED' ? 'CLOSED' : 'DEFINITION_CHANGED' }],
      trace,
    };
  }

  // ③ 타임아웃
  const elapsedMinutes = (now.getTime() - session.lastInteractedAt.getTime()) / 60000;
  if (elapsedMinutes > survey.sessionTimeoutMinutes) {
    trace.push({ stage: 'SURVEY', code: 'SURVEY_ABANDONED', targetId: survey.id, message: 'TIMEOUT' });
    return {
      kind: 'RELEASED',
      carry: [textOutput(SURVEY_TIMEOUT_NOTICE)],
      events: [{ kind: 'ABANDONED', attempt, reason: 'TIMEOUT' }],
      trace,
    };
  }

  const question = survey.questions[session.questionIndex];
  if (!question) {
    // 방어적 — sanitize가 범위를 보장하지만 구조가 바뀐 경우를 대비한다.
    return completeSurvey(session, survey, now, attempt, trace);
  }

  // ④ 건너뛰기(선택 문항만) — 버튼 값 포함(엔진 상수 SKIP_TOKENS).
  const isSkipToken = SKIP_TOKENS.includes(input.norm) || input.norm === normalizeText(SURVEY_SKIP_BUTTON_VALUE);
  if (isSkipToken) {
    if (!question.required) {
      trace.push({ stage: 'SURVEY', code: 'SURVEY_SKIPPED_QUESTION', targetId: question.key, message: String(session.questionIndex) });
      const event: SurveyEvent = { kind: 'SKIPPED', attempt, questionKey: question.key, questionIndex: session.questionIndex };
      return advanceToNextOrComplete(session, survey, now, [event], trace);
    }
    trace.push({ stage: 'SURVEY', code: 'SURVEY_RETRY', targetId: question.key, message: 'REQUIRED' });
    const nextRetry = session.retryCount + 1;
    if (nextRetry > SURVEY_MAX_RETRY) {
      return {
        kind: 'CONSUMED',
        outputs: [textOutput(SURVEY_RETRY_LIMIT_MESSAGE)],
        nextSession: null,
        events: [{ kind: 'ABANDONED', attempt, reason: 'RETRY_EXCEEDED' }],
        completed: false,
        trace,
      };
    }
    return {
      kind: 'CONSUMED',
      outputs: [textOutput(SURVEY_REQUIRED_PROMPT), ...buildSurveyQuestionOutputs(survey, session.questionIndex)],
      nextSession: { ...session, retryCount: nextRetry, lastInteractedAt: now },
      events: [],
      completed: false,
      trace,
    };
  }

  // ⑤ 판정
  const judged = judgeSurveyAnswer(question, input.raw);
  if (judged.ok) {
    trace.push({ stage: 'SURVEY', code: 'SURVEY_ANSWERED', targetId: question.key, message: String(session.questionIndex) });
    const event: SurveyEvent = {
      kind: 'ANSWERED',
      attempt,
      questionKey: question.key,
      questionIndex: session.questionIndex,
      value: judged.value,
    };
    return advanceToNextOrComplete(session, survey, now, [event], trace);
  }

  trace.push({ stage: 'SURVEY', code: 'SURVEY_RETRY', targetId: question.key, message: judged.code });
  const nextRetry = session.retryCount + 1;
  if (nextRetry > SURVEY_MAX_RETRY) {
    return {
      kind: 'CONSUMED',
      outputs: [textOutput(SURVEY_RETRY_LIMIT_MESSAGE)],
      nextSession: null,
      events: [{ kind: 'ABANDONED', attempt, reason: 'RETRY_EXCEEDED' }],
      completed: false,
      trace,
    };
  }
  return {
    kind: 'CONSUMED',
    outputs: [textOutput(retryGuidance(question, judged.code)), ...buildSurveyQuestionOutputs(survey, session.questionIndex)],
    nextSession: { ...session, retryCount: nextRetry, lastInteractedAt: now },
    events: [],
    completed: false,
    trace,
  };
}

function advanceToNextOrComplete(
  session: SurveySessionState,
  survey: Survey,
  now: Date,
  events: SurveyEvent[],
  trace: TraceStep[],
): SurveyAdvance {
  const nextIndex = session.questionIndex + 1;
  if (nextIndex >= survey.questions.length) {
    const attempt = attemptOf(session);
    const completedResult = completeSurvey(session, survey, now, attempt, trace);
    if (completedResult.kind === 'CONSUMED') {
      return { ...completedResult, events: [...events, ...completedResult.events] };
    }
    return completedResult;
  }
  return {
    kind: 'CONSUMED',
    outputs: buildSurveyQuestionOutputs(survey, nextIndex),
    nextSession: { ...session, questionIndex: nextIndex, retryCount: 0, lastInteractedAt: now },
    events,
    completed: false,
    trace,
  };
}

function completeSurvey(
  session: SurveySessionState,
  survey: Survey,
  now: Date,
  attempt: { surveyId: string; structureVersion: number; startedAt: Date },
  trace: TraceStep[],
): SurveyAdvance {
  trace.push({ stage: 'SURVEY', code: 'SURVEY_COMPLETED', targetId: survey.id });
  return {
    kind: 'CONSUMED',
    outputs: [textOutput(survey.completionMessage)],
    nextSession: null,
    events: [{ kind: 'COMPLETED', attempt }],
    completed: true,
    trace,
  };
}

/**
 * API 계층의 의미 점수 생략 판단용(§7.1 ③.5, §22 D-14) — sanitize 후 "이번 입력을 설문이 소비할
 * 것인가"의 근사치다(입력 원문을 받지 않는다). 세션이 있고 계속 가능(live)하면 true — 취소·건너뛰기·
 * 판정 모두 CONSUMED 경로다. 타임아웃·마감·구조 변경으로 RELEASED되는 턴은 false다.
 */
export function willSurveyConsumeInput(rawState: unknown, bundle: DialogueBundle, now: Date, preview = false): boolean {
  const parsed = ConversationStateSchema.safeParse(rawState);
  if (!parsed.success) return false;
  const session = parsed.data.surveySession;
  if (!session) return false;
  const survey = (bundle.surveys ?? []).find((s) => s.id === session.surveyId);
  if (!survey) return false;
  const elapsedMinutes = (now.getTime() - session.lastInteractedAt.getTime()) / 60000;
  if (elapsedMinutes > survey.sessionTimeoutMinutes) return false;
  return isSurveyLive(survey, session, now, preview).live;
}
