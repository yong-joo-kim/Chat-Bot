import {
  CONVERSATION_STATE_VERSION,
  type ButtonAction,
  type ConversationState,
  type DialogueBundle,
  type DialogueResolution,
  type StateDiscardReason,
  type SurveyEvent,
  type TraceStep,
} from '@chat-bot/shared-types';
import { resolveResponse } from './resolver';
import type { EngineResolution, ResolveOptions } from './resolver';
import { resolveByNodeId } from './resolver';
import { sanitizeConversationState } from './conversation-state';
import { resumeAfterApiCall } from './api-call';
import type { ApiCallSuspension, ApiStepResult } from './api-call';
import type { WorkflowEmission } from './workflow-output';

export interface DialogueTurnInput {
  message?: string;
  buttonAction?: ButtonAction;
}

export interface DialogueTurnResult extends DialogueResolution {
  /** 다음 요청에 그대로 실어 보낼 봉투. 항상 non-null이다(빈 대화도 version만 담긴 봉투). */
  nextState: ConversationState;
  /** 수신 봉투에서 폐기된 항목의 사유. 관리자 API만 노출한다(NFR-S1). */
  stateDiscarded: StateDiscardReason[];
  /**
   * [No.26] 정지했을 때만. 이때 `outputs`/`nextState`/`trace`는 "호출 실패(`NOT_EXECUTED`)" 가정의
   * 폴백 결과다(FR-L4-9) — `apiCall`을 처리하지 않는 소비자도 빈 응답을 받지 않는다.
   */
  apiCall?: ApiCallSuspension;
  /** [No.26] `resumeAfterApiCall` 결과에만 채워진다. */
  apiStep?: ApiStepResult;
  /** [No.27] 이번 턴에 설문 세션이 관여했을 때만(이벤트 발생 또는 입력 소비). 없으면 키 생략(FR-0-107). */
  surveyEvents?: SurveyEvent[];
  /** [No.27] 이번 턴 입력을 설문 세션이 소비했는가 — `ConversationLog.surveyTurn`·RAG 판정 근거. */
  surveyTurn?: boolean;
  /** [No.41] 이번 턴에 `WORKFLOW` 아웃풋이 실행됐을 때만. 없으면 키 생략(surveyEvents 규약).
   * 사용자 출력·trace 값·위젯 응답에 싣지 않는다. */
  workflowEvents?: WorkflowEmission[];
}

/**
 * 텍스트 입력과 NODE 버튼 액션을 분기해 `resolveResponse`/`resolveByNodeId`로 라우팅하는
 * 유일한 상태 인식 진입점(DD-26, ADR-0010). API의 3개 소비자(시뮬레이션/비교/공개 대화)는
 * 전부 이 함수만 호출한다 — 엔진 단일 경로 원칙(FR-0-19).
 * `state`는 검증 전 원본을 그대로 받는다 — 항상 내부에서 `sanitizeConversationState`를 수행하므로
 * 호출부가 검증을 빠뜨릴 수 없다(NFR-S5를 구조로 보장).
 * [No.26] `resolution.apiCall`이 있으면 "호출 실패(`NOT_EXECUTED`)" 가정의 폴백 결과를 본체로 동봉해
 * 반환한다(§5.7, FR-L4-9) — 실제 호출은 `apps/api`의 `LegacyApiService.completeTurn()`이
 * 이 함수의 반환값을 받아 `resumeAfterApiCall()`을 다시 호출해 완결한다.
 */
export function resolveTurn(
  turn: DialogueTurnInput,
  state: unknown,
  bundle: DialogueBundle,
  now: Date,
  options: ResolveOptions = {},
): DialogueTurnResult {
  const sanitized = sanitizeConversationState(state, bundle, now, {
    stateMaxAgeMs: options.stateMaxAgeMs,
    clarifyTtlMs: options.clarifyTtlMs,
  });

  // [No.27] sanitize 결과로 채운 설문 진행 문맥(@internal) — S0가 읽는다.
  const surveyState = {
    session: sanitized.surveySession,
    completedSurveyIds: sanitized.completedSurveyIds,
    preview: options.surveyPreview ?? false,
  };

  let resolution: EngineResolution;

  if (turn.buttonAction && turn.buttonAction.kind === 'NODE') {
    resolution = resolveByNodeId(turn.buttonAction.nodeId, sanitized.contextSession, bundle, now, {
      ...options,
      inputLabel: turn.buttonAction.label ?? '',
      surveyState,
    });
  } else {
    const message = turn.buttonAction && turn.buttonAction.kind === 'MESSAGE' ? turn.buttonAction.text : (turn.message ?? '');
    resolution = resolveResponse(message, sanitized.contextSession, bundle, now, {
      ...options,
      pendingClarify: sanitized.pendingClarify,
      surveyState,
    });
  }

  const stateTrace: TraceStep[] = sanitized.discarded.map((reason) => ({
    stage: 'PREPROCESS',
    code: 'STATE_DISCARDED',
    message: reason,
  }));

  if (resolution.apiCall) {
    const suspension = resolution.apiCall;
    const mergedTrace = stateTrace.length > 0 ? [...stateTrace, ...suspension.resumeState.trace] : suspension.resumeState.trace;
    const mergedSuspension: ApiCallSuspension = { ...suspension, resumeState: { ...suspension.resumeState, trace: mergedTrace } };

    // `resumeAfterApiCall`은 `turn.apiCall`·`turn.stateDiscarded`만 읽는다 — 나머지 필드는
    // 재계산되므로 자리표시자로 채운 뒤 타입만 맞춘다(부트스트랩, §5.7).
    const stub = {
      input: resolution.input,
      normalizedInput: resolution.normalizedInput,
      outputs: [],
      nextSession: null,
      unsupportedOutputs: [],
      trace: [],
      nextState: { version: CONVERSATION_STATE_VERSION, contextSession: null, pendingClarify: null },
      stateDiscarded: sanitized.discarded,
      apiCall: mergedSuspension,
    } as DialogueTurnResult & { apiCall: ApiCallSuspension };

    const polyfilled = resumeAfterApiCall(stub, { kind: 'NOT_EXECUTED' }, bundle, now, options);
    return { ...polyfilled, apiCall: mergedSuspension };
  }

  const trace = stateTrace.length > 0 ? [...stateTrace, ...resolution.trace] : resolution.trace;

  // [No.27] §5.4 — 설문 필드 키 생략 규칙. 설문이 관여하지 않은 턴(빈 입력 등)은 sanitize된 값을 그대로 이월한다.
  const s = resolution.survey;
  const nextSurveySession = s ? s.nextSession : sanitized.surveySession;
  const nextCompletedSurveyIds = s ? s.completedSurveyIds : sanitized.completedSurveyIds;

  const nextState: ConversationState = {
    version: CONVERSATION_STATE_VERSION,
    contextSession: resolution.nextSession ?? null,
    pendingClarify: resolution.pendingClarify ?? null,
    ...(nextSurveySession ? { surveySession: nextSurveySession } : {}),
    ...(nextCompletedSurveyIds.length > 0 ? { completedSurveyIds: nextCompletedSurveyIds } : {}),
  };

  // `resolution.survey`는 @internal이라 결과에 싣지 않는다(구조 분해로 제거).
  const { survey: _survey, ...resolutionWithoutSurvey } = resolution;

  return {
    ...resolutionWithoutSurvey,
    trace,
    nextState,
    stateDiscarded: sanitized.discarded,
    ...(s && (s.events.length > 0 || s.consumedInput) ? { surveyEvents: s.events, surveyTurn: s.consumedInput } : {}),
  };
}
