import type {
  ContextSessionState,
  DialogOutput,
  DialogueBundle,
  DialogueResolution,
  HomonymResolution,
  PendingClarify,
  SemanticMatchInput,
  SemanticRankedCandidate,
  TraceStep,
} from '@chat-bot/shared-types';
import { normalizeText, tokenize, containsWord } from './normalize';
import { matchIntent } from './matcher';
import { buildClarifyOutput, resolveHomonym } from './homonym';
import type { HomonymEvaluation } from './homonym';
import { evaluateNode, rankNodes } from './node-matcher';
import type { EngineContext } from './node-matcher';
import { matchFaqEntry } from './faq';
import { advanceContextSession } from './context-session';
import { executeOutputs } from './outputs';
import type { DialogueIndex } from './dialogue-index';
import { judgeBand } from './semantic';
import { CLARIFY_TTL_MS, DEFAULT_FALLBACK_RESPONSE, EMPTY_INPUT_RESPONSE, HOP_LIMIT, MAX_INPUT_LENGTH, intentOnlyResponse } from './constants';
import type { ApiCallSuspension, ApiResumeState, ApiSuspensionRequest, CompletedFormInfo } from './api-call';

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
}

/** [No.26] `resolveResponse`/`resolveByNodeId`의 확장 반환 타입 — 정지 시 `apiCall`이 채워진다. */
export type EngineResolution = DialogueResolution & { apiCall?: ApiCallSuspension };

function textOutput(text: string): DialogOutput {
  return { type: 'TEXT', payload: { text } };
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
  const { input, normalizedInput, carry, nextSessionOverride, session, trace } = fc;
  const hopLimit = options.hopLimit ?? HOP_LIMIT;

  const fallbackNode = bundle.dialogNodes.find((n) => n.nodeType === 'FALLBACK' && n.enabled);
  if (fallbackNode) {
    trace.push({ stage: 'FALLBACK', code: 'FALLBACK_NODE', targetId: fallbackNode.id, targetName: fallbackNode.name });
    const execResult = executeOutputs(fallbackNode.outputs, bundle, now, {
      hopLimit: options.hopLimit,
      existingSession: session,
      sourceNodeId: fallbackNode.id,
      completedForm: fc.completedForm,
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
  };
}

/**
 * 대화 해석 파이프라인의 진입점(FR-E-2, ADR-0008). DB·NestJS 무의존 순수 함수이며 예외를 던지지 않는다.
 * 우선순위: S1 컨텍스트 세션 → S1.5 되묻기 해소(FR-E2-2) → S2 동음이의어 보정 → S3 DialogNode 매칭
 * → S4 FAQ → S5 의도 단독 → S6 폴백.
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
      };
    }

    trace.push({ stage: 'SESSION', code: 'SESSION_COMPLETED' });
    carry = advance.outputs;
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

  const node = options.index?.nodesById?.get(nodeId) ?? bundle.dialogNodes.find((n) => n.id === nodeId);

  if (node && node.enabled) {
    trace.push({ stage: 'NODE', code: 'NODE_BY_ID', targetId: node.id, targetName: node.name });
    const execResult = executeOutputs(node.outputs, bundle, now, {
      hopLimit: options.hopLimit,
      existingSession: session,
      sourceNodeId: node.id,
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
    };
  }

  trace.push({ stage: 'NODE', code: 'NODE_BY_ID_NOT_FOUND', targetId: nodeId });
  return resolveFallback(
    { input: inputLabel, normalizedInput, carry: [], nextSessionOverride: cancelledSession, session, trace },
    bundle,
    now,
    options,
  );
}
