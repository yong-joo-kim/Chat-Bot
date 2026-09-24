import type {
  ApiBinding,
  ApiCallBranch,
  ApiCallOutcome,
  ApiCallResult,
  ApiConditionOutputPayloadV2,
  ContextSessionState,
  ConversationState,
  DialogOutput,
  DialogOutputType,
  DialogueBundle,
  HomonymResolution,
  StateDiscardReason,
  SurveyEvent,
  SurveySessionState,
  TraceStep,
} from '@chat-bot/shared-types';
import { CONVERSATION_STATE_VERSION, buildApiVariables, evaluateApiConditions } from '@chat-bot/shared-types';
import { executeOutputs } from './outputs';
import { API_FAILURE_NOTICE, API_NO_MATCH_NOTICE, HOP_LIMIT } from './constants';
import type { DialogueTurnResult } from './turn';
import type { ResolveOptions } from './resolver';

/**
 * [No.26] 정지점 → 엔진 밖 실행 → 순수 재진입 계약(ADR-0034 결정 1). 엔진 수정 닫힌 목록의 신규 파일.
 * `docs/02-spec/legacy-api-integration-설계.md` §5.1·§5.4 근거.
 */

export interface ApiBoundValue {
  value: string;
  source: 'CONST' | 'SLOT';
}

export interface ApiCallRequestSpec {
  connectionId: string;
  method: 'GET' | 'POST';
  /** 치환 전(로그용). */
  pathTemplate: string;
  /** 자리표시자 순서. */
  pathValues: ApiBoundValue[];
  query: Array<{ name: string; value: ApiBoundValue }>;
  body: Array<{ field: string; value: ApiBoundValue }>;
}

/** 이번 턴에 완료된 폼(§5.3) — `resolver.ts`의 S1 폼 완료 시점 값만 담는다. */
export interface CompletedFormInfo {
  contextVariableId: string;
  values: Record<string, string>;
}

/** 정지 시점의 실행 문맥 — 소비자는 읽지 않는 불투명 재진입 상태. */
export interface ApiResumeState {
  input: string;
  normalizedInput: string;
  matchedNodeId?: string;
  matchedIntentId?: string;
  homonymResolution?: HomonymResolution;
  /** 정지 전까지의 trace(상태 폐기 trace 포함 — `resolveTurn`이 채운다). */
  trace: TraceStep[];
  /** 정지 전 출력 = 폼 완료 문구 + 앞 아웃풋. */
  carry: DialogOutput[];
  unsupported: DialogOutputType[];
  hops: number;
  hopLimit: number;
  /** `execResult.nextSession ?? nextSessionOverride ?? null` 규칙의 값. */
  sessionFallback: ContextSessionState | null;
  existingSession: ContextSessionState | null;
  /** [No.27] 정지 전까지의 설문 이월분(§5.6, 숨은 결함 ②) — 없으면 undefined(설문 관여 0). */
  survey?: {
    completedSurveyIds: readonly string[];
    preview: boolean;
    eventsSoFar: SurveyEvent[];
    consumedInput: boolean;
    sessionFallback: SurveySessionState | null;
  };
}

/** `executeOutputs`가 정지 시 채우는 최소 정보(§5.2) — `resumeState`는 `resolver.ts`가 뒤이어 붙인다. */
export interface ApiSuspensionRequest {
  readonly nodeId: string;
  readonly outputIndex: number;
  readonly payload: ApiConditionOutputPayloadV2;
  /** null = 바인딩 누락 → 호출 금지, `BINDING_MISSING`으로 재진입해야 한다(FR-L4-2). */
  readonly request: ApiCallRequestSpec | null;
}

export interface ApiCallSuspension extends ApiSuspensionRequest {
  /** @internal 재진입 전용 불투명 상태 — 소비자는 읽지 않는다. */
  readonly resumeState: ApiResumeState;
}

export interface ApiStepResult {
  /** `MAPPING_MISSING`은 엔진이 판정한다. */
  outcome: ApiCallOutcome;
  httpStatus?: number;
  branch: ApiCallBranch;
  /** 1부터. */
  conditionIndex?: number;
  /** ★ 원본 값 — 관리자 표시 전 `maskPii` 필수, 공개 응답·로그·trace 금지. */
  variables: Record<string, string>;
}

/** 폴백 동봉본(§5.7) 전용 내부 신호 — `ApiCallOutcome`에 없고 trace message로만 드러난다. */
export type ApiCallResumeInput = ApiCallResult | { kind: 'NOT_EXECUTED' };

function resolveBinding(binding: ApiBinding, completedForm?: CompletedFormInfo): ApiBoundValue | null {
  if (binding.kind === 'CONST') return { value: binding.value, source: 'CONST' };
  if (!completedForm || completedForm.contextVariableId !== binding.contextVariableId) return null;
  const raw = completedForm.values[binding.slotName];
  if (typeof raw !== 'string' || raw.trim().length === 0) return null;
  return { value: raw, source: 'SLOT' };
}

/**
 * 구조적 바인딩 해석(§5.2 `bindRequest`). 하나라도 불충족이면 `null`을 반환한다(FR-L4-2) —
 * 값의 PII 마스킹은 엔진이 하지 않는다(연결 설정은 API 계층 소관).
 */
export function bindRequest(payload: ApiConditionOutputPayloadV2, completedForm?: CompletedFormInfo): ApiCallRequestSpec | null {
  const pathValues: ApiBoundValue[] = [];
  for (const binding of payload.pathParams) {
    const bound = resolveBinding(binding, completedForm);
    if (!bound) return null;
    pathValues.push(bound);
  }
  const query: Array<{ name: string; value: ApiBoundValue }> = [];
  for (const q of payload.query) {
    const bound = resolveBinding(q.value, completedForm);
    if (!bound) return null;
    query.push({ name: q.name, value: bound });
  }
  const body: Array<{ field: string; value: ApiBoundValue }> = [];
  for (const b of payload.body) {
    const bound = resolveBinding(b.value, completedForm);
    if (!bound) return null;
    body.push({ field: b.field, value: bound });
  }
  return { connectionId: payload.connectionId, method: payload.method, pathTemplate: payload.path, pathValues, query, body };
}

function textOutput(text: string): DialogOutput {
  return { type: 'TEXT', payload: { text } };
}

/**
 * 재진입(§5.4) — 순수 함수. `turn.apiCall`(정지 정보)와 실제/목 호출 결과를 받아 매핑·조건 판정·
 * 분기 노드 실행·`{api.*}` 치환을 마친 최종 `DialogueTurnResult`를 반환한다(반환값에 `apiCall` 없음).
 */
export function resumeAfterApiCall(
  turn: DialogueTurnResult & { apiCall: ApiCallSuspension },
  result: ApiCallResumeInput,
  bundle: DialogueBundle,
  now: Date,
  options: ResolveOptions = {},
): DialogueTurnResult {
  const { payload, resumeState } = turn.apiCall;
  const trace: TraceStep[] = [...resumeState.trace];
  const hopLimit = options.hopLimit ?? resumeState.hopLimit ?? HOP_LIMIT;

  let branch: ApiCallBranch = 'FAILURE';
  let outcome: ApiCallOutcome | undefined;
  let httpStatus: number | undefined;
  let conditionIndex: number | undefined;
  let vars: Record<string, string> = {};
  let matchedTargetId: string | undefined;
  const isNotExecuted = result.kind === 'NOT_EXECUTED';

  if (result.kind === 'NOT_EXECUTED') {
    trace.push({ stage: 'API', code: 'API_CALL_FAILED', targetId: payload.connectionId, message: 'NOT_EXECUTED' });
  } else if (result.kind === 'FAILURE') {
    outcome = result.outcome;
    httpStatus = result.httpStatus;
    trace.push({ stage: 'API', code: 'API_CALL_FAILED', targetId: payload.connectionId, message: result.outcome });
  } else {
    httpStatus = result.httpStatus;
    trace.push({ stage: 'API', code: 'API_CALL_SUCCEEDED', targetId: payload.connectionId });
    const mapped = buildApiVariables(result.json, payload.responseMappings);
    if (mapped.missingRequired.length > 0) {
      for (const name of mapped.missingRequired) trace.push({ stage: 'API', code: 'API_MAPPING_MISSING', targetName: name });
      outcome = 'MAPPING_MISSING';
    } else {
      outcome = 'SUCCESS';
      for (const name of mapped.dropped) trace.push({ stage: 'API', code: 'API_VALUE_DROPPED', targetName: name });
      vars = mapped.vars;
      const idx = evaluateApiConditions(result.json, payload.conditions);
      if (idx !== null) {
        branch = 'CONDITION';
        conditionIndex = idx + 1;
        matchedTargetId = payload.conditions[idx].nextNodeId;
        trace.push({ stage: 'API', code: 'API_BRANCH_MATCHED', targetId: matchedTargetId, message: String(idx + 1) });
      } else {
        branch = 'DEFAULT';
        matchedTargetId = payload.defaultNodeId;
        trace.push({ stage: 'API', code: 'API_BRANCH_DEFAULT', targetId: matchedTargetId });
      }
    }
  }

  if (branch !== 'CONDITION' && branch !== 'DEFAULT') {
    branch = 'FAILURE';
    matchedTargetId = payload.failureNodeId;
    trace.push({ stage: 'API', code: 'API_BRANCH_FAILURE', targetId: matchedTargetId });
  }

  let apiCallBranch: ApiCallBranch = branch;
  let execOutputs: DialogOutput[] | undefined;
  let execUnsupported: DialogOutputType[] = [];
  let nextSessionFromExec: ContextSessionState | null | undefined;
  let surveyStarted: { session: SurveySessionState; event: SurveyEvent } | undefined;

  const noticeText = branch === 'FAILURE' ? API_FAILURE_NOTICE : API_NO_MATCH_NOTICE;
  const noticeMessage = branch === 'FAILURE' ? 'FAILURE' : 'NO_MATCH';

  if (!matchedTargetId) {
    apiCallBranch = 'NOTICE';
    trace.push({ stage: 'API', code: 'API_FIXED_NOTICE', message: noticeMessage });
    execOutputs = [textOutput(noticeText)];
  } else {
    const target = bundle.dialogNodes.find((n) => n.id === matchedTargetId && n.enabled);
    if (!target) {
      trace.push({ stage: 'OUTPUT', code: 'BROKEN_REFERENCE', targetId: matchedTargetId });
      apiCallBranch = 'NOTICE';
      trace.push({ stage: 'API', code: 'API_FIXED_NOTICE', message: noticeMessage });
      execOutputs = [textOutput(noticeText)];
    } else {
      const nextHops = resumeState.hops + 1;
      if (nextHops > hopLimit) {
        trace.push({ stage: 'OUTPUT', code: 'HOP_LIMIT_EXCEEDED' });
        execOutputs = [textOutput('요청을 처리하는 중 이동이 너무 많아 중단했어요. 다시 시도해 주세요.')];
      } else {
        const exec = executeOutputs(target.outputs, bundle, now, {
          hopLimit,
          sourceNodeId: target.id,
          initialHops: nextHops,
          apiCallsRemaining: 0,
          apiVariables: branch === 'FAILURE' ? {} : vars,
          existingSession: resumeState.existingSession,
          // [No.27] §5.6 — `preview`는 `options`가 아니라 `resumeState`에서 읽는다(호출부가 옵션 없이 부른다).
          survey: resumeState.survey ? { completedSurveyIds: resumeState.survey.completedSurveyIds, preview: resumeState.survey.preview } : undefined,
        });
        trace.push(...exec.trace);
        execOutputs = exec.outputs;
        execUnsupported = exec.unsupportedOutputs;
        nextSessionFromExec = exec.nextSession;
        surveyStarted = exec.surveyStarted;
      }
    }
  }

  const outputs = [...resumeState.carry, ...(execOutputs ?? [])];
  const unsupportedOutputs = [...resumeState.unsupported, ...execUnsupported];
  const nextSession = nextSessionFromExec ?? resumeState.sessionFallback;

  // [No.27] §5.6 — 설문 필드 이월(숨은 결함 ②). 없으면 키 자체를 생략한다(§5.4와 같은 규칙).
  const survey = resumeState.survey;
  const nextSurveySession = survey ? (surveyStarted?.session ?? survey.sessionFallback) : null;
  const nextCompletedSurveyIds = survey ? survey.completedSurveyIds : [];
  const nextState: ConversationState = {
    version: CONVERSATION_STATE_VERSION,
    contextSession: nextSession,
    pendingClarify: null,
    ...(nextSurveySession ? { surveySession: nextSurveySession } : {}),
    ...(nextCompletedSurveyIds.length > 0 ? { completedSurveyIds: [...nextCompletedSurveyIds] } : {}),
  };
  const surveyEvents = survey ? [...survey.eventsSoFar, ...(surveyStarted ? [surveyStarted.event] : [])] : [];
  const surveyTurn = survey?.consumedInput ?? false;

  const apiStep: ApiStepResult | undefined = isNotExecuted
    ? undefined
    : {
        outcome: outcome as ApiCallOutcome,
        httpStatus,
        branch: apiCallBranch,
        conditionIndex,
        variables: branch === 'FAILURE' ? {} : vars,
      };

  return {
    input: resumeState.input,
    normalizedInput: resumeState.normalizedInput,
    matchedNodeId: resumeState.matchedNodeId,
    matchedIntentId: resumeState.matchedIntentId,
    matchedFaqId: undefined,
    homonymResolution: resumeState.homonymResolution,
    outputs,
    nextSession,
    pendingClarify: null,
    ...(surveyEvents.length > 0 || surveyTurn ? { surveyEvents, surveyTurn } : {}),
    unsupportedOutputs,
    trace,
    nextState,
    stateDiscarded: turn.stateDiscarded,
    apiStep,
  };
}
