import type {
  ContextSessionState,
  DialogOutput,
  DialogueBundle,
  DialogueResolution,
  HomonymResolution,
  PendingClarify,
  SemanticMatchInput,
  SemanticRankedCandidate,
  Survey,
  SurveyEvent,
  SurveySessionState,
  TraceStep,
} from '@chat-bot/shared-types';
import { isSurveyV2 } from '@chat-bot/shared-types';
import { normalizeText, tokenize, containsWord } from './normalize';
import { matchIntent } from './matcher';
import { buildClarifyOutput, resolveHomonym } from './homonym';
import type { HomonymEvaluation } from './homonym';
import { evaluateNode, rankNodes } from './node-matcher';
import type { EngineContext } from './node-matcher';
import { matchFaqEntry } from './faq';
import { advanceContextSession } from './context-session';
import { executeOutputs } from './outputs';
import { advanceSurveySession } from './survey-session';
import type { SurveyAdvance, SurveyTurnContext, SurveyTurnOutcome } from './survey-session';
import type { DialogueIndex } from './dialogue-index';
import { judgeBand } from './semantic';
import { CLARIFY_TTL_MS, DEFAULT_FALLBACK_RESPONSE, EMPTY_INPUT_RESPONSE, HOP_LIMIT, MAX_INPUT_LENGTH, intentOnlyResponse } from './constants';
import type { ApiCallSuspension, ApiResumeState, ApiSuspensionRequest, CompletedFormInfo } from './api-call';
import { hasWorkflowOutputs } from './workflow-output';
import type { WorkflowEmission } from './workflow-output';

/**
 * [No.41] §5.6 — 정지 전 방출분을 재진입까지 이월할지 결정한다. 방출이 있거나(누락 포함), 폼이
 * 완료됐고 번들에 `WORKFLOW` 아웃풋이 1개 이상 있을 때만 키를 만든다 — 그 외에는 `undefined`
 * (`resumeState`에 `workflow` 키 자체가 없다 · `WORKFLOW` 없는 번들 바이트 동일 보장).
 */
function workflowCarry(
  emissions: WorkflowEmission[] | undefined,
  completedForm: CompletedFormInfo | undefined,
  bundle: DialogueBundle,
): ApiResumeState['workflow'] {
  if (!(emissions && emissions.length > 0) && !(completedForm && hasWorkflowOutputs(bundle))) return undefined;
  return { eventsSoFar: emissions ?? [], ...(completedForm ? { completedForm } : {}) };
}

export interface ResolveOptions {
  /** 사전 구축한 인덱스 재사용(FR-E-10). 미지정 시 내부적으로 원본 배열을 그대로 사용한다. */
  index?: DialogueIndex;
  hopLimit?: number;
  maxInputLength?: number;
  defaultFallbackText?: string;
  /** 되묻기 대기 상태(FR-E2-2, DD-27). `resolveTurn`이 봉투에서 재검증한 값을 주입한다. */
  pendingClarify?: PendingClarify | null;
  /** `pendingClarify` TTL(기본 10분). */
  clarifyTtlMs?: number;
  /** `resolveTurn`이 상태 봉투를 재검증할 때 쓰는 최대 수명(기본 24시간). `resolveResponse` 자체는 사용하지 않는다. */
  stateMaxAgeMs?: number;
  /**
   * [신규] `apps/api`가 턴마다 사전 계산한 1단계(NLU 의미 유사도) 점수 맵(J-2, ADR-0020).
   * 미지정 시 현행 동작(정확일치+부분일치)과 완전히 동일하다 — 저하 모드가 곧 현행 동작이다(AC-N1-3).
   */
  semantic?: SemanticMatchInput;
  /** [No.27 신설] 켜면 DRAFT·마감·기간 밖 설문도 진행한다(시뮬레이터·TC — 공개 경로는 항상 false). */
  surveyPreview?: boolean;
  /** [No.27 신설, @internal] `resolveTurn`이 sanitize 결과로 채운다. 미지정 = 세션 없음·완료 목록 빈 배열. */
  surveyState?: SurveyTurnContext;
}

/** [No.26] `resolveResponse`/`resolveByNodeId`의 확장 반환 타입 — 정지 시 `apiCall`이 채워진다.
 * [No.27] `survey`(@internal) — `resolveTurn`이 `DialogueTurnResult`로 풀어 쓴 뒤 제거한다. */
export type EngineResolution = DialogueResolution & { apiCall?: ApiCallSuspension; survey?: SurveyTurnOutcome; workflowEvents?: WorkflowEmission[] };

function textOutput(text: string): DialogOutput {
  return { type: 'TEXT', payload: { text } };
}

function emptySurveyCtx(options: ResolveOptions): SurveyTurnContext {
  return options.surveyState ?? { session: null, completedSurveyIds: [], preview: options.surveyPreview ?? false };
}

/** 완료 목록에 추가하며 20개 상한을 넘으면 오래된 것부터 제거한다(§5.3 ⑦). */
function pushCompletedSurveyId(ids: readonly string[], surveyId: string): string[] {
  const deduped = ids.filter((id) => id !== surveyId);
  deduped.push(surveyId);
  return deduped.length > 20 ? deduped.slice(deduped.length - 20) : deduped;
}

/** [No.27] `surveyEventsSoFar` + 실행 중 새로 시작된 설문 이벤트를 합쳐 `SurveyTurnOutcome`을 만든다.
 * 관여가 전혀 없으면 undefined(키 생략 규칙, §5.4). */
function mergeSurveyOutcome(
  eventsSoFar: readonly SurveyEvent[],
  surveyCtx: SurveyTurnContext,
  started: { session: SurveySessionState; event: SurveyEvent } | undefined,
  consumedInput: boolean,
): SurveyTurnOutcome | undefined {
  if (eventsSoFar.length === 0 && !started && !consumedInput) return undefined;
  return {
    nextSession: started?.session ?? null,
    completedSurveyIds: [...surveyCtx.completedSurveyIds],
    events: [...eventsSoFar, ...(started ? [started.event] : [])],
    consumedInput,
  };
}

interface FallbackContext {
  input: string;
  normalizedInput: string;
  carry: DialogOutput[];
  /** 세션 변경분(예: COMPLETED 이후 null, 버튼 진입 시 CANCELLED). 실행 결과가 세션을 바꾸지 않으면 이 값이 최종 nextSession이 된다. */
  nextSessionOverride: ContextSessionState | null | undefined;
  /** `CONTEXT_FORM` 전환 고지 판단에 쓰는 "실행 시점 세션"(EX-S-7). 보통 원본 세션이다. */
  session: ContextSessionState | null;
  trace: TraceStep[];
  /** [No.26] 이번 턴에 완료된 폼(있으면) — FALLBACK 노드의 API 바인딩에도 적용한다. */
  completedForm?: CompletedFormInfo;
  matchedIntentId?: string;
  homonymResolution?: HomonymResolution;
  /** [No.27] 설문 참여 가능 판정 입력 + 이번 턴 앞서 발생한 설문 이벤트(S0 RELEASED·버튼 SWITCHED). */
  surveyCtx: SurveyTurnContext;
  surveyEventsSoFar: SurveyEvent[];
}

/** [No.26] 정지 시 반환할 `EngineResolution`을 조립한다(§5.3) — 세 실행 지점(S3·S6·`resolveByNodeId`) 공용. */
function buildSuspendedResolution(params: {
  input: string;
  normalizedInput: string;
  matchedNodeId?: string;
  matchedIntentId?: string;
  homonymResolution?: HomonymResolution;
  trace: TraceStep[];
  carry: DialogOutput[];
  suspended: ApiSuspensionRequest;
  execUnsupported: DialogueResolution['unsupportedOutputs'];
  hops: number;
  hopLimit: number;
  sessionFallback: ContextSessionState | null;
  existingSession: ContextSessionState | null;
  /** [No.27] 정지 전까지의 설문 이월분(§5.6). */
  survey?: ApiResumeState['survey'];
  /** [No.41] 정지 전 방출분 + 같은 턴 완료 폼(§5.6) — `workflowCarry()`가 조건을 만족할 때만 넘긴다. */
  workflow?: ApiResumeState['workflow'];
}): EngineResolution {
  const resumeState: ApiResumeState = {
    input: params.input,
    normalizedInput: params.normalizedInput,
    matchedNodeId: params.matchedNodeId,
    matchedIntentId: params.matchedIntentId,
    homonymResolution: params.homonymResolution,
    trace: params.trace,
    carry: params.carry,
    unsupported: params.execUnsupported,
    hops: params.hops,
    hopLimit: params.hopLimit,
    sessionFallback: params.sessionFallback,
    existingSession: params.existingSession,
    survey: params.survey,
    workflow: params.workflow,
  };
  return {
    input: params.input,
    normalizedInput: params.normalizedInput,
    matchedNodeId: params.matchedNodeId,
    matchedIntentId: params.matchedIntentId,
    homonymResolution: params.homonymResolution,
    outputs: [],
    nextSession: null,
    unsupportedOutputs: [],
    trace: params.trace,
    apiCall: { ...params.suspended, resumeState },
  };
}

/**
 * 폴백 경로(FALLBACK 노드 → `ERROR_RESPONSE` FAQ → 기본 문구)를 실행한다(FR-E-9, FR-E2-1).
 * `resolveResponse`(S6)와 `resolveByNodeId`(노드 없음/비활성)가 공유하는 순수 함수다.
 */
function resolveFallback(fc: FallbackContext, bundle: DialogueBundle, now: Date, options: ResolveOptions): EngineResolution {
  const { input, normalizedInput, carry, nextSessionOverride, session, trace, surveyCtx, surveyEventsSoFar } = fc;
  const hopLimit = options.hopLimit ?? HOP_LIMIT;

  const fallbackNode = bundle.dialogNodes.find((n) => n.nodeType === 'FALLBACK' && n.enabled);
  if (fallbackNode) {
    trace.push({ stage: 'FALLBACK', code: 'FALLBACK_NODE', targetId: fallbackNode.id, targetName: fallbackNode.name });
    const execResult = executeOutputs(fallbackNode.outputs, bundle, now, {
      hopLimit: options.hopLimit,
      existingSession: session,
      sourceNodeId: fallbackNode.id,
      completedForm: fc.completedForm,
      survey: { completedSurveyIds: surveyCtx.completedSurveyIds, preview: surveyCtx.preview },
    });
    trace.push(...execResult.trace);

    if (execResult.suspended) {
      return buildSuspendedResolution({
        input,
        normalizedInput,
        matchedNodeId: fallbackNode.id,
        matchedIntentId: fc.matchedIntentId,
        homonymResolution: fc.homonymResolution,
        trace,
        carry: [...carry, ...execResult.outputs],
        suspended: execResult.suspended,
        execUnsupported: execResult.unsupportedOutputs,
        hops: execResult.hops,
        hopLimit,
        sessionFallback: nextSessionOverride ?? null,
        existingSession: session,
        survey: { completedSurveyIds: surveyCtx.completedSurveyIds, preview: surveyCtx.preview, eventsSoFar: surveyEventsSoFar, consumedInput: false, sessionFallback: null },
        workflow: workflowCarry(execResult.workflowEmissions, fc.completedForm, bundle),
      });
    }

    return {
      input,
      normalizedInput,
      matchedNodeId: fallbackNode.id,
      outputs: [...carry, ...execResult.outputs],
      nextSession: execResult.nextSession ?? nextSessionOverride ?? null,
      unsupportedOutputs: execResult.unsupportedOutputs,
      trace,
      survey: mergeSurveyOutcome(surveyEventsSoFar, surveyCtx, execResult.surveyStarted, false),
      ...(execResult.workflowEmissions ? { workflowEvents: execResult.workflowEmissions } : {}),
    };
  }

  const errorFaqs = bundle.faqs
    .filter((f) => f.category === 'ERROR_RESPONSE' && f.enabled !== false)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  if (errorFaqs.length > 0) {
    trace.push({ stage: 'FALLBACK', code: 'FALLBACK_FAQ', targetId: errorFaqs[0].id });
    return {
      input,
      normalizedInput,
      matchedFaqId: errorFaqs[0].id,
      outputs: [...carry, textOutput(errorFaqs[0].answer)],
      nextSession: nextSessionOverride ?? null,
      unsupportedOutputs: [],
      trace,
      survey: mergeSurveyOutcome(surveyEventsSoFar, surveyCtx, undefined, false),
    };
  }

  trace.push({ stage: 'FALLBACK', code: 'FALLBACK_DEFAULT' });
  return {
    input,
    normalizedInput,
    outputs: [...carry, textOutput(options.defaultFallbackText ?? DEFAULT_FALLBACK_RESPONSE)],
    nextSession: nextSessionOverride ?? null,
    unsupportedOutputs: [],
    trace,
    survey: mergeSurveyOutcome(surveyEventsSoFar, surveyCtx, undefined, false),
  };
}

/** [No.27] §5.3.1 — 설문 완료 후 이동. 포인터로 현재 정의를 다시 찾는다. */
function resolveSurveyCompletion(
  input: string,
  norm: string,
  survey: Survey,
  session: SurveySessionState,
  advance: Extract<SurveyAdvance, { kind: 'CONSUMED' }>,
  completedSurveyIds: string[],
  bundle: DialogueBundle,
  now: Date,
  options: ResolveOptions,
  trace: TraceStep[],
): EngineResolution {
  const outcomeBase: SurveyTurnOutcome = { nextSession: null, completedSurveyIds, events: advance.events, consumedInput: true };

  const node = session.nodeId ? bundle.dialogNodes.find((n) => n.id === session.nodeId) : undefined;
  const output = node?.outputs[session.outputIndex];
  const onCompleteNodeId =
    output && output.type === 'SURVEY' && isSurveyV2(output.payload) && output.payload.surveyId === survey.id ? output.payload.onCompleteNodeId : undefined;

  if (!onCompleteNodeId) {
    return { input, normalizedInput: norm, outputs: advance.outputs, nextSession: null, unsupportedOutputs: [], trace, survey: outcomeBase };
  }

  const target = bundle.dialogNodes.find((n) => n.id === onCompleteNodeId && n.enabled);
  if (!target) {
    trace.push({ stage: 'OUTPUT', code: 'BROKEN_REFERENCE', targetId: onCompleteNodeId });
    return { input, normalizedInput: norm, outputs: advance.outputs, nextSession: null, unsupportedOutputs: [], trace, survey: outcomeBase };
  }

  const hopLimit = options.hopLimit ?? HOP_LIMIT;
  const execResult = executeOutputs(target.outputs, bundle, now, {
    hopLimit,
    sourceNodeId: target.id,
    initialHops: 1,
    survey: { completedSurveyIds, preview: options.surveyPreview ?? false },
    existingSession: null,
  });
  trace.push(...execResult.trace);

  if (execResult.suspended) {
    return buildSuspendedResolution({
      input,
      normalizedInput: norm,
      matchedNodeId: target.id,
      trace,
      carry: [...advance.outputs, ...execResult.outputs],
      suspended: execResult.suspended,
      execUnsupported: execResult.unsupportedOutputs,
      hops: execResult.hops,
      hopLimit,
      sessionFallback: null,
      existingSession: null,
      survey: { completedSurveyIds, preview: options.surveyPreview ?? false, eventsSoFar: advance.events, consumedInput: true, sessionFallback: null },
      workflow: workflowCarry(execResult.workflowEmissions, undefined, bundle),
    });
  }

  const combinedEvents = [...advance.events, ...(execResult.surveyStarted ? [execResult.surveyStarted.event] : [])];
  return {
    input,
    normalizedInput: norm,
    matchedNodeId: target.id,
    outputs: [...advance.outputs, ...execResult.outputs],
    nextSession: execResult.nextSession ?? null,
    unsupportedOutputs: execResult.unsupportedOutputs,
    trace,
    ...(execResult.workflowEmissions ? { workflowEvents: execResult.workflowEmissions } : {}),
    survey: { nextSession: execResult.surveyStarted?.session ?? null, completedSurveyIds, events: combinedEvents, consumedInput: true },
  };
}

/**
 * 대화 해석 파이프라인의 진입점(FR-E-2, ADR-0008). DB·NestJS 무의존 순수 함수이며 예외를 던지지 않는다.
 * 우선순위: S0 설문 세션(No.27) → S1 컨텍스트 세션 → S1.5 되묻기 해소(FR-E2-2) → S2 동음이의어 보정
 * → S3 DialogNode 매칭 → S4 FAQ → S5 의도 단독 → S6 폴백.
 */
export function resolveResponse(
  input: string,
  session: ContextSessionState | null,
  bundle: DialogueBundle,
  now: Date,
  options: ResolveOptions = {},
): EngineResolution {
  const trace: TraceStep[] = [];
  const maxInputLength = options.maxInputLength ?? MAX_INPUT_LENGTH;
  const clarifyTtlMs = options.clarifyTtlMs ?? CLARIFY_TTL_MS;
  const hopLimit = options.hopLimit ?? HOP_LIMIT;

  let raw = input ?? '';
  if (raw.length > maxInputLength) {
    raw = raw.slice(0, maxInputLength);
    trace.push({ stage: 'PREPROCESS', code: 'INPUT_TRUNCATED' });
  }
  const norm = normalizeText(raw);

  if (norm === '') {
    trace.push({ stage: 'PREPROCESS', code: 'EMPTY_INPUT' });
    return {
      input,
      normalizedInput: norm,
      outputs: [textOutput(EMPTY_INPUT_RESPONSE)],
      nextSession: session,
      unsupportedOutputs: [],
      trace,
    };
  }

  const ctx: EngineContext = { raw, norm, tokens: tokenize(norm) };
  let carry: DialogOutput[] = [];
  let nextSessionOverride: ContextSessionState | null | undefined;
  let pending = options.pendingClarify ?? null;
  let completedForm: CompletedFormInfo | undefined;

  // S0 — 설문 세션(§5.3, S1과 상호 배타 — sanitize가 강제한다)
  const surveyCtx = emptySurveyCtx(options);
  let surveyEventsSoFar: SurveyEvent[] = [];
  if (surveyCtx.session) {
    const survey = bundle.surveys?.find((s) => s.id === surveyCtx.session!.surveyId);
    if (survey) {
      if (pending) {
        trace.push({ stage: 'HOMONYM', code: 'CLARIFY_DISCARDED', message: '설문 우선' });
        pending = null;
      }
      const activeSession = surveyCtx.session;
      const advance = advanceSurveySession(activeSession, { raw, norm }, survey, now, surveyCtx.preview);
      trace.push(...advance.trace);

      if (advance.kind === 'CONSUMED') {
        const completedSurveyIds = advance.completed
          ? pushCompletedSurveyId(surveyCtx.completedSurveyIds, survey.id)
          : [...surveyCtx.completedSurveyIds];
        if (advance.completed) {
          return resolveSurveyCompletion(input, norm, survey, activeSession, advance, completedSurveyIds, bundle, now, options, trace);
        }
        return {
          input,
          normalizedInput: norm,
          outputs: advance.outputs,
          nextSession: session,
          unsupportedOutputs: [],
          trace,
          survey: { nextSession: advance.nextSession, completedSurveyIds, events: advance.events, consumedInput: true },
        };
      }

      // RELEASED — 종료 안내를 carry에 싣고 일반 경로로 계속한다(FR-SV4-12).
      carry = advance.carry;
      surveyEventsSoFar = advance.events;
    }
  }

  // S1 — 컨텍스트 세션
  if (session && session.status === 'IN_PROGRESS') {
    if (pending) {
      // 슬롯 질문이 더 최근의 질문이다. 되묻기는 포기한다(§7.3).
      trace.push({ stage: 'HOMONYM', code: 'CLARIFY_DISCARDED', message: '세션 우선' });
      pending = null;
    }

    const def = bundle.contexts.find((c) => c.id === session.contextVariableId);
    const structureBroken =
      !def ||
      session.currentSlotIndex > def.slots.length ||
      Object.keys(session.filledValues).some((key) => !def.slots.some((s) => s.name === key));

    if (structureBroken) {
      trace.push({ stage: 'SESSION', code: 'SESSION_DEFINITION_CHANGED' });
      return {
        input,
        normalizedInput: norm,
        outputs: [textOutput('진행 중이던 내용의 설정이 변경되어 처음부터 다시 시작해 주세요.')],
        nextSession: { ...session, status: 'CANCELLED', lastInteractedAt: now },
        unsupportedOutputs: [],
        trace,
        survey: mergeSurveyOutcome(surveyEventsSoFar, surveyCtx, undefined, false),
      };
    }

    const advance = advanceContextSession(session, { raw, norm }, def, now, bundle.keywords);

    if (advance.state.status !== 'COMPLETED') {
      const code =
        advance.state.status === 'CANCELLED'
          ? 'SESSION_CANCELLED'
          : advance.state.status === 'EXPIRED'
            ? 'SESSION_EXPIRED'
            : 'SESSION_RETRY';
      trace.push({ stage: 'SESSION', code });
      return {
        input,
        normalizedInput: norm,
        outputs: advance.outputs,
        nextSession: advance.state,
        unsupportedOutputs: [],
        trace,
        survey: mergeSurveyOutcome(surveyEventsSoFar, surveyCtx, undefined, false),
      };
    }

    trace.push({ stage: 'SESSION', code: 'SESSION_COMPLETED' });
    carry = [...carry, ...advance.outputs];
    ctx.completedContextVariableId = def.id;
    nextSessionOverride = null;
    completedForm = { contextVariableId: def.id, values: advance.state.filledValues };
  }

  // S1.5 — 되묻기 해소(FR-E2-2, DD-27). 확정되면 S2(동음이의어 보정)를 건너뛴다.
  let clarified: { homonymId: string; intentId?: string; label: string } | undefined;
  let homonymEval: HomonymEvaluation;

  if (pending) {
    if (now.getTime() - pending.askedAt.getTime() > clarifyTtlMs) {
      trace.push({ stage: 'HOMONYM', code: 'CLARIFY_DISCARDED', message: '만료' });
      pending = null;
    } else {
      const dict = bundle.homonyms.find((d) => d.id === pending!.homonymId);
      if (!dict) {
        trace.push({ stage: 'HOMONYM', code: 'CLARIFY_DISCARDED', message: '사전 삭제됨' });
        pending = null;
      } else {
        let idx = dict.meanings.findIndex((m) => normalizeText(m.label) === norm);
        if (idx < 0) idx = dict.meanings.findIndex((m) => containsWord(norm, normalizeText(m.label)));
        if (idx < 0) {
          idx = dict.meanings.findIndex((m) => m.contextHints.some((hint) => containsWord(norm, normalizeText(hint))));
        }

        if (idx >= 0) {
          const meaning = dict.meanings[idx];
          clarified = { homonymId: dict.id, intentId: meaning.intentId, label: meaning.label };
          trace.push({ stage: 'HOMONYM', code: 'CLARIFY_RESOLVED', targetId: dict.id, message: meaning.label });
          pending = null;
        } else {
          trace.push({ stage: 'HOMONYM', code: 'CLARIFY_DISCARDED', targetId: dict.id });
          pending = null;
        }
      }
    }
  }

  if (clarified) {
    const resolution: HomonymResolution = {
      word: dictWordOrFallback(bundle, clarified.homonymId),
      status: 'RESOLVED',
      meaningLabel: clarified.label,
      intentId: clarified.intentId,
      matchedHints: [],
    };
    homonymEval = { resolution, homonymId: clarified.homonymId };
  } else {
    // S2 — 동음이의어 보정
    homonymEval = resolveHomonym(norm, bundle.homonyms);
    if (homonymEval.resolution?.status === 'RESOLVED') {
      trace.push({
        stage: 'HOMONYM',
        code: 'HOMONYM_RESOLVED',
        targetId: homonymEval.homonymId,
        message: homonymEval.resolution.meaningLabel,
      });
    } else if (homonymEval.resolution?.status === 'AMBIGUOUS') {
      trace.push({ stage: 'HOMONYM', code: 'HOMONYM_AMBIGUOUS', targetId: homonymEval.homonymId });
      if (!homonymEval.policy || homonymEval.policy === 'ASK') {
        return {
          input,
          normalizedInput: norm,
          homonymResolution: homonymEval.resolution,
          outputs: [...carry, buildClarifyOutput(homonymEval)],
          nextSession: nextSessionOverride ?? null,
          pendingClarify: homonymEval.homonymId
            ? { homonymId: homonymEval.homonymId, word: homonymEval.resolution.word, askedAt: now }
            : null,
          unsupportedOutputs: [],
          trace,
          survey: mergeSurveyOutcome(surveyEventsSoFar, surveyCtx, undefined, false),
        };
      }
    } else if (homonymEval.resolution?.status === 'IGNORED') {
      trace.push({ stage: 'HOMONYM', code: 'HOMONYM_IGNORED', targetId: homonymEval.homonymId });
    }
  }

  // 1단계(NLU 의미 유사도) 3구간 판정 — `semantic` 미주입 시 undefined이며 아래 모든 분기가
  // 현행 동작(정확일치+부분일치)과 바이트 단위로 동일해진다(DD-73, AC-N1-3).
  const semantic = options.semantic;
  const semanticBand = semantic ? judgeBand(semantic.ranked, semantic.thresholds) : undefined;
  const semanticConfirmedCandidate = semanticBand?.kind === 'CONFIRMED' ? semanticBand.candidate : undefined;

  const boostIntentIds =
    homonymEval.resolution?.status === 'RESOLVED' && homonymEval.resolution.intentId
      ? [homonymEval.resolution.intentId]
      : undefined;
  // `semantic`이 주입된 턴에서는 부분 문자열 포함 매칭을 평가하지 않는다(DD-73) — 반환값이 있다면 항상 정확일치다.
  const intentMatch = matchIntent(raw, bundle.intents, { boostIntentIds, index: options.index, exactOnly: !!semantic });
  // ⚠ 부스트만으로는 부족하다 — matchIntent가 예문 매칭에 실패하면 null을 반환하므로,
  // S1.5에서 확정된 의도를 "확정 값"으로 강제한다(단순 부스트가 아니다, DD-27).
  // `semantic` 3구간 판정이 확정(CONFIRMED)한 의도도 같은 자격으로 강제한다 — 의미 매칭이
  // 노드 트리거(S3)에도 전파되는 것은 의도된 동작 변경이다(FR-N1-11, AC-N1-6 명시 고정).
  const semanticConfirmedIntentId =
    semanticConfirmedCandidate?.kind === 'INTENT' && bundle.intents.some((i) => i.id === semanticConfirmedCandidate.id)
      ? semanticConfirmedCandidate.id
      : undefined;
  ctx.matchedIntentId = intentMatch?.intentId ?? clarified?.intentId ?? semanticConfirmedIntentId;
  if (!intentMatch && !clarified && semanticConfirmedIntentId) {
    trace.push({ stage: 'SEMANTIC', code: 'SEMANTIC_MATCHED', targetId: semanticConfirmedIntentId, score: semanticConfirmedCandidate?.score });
  }

  // S3 — DialogNode 매칭
  const rankedNodes = options.index?.nodesRanked ?? rankNodes(bundle.dialogNodes);
  const candidateNodes = rankedNodes.filter((n) => n.enabled && n.nodeType !== 'FALLBACK');
  const evaluations = candidateNodes.map((n) => evaluateNode(n, ctx, bundle));
  for (const ev of evaluations) {
    for (const broken of ev.brokenReferences) {
      trace.push({ stage: 'NODE', code: 'BROKEN_REFERENCE', targetId: broken.id, message: `${broken.kind} 참조가 끊어졌습니다.` });
    }
  }
  const matchedEvaluations = evaluations.filter((e) => e.matched);

  if (matchedEvaluations.length > 0) {
    const node = matchedEvaluations[0].node;
    if (matchedEvaluations.length > 1) {
      trace.push({ stage: 'NODE', code: 'NODE_TIEBREAK', targetId: node.id, targetName: node.name });
    }
    trace.push({ stage: 'NODE', code: 'NODE_MATCHED', targetId: node.id, targetName: node.name });

    const execResult = executeOutputs(node.outputs, bundle, now, {
      hopLimit: options.hopLimit,
      existingSession: session,
      sourceNodeId: node.id,
      completedForm,
      survey: { completedSurveyIds: surveyCtx.completedSurveyIds, preview: surveyCtx.preview },
    });
    trace.push(...execResult.trace);

    if (execResult.suspended) {
      return buildSuspendedResolution({
        input,
        normalizedInput: norm,
        matchedNodeId: node.id,
        matchedIntentId: ctx.matchedIntentId,
        homonymResolution: homonymEval.resolution ?? undefined,
        trace,
        carry: [...carry, ...execResult.outputs],
        suspended: execResult.suspended,
        execUnsupported: execResult.unsupportedOutputs,
        hops: execResult.hops,
        hopLimit,
        sessionFallback: nextSessionOverride ?? null,
        existingSession: session,
        survey: { completedSurveyIds: surveyCtx.completedSurveyIds, preview: surveyCtx.preview, eventsSoFar: surveyEventsSoFar, consumedInput: false, sessionFallback: null },
        workflow: workflowCarry(execResult.workflowEmissions, completedForm, bundle),
      });
    }

    return {
      input,
      normalizedInput: norm,
      matchedNodeId: node.id,
      matchedIntentId: ctx.matchedIntentId,
      homonymResolution: homonymEval.resolution ?? undefined,
      outputs: [...carry, ...execResult.outputs],
      nextSession: execResult.nextSession ?? nextSessionOverride ?? null,
      unsupportedOutputs: execResult.unsupportedOutputs,
      trace,
      survey: mergeSurveyOutcome(surveyEventsSoFar, surveyCtx, execResult.surveyStarted, false),
      ...(execResult.workflowEmissions ? { workflowEvents: execResult.workflowEmissions } : {}),
    };
  }

  // S4 — FAQ
  if (semantic) {
    // ① 정규화 정확일치는 항상 최우선이다(FR-N1-9). 정확일치 시 3구간 판정을 거치지 않는다.
    const faqExact = matchFaqEntry(norm, bundle.faqs, { exactOnly: true });
    if (faqExact) {
      trace.push({ stage: 'FAQ', code: 'FAQ_MATCHED', targetId: faqExact.faqId });
      return {
        input,
        normalizedInput: norm,
        matchedFaqId: faqExact.faqId,
        matchedIntentId: ctx.matchedIntentId,
        homonymResolution: homonymEval.resolution ?? undefined,
        outputs: [...carry, textOutput(faqExact.answer)],
        nextSession: nextSessionOverride ?? null,
        unsupportedOutputs: [],
        trace,
        survey: mergeSurveyOutcome(surveyEventsSoFar, surveyCtx, undefined, false),
      };
    }

    if (semanticConfirmedCandidate?.kind === 'FAQ') {
      const faq = bundle.faqs.find((f) => f.id === semanticConfirmedCandidate.id && f.enabled !== false);
      if (faq) {
        trace.push({ stage: 'SEMANTIC', code: 'SEMANTIC_MATCHED', targetId: faq.id, score: semanticConfirmedCandidate.score });
        return {
          input,
          normalizedInput: norm,
          matchedFaqId: faq.id,
          matchedIntentId: ctx.matchedIntentId,
          homonymResolution: homonymEval.resolution ?? undefined,
          outputs: [...carry, textOutput(faq.answer)],
          nextSession: nextSessionOverride ?? null,
          unsupportedOutputs: [],
          trace,
          survey: mergeSurveyOutcome(surveyEventsSoFar, surveyCtx, undefined, false),
        };
      }
      // 색인이 가리키는 FAQ가 이미 삭제/비활성화됐다 — 신뢰하지 않고 실패로 흘려보낸다(EX-N1-3과 대칭).
      trace.push({ stage: 'SEMANTIC', code: 'SEMANTIC_BELOW_THRESHOLD' });
    } else if (semanticBand?.kind === 'AMBIGUOUS') {
      // 모호 구간 — 후보 질문 원문을 MESSAGE 버튼으로 제시한다(FR-N1-12). 클릭 시 그 텍스트가
      // 재입력되어 정확일치로 확정된다. `ConversationState` 스키마는 바꾸지 않는다(DD-75).
      trace.push({ stage: 'SEMANTIC', code: 'SEMANTIC_AMBIGUOUS' });
      return {
        input,
        normalizedInput: norm,
        homonymResolution: homonymEval.resolution ?? undefined,
        outputs: [...carry, buildSemanticClarifyOutput(semanticBand.candidates)],
        nextSession: nextSessionOverride ?? null,
        unsupportedOutputs: [],
        trace,
        survey: mergeSurveyOutcome(surveyEventsSoFar, surveyCtx, undefined, false),
      };
    } else if (semanticBand?.kind === 'FAILED') {
      trace.push({ stage: 'SEMANTIC', code: 'SEMANTIC_BELOW_THRESHOLD' });
    }
    // semanticBand이 CONFIRMED(kind==='INTENT')이면 여기서 할 일이 없다 — ctx.matchedIntentId가
    // 이미 세워져 있으므로 아래 S5가 그대로 처리한다.
  } else {
    const faqMatch = matchFaqEntry(norm, bundle.faqs);
    if (faqMatch) {
      trace.push({ stage: 'FAQ', code: 'FAQ_MATCHED', targetId: faqMatch.faqId });
      return {
        input,
        normalizedInput: norm,
        matchedFaqId: faqMatch.faqId,
        matchedIntentId: ctx.matchedIntentId,
        homonymResolution: homonymEval.resolution ?? undefined,
        outputs: [...carry, textOutput(faqMatch.answer)],
        nextSession: nextSessionOverride ?? null,
        unsupportedOutputs: [],
        trace,
        survey: mergeSurveyOutcome(surveyEventsSoFar, surveyCtx, undefined, false),
      };
    }
  }

  // S5 — 의도 단독(FR-E2-2로 조건 완화: `ctx.matchedIntentId`가 세워지는 경로는 여전히
  // `intentMatch?.intentId`뿐이었으나, 이제 S1.5 확정 의도도 이 조건으로 들어온다).
  if (ctx.matchedIntentId) {
    trace.push({ stage: 'INTENT', code: 'INTENT_ONLY', targetId: ctx.matchedIntentId });
    const example = intentMatch?.matchedExample ?? firstExampleOf(bundle, ctx.matchedIntentId) ?? '';
    return {
      input,
      normalizedInput: norm,
      matchedIntentId: ctx.matchedIntentId,
      homonymResolution: homonymEval.resolution ?? undefined,
      outputs: [...carry, textOutput(intentOnlyResponse(ctx.matchedIntentId, example))],
      nextSession: nextSessionOverride ?? null,
      unsupportedOutputs: [],
      trace,
      survey: mergeSurveyOutcome(surveyEventsSoFar, surveyCtx, undefined, false),
    };
  }

  // S6 — 폴백
  return resolveFallback(
    {
      input,
      normalizedInput: norm,
      carry,
      nextSessionOverride,
      session,
      trace,
      completedForm,
      matchedIntentId: ctx.matchedIntentId,
      homonymResolution: homonymEval.resolution ?? undefined,
      surveyCtx,
      surveyEventsSoFar,
    },
    bundle,
    now,
    options,
  );
}

const CLARIFY_BUTTON_LABEL_MAX = 40;
const CLARIFY_BUTTON_VALUE_MAX = 200;

/** 후보 텍스트를 버튼 라벨 상한(40자)에 맞춰 자른다. `value`(재입력 시 정확일치 대상)는 자르지 않는다. */
function truncateClarifyLabel(text: string): string {
  return text.length <= CLARIFY_BUTTON_LABEL_MAX ? text : `${text.slice(0, CLARIFY_BUTTON_LABEL_MAX - 1)}…`;
}

/**
 * 1단계 모호 구간(FR-N1-12) 되묻기 출력 — 후보 질문 원문을 `MESSAGE` 버튼으로 제시한다.
 * 클릭 시 그 텍스트가 재입력되어 정확일치로 확정된다(AC-N1-5). 최대 3건(FR-N1-13, `judgeBand`가 보장).
 */
function buildSemanticClarifyOutput(candidates: readonly SemanticRankedCandidate[]): DialogOutput {
  return {
    type: 'BUTTON',
    payload: {
      text: '이 중에 해당하는 게 있을까요?',
      buttons: candidates.map((c) => ({
        label: truncateClarifyLabel(c.matchedText),
        action: 'MESSAGE' as const,
        value: c.matchedText.length > CLARIFY_BUTTON_VALUE_MAX ? c.matchedText.slice(0, CLARIFY_BUTTON_VALUE_MAX) : c.matchedText,
      })),
    },
  };
}

function dictWordOrFallback(bundle: DialogueBundle, homonymId: string): string {
  return bundle.homonyms.find((d) => d.id === homonymId)?.word ?? '';
}

function firstExampleOf(bundle: DialogueBundle, intentId: string): string | undefined {
  return bundle.intents.find((i) => i.id === intentId)?.examples[0];
}

/**
 * 버튼 `NODE` 액션 진입점(FR-E2-1). 노드 없음/비활성이면 예외 대신 공통 폴백 경로를 탄다.
 * 세션이 진행 중일 때 NODE 버튼이 오면 버튼이 이긴다 — 세션을 `CANCELLED`로 종료한 뒤
 * (전환 고지가 필요하면 `executeOutputs`가 재사용한다, EX-S-7) 노드를 실행한다.
 * [No.26] 버튼 진입에는 폼 완료 바인딩이 없다(`completedForm` 미전달 — AC-L3-12).
 * [No.27] 설문 세션이 있으면 먼저 `ABANDONED(SWITCHED)`로 종료한다(FR-SV4-11) — 이 턴은
 * `consumedInput = false`(사용자가 다른 흐름을 골랐다).
 */
export function resolveByNodeId(
  nodeId: string,
  session: ContextSessionState | null,
  bundle: DialogueBundle,
  now: Date,
  options: ResolveOptions & { inputLabel?: string } = {},
): EngineResolution {
  const trace: TraceStep[] = [];
  const inputLabel = options.inputLabel ?? '';
  const normalizedInput = normalizeText(inputLabel);
  const hopLimit = options.hopLimit ?? HOP_LIMIT;

  const sessionInProgress = !!session && session.status === 'IN_PROGRESS';
  const cancelledSession: ContextSessionState | null = sessionInProgress
    ? { ...(session as ContextSessionState), status: 'CANCELLED', lastInteractedAt: now }
    : (session ?? null);
  if (sessionInProgress) {
    trace.push({ stage: 'SESSION', code: 'SESSION_CANCELLED' });
  }

  // [No.27] 설문 세션 선(先) 종료(SWITCHED) — FR-SV4-11.
  const surveyCtx = emptySurveyCtx(options);
  let surveyEventsSoFar: SurveyEvent[] = [];
  if (surveyCtx.session) {
    trace.push({ stage: 'SURVEY', code: 'SURVEY_ABANDONED', targetId: surveyCtx.session.surveyId, message: 'SWITCHED' });
    surveyEventsSoFar = [
      {
        kind: 'ABANDONED',
        attempt: { surveyId: surveyCtx.session.surveyId, structureVersion: surveyCtx.session.structureVersion, startedAt: surveyCtx.session.startedAt },
        reason: 'SWITCHED',
      },
    ];
  }

  const node = options.index?.nodesById?.get(nodeId) ?? bundle.dialogNodes.find((n) => n.id === nodeId);

  if (node && node.enabled) {
    trace.push({ stage: 'NODE', code: 'NODE_BY_ID', targetId: node.id, targetName: node.name });
    const execResult = executeOutputs(node.outputs, bundle, now, {
      hopLimit: options.hopLimit,
      existingSession: session,
      sourceNodeId: node.id,
      survey: { completedSurveyIds: surveyCtx.completedSurveyIds, preview: surveyCtx.preview },
    });
    trace.push(...execResult.trace);

    if (execResult.suspended) {
      return buildSuspendedResolution({
        input: inputLabel,
        normalizedInput,
        matchedNodeId: node.id,
        trace,
        carry: execResult.outputs,
        suspended: execResult.suspended,
        execUnsupported: execResult.unsupportedOutputs,
        hops: execResult.hops,
        hopLimit,
        sessionFallback: cancelledSession ?? null,
        existingSession: session,
        survey: { completedSurveyIds: surveyCtx.completedSurveyIds, preview: surveyCtx.preview, eventsSoFar: surveyEventsSoFar, consumedInput: false, sessionFallback: null },
        // [No.41] 버튼 진입에는 완료 폼이 없다(FR-WF2-8 ①④ — 항상 누락으로 설계 점검이 경고한다).
        workflow: workflowCarry(execResult.workflowEmissions, undefined, bundle),
      });
    }

    return {
      input: inputLabel,
      normalizedInput,
      matchedNodeId: node.id,
      outputs: execResult.outputs,
      nextSession: execResult.nextSession ?? cancelledSession ?? null,
      unsupportedOutputs: execResult.unsupportedOutputs,
      trace,
      survey: mergeSurveyOutcome(surveyEventsSoFar, surveyCtx, execResult.surveyStarted, false),
      ...(execResult.workflowEmissions ? { workflowEvents: execResult.workflowEmissions } : {}),
    };
  }

  trace.push({ stage: 'NODE', code: 'NODE_BY_ID_NOT_FOUND', targetId: nodeId });
  return resolveFallback(
    { input: inputLabel, normalizedInput, carry: [], nextSessionOverride: cancelledSession, session, trace, surveyCtx, surveyEventsSoFar },
    bundle,
    now,
    options,
  );
}
