import {
  CONVERSATION_STATE_VERSION,
  type ButtonAction,
  type ConversationState,
  type DialogueBundle,
  type DialogueResolution,
  type StateDiscardReason,
  type TraceStep,
} from '@chat-bot/shared-types';
import { resolveResponse } from './resolver';
import type { ResolveOptions } from './resolver';
import { resolveByNodeId } from './resolver';
import { sanitizeConversationState } from './conversation-state';

export interface DialogueTurnInput {
  message?: string;
  buttonAction?: ButtonAction;
}

export interface DialogueTurnResult extends DialogueResolution {
  /** 다음 요청에 그대로 실어 보낼 봉투. 항상 non-null이다(빈 대화도 version만 담긴 봉투). */
  nextState: ConversationState;
  /** 수신 봉투에서 폐기된 항목의 사유. 관리자 API만 노출한다(NFR-S1). */
  stateDiscarded: StateDiscardReason[];
}

/**
 * 텍스트 입력과 NODE 버튼 액션을 분기해 `resolveResponse`/`resolveByNodeId`로 라우팅하는
 * 유일한 상태 인식 진입점(DD-26, ADR-0010). API의 3개 소비자(시뮬레이션/비교/공개 대화)는
 * 전부 이 함수만 호출한다 — 엔진 단일 경로 원칙(FR-0-19).
 * `state`는 검증 전 원본을 그대로 받는다 — 항상 내부에서 `sanitizeConversationState`를 수행하므로
 * 호출부가 검증을 빠뜨릴 수 없다(NFR-S5를 구조로 보장).
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

  let resolution: DialogueResolution;

  if (turn.buttonAction && turn.buttonAction.kind === 'NODE') {
    resolution = resolveByNodeId(turn.buttonAction.nodeId, sanitized.contextSession, bundle, now, {
      ...options,
      inputLabel: turn.buttonAction.label ?? '',
    });
  } else {
    const message = turn.buttonAction && turn.buttonAction.kind === 'MESSAGE' ? turn.buttonAction.text : (turn.message ?? '');
    resolution = resolveResponse(message, sanitized.contextSession, bundle, now, {
      ...options,
      pendingClarify: sanitized.pendingClarify,
    });
  }

  const stateTrace: TraceStep[] = sanitized.discarded.map((reason) => ({
    stage: 'PREPROCESS',
    code: 'STATE_DISCARDED',
    message: reason,
  }));
  const trace = stateTrace.length > 0 ? [...stateTrace, ...resolution.trace] : resolution.trace;

  const nextState: ConversationState = {
    version: CONVERSATION_STATE_VERSION,
    contextSession: resolution.nextSession ?? null,
    pendingClarify: resolution.pendingClarify ?? null,
  };

  return { ...resolution, trace, nextState, stateDiscarded: sanitized.discarded };
}
