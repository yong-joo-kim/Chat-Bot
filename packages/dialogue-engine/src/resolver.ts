import type { ContextSessionState, DialogOutput, DialogueBundle, DialogueResolution, TraceStep } from '@chat-bot/shared-types';
import { normalizeText, tokenize } from './normalize';
import { matchIntent } from './matcher';
import { buildClarifyOutput, resolveHomonym } from './homonym';
import { evaluateNode, rankNodes } from './node-matcher';
import type { EngineContext } from './node-matcher';
import { matchFaqEntry } from './faq';
import { advanceContextSession } from './context-session';
import { executeOutputs } from './outputs';
import type { DialogueIndex } from './dialogue-index';
import { DEFAULT_FALLBACK_RESPONSE, EMPTY_INPUT_RESPONSE, MAX_INPUT_LENGTH, intentOnlyResponse } from './constants';

export interface ResolveOptions {
  /** 사전 구축한 인덱스 재사용(FR-E-10). 미지정 시 내부적으로 원본 배열을 그대로 사용한다. */
  index?: DialogueIndex;
  hopLimit?: number;
  maxInputLength?: number;
  defaultFallbackText?: string;
}

function textOutput(text: string): DialogOutput {
  return { type: 'TEXT', payload: { text } };
}

/**
 * 대화 해석 파이프라인의 진입점(FR-E-2, ADR-0008). DB·NestJS 무의존 순수 함수이며 예외를 던지지 않는다.
 * 우선순위: ① 컨텍스트 세션 → ② 동음이의어 보정 → ③ DialogNode 매칭 → ④ FAQ → ⑤ 의도 단독 → ⑥ 폴백.
 */
export function resolveResponse(
  input: string,
  session: ContextSessionState | null,
  bundle: DialogueBundle,
  now: Date,
  options: ResolveOptions = {},
): DialogueResolution {
  const trace: TraceStep[] = [];
  const maxInputLength = options.maxInputLength ?? MAX_INPUT_LENGTH;

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

  // S1 — 컨텍스트 세션
  if (session && session.status === 'IN_PROGRESS') {
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
  }

  // S2 — 동음이의어 보정
  const homonymEval = resolveHomonym(norm, bundle.homonyms);
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
        unsupportedOutputs: [],
        trace,
      };
    }
  } else if (homonymEval.resolution?.status === 'IGNORED') {
    trace.push({ stage: 'HOMONYM', code: 'HOMONYM_IGNORED', targetId: homonymEval.homonymId });
  }

  const boostIntentIds =
    homonymEval.resolution?.status === 'RESOLVED' && homonymEval.resolution.intentId
      ? [homonymEval.resolution.intentId]
      : undefined;
  const intentMatch = matchIntent(raw, bundle.intents, { boostIntentIds, index: options.index });
  ctx.matchedIntentId = intentMatch?.intentId;

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

    const execResult = executeOutputs(node.outputs, bundle, now, { hopLimit: options.hopLimit, existingSession: session });
    trace.push(...execResult.trace);

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

  // S5 — 의도 단독
  if (ctx.matchedIntentId && intentMatch) {
    trace.push({ stage: 'INTENT', code: 'INTENT_ONLY', targetId: ctx.matchedIntentId });
    return {
      input,
      normalizedInput: norm,
      matchedIntentId: ctx.matchedIntentId,
      homonymResolution: homonymEval.resolution ?? undefined,
      outputs: [...carry, textOutput(intentOnlyResponse(ctx.matchedIntentId, intentMatch.matchedExample))],
      nextSession: nextSessionOverride ?? null,
      unsupportedOutputs: [],
      trace,
    };
  }

  // S6 — 폴백: FALLBACK 노드 → ERROR_RESPONSE FAQ → 기본 문구
  const fallbackNode = bundle.dialogNodes.find((n) => n.nodeType === 'FALLBACK' && n.enabled);
  if (fallbackNode) {
    trace.push({ stage: 'FALLBACK', code: 'FALLBACK_NODE', targetId: fallbackNode.id, targetName: fallbackNode.name });
    const execResult = executeOutputs(fallbackNode.outputs, bundle, now, { hopLimit: options.hopLimit, existingSession: session });
    trace.push(...execResult.trace);
    return {
      input,
      normalizedInput: norm,
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
      normalizedInput: norm,
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
    normalizedInput: norm,
    outputs: [...carry, textOutput(options.defaultFallbackText ?? DEFAULT_FALLBACK_RESPONSE)],
    nextSession: nextSessionOverride ?? null,
    unsupportedOutputs: [],
    trace,
  };
}
