import {
  ConversationStateSchema,
  type ContextSessionState,
  type DialogueBundle,
  type PendingClarify,
  type StateDiscardReason,
} from '@chat-bot/shared-types';
import {
  CLARIFY_TTL_MS,
  STATE_FUTURE_TOLERANCE_MS,
  STATE_MAX_AGE_MS,
  STATE_MAX_BYTES,
  STATE_MAX_FILLED_VALUE_KEYS,
  STATE_MAX_FILLED_VALUE_LENGTH,
} from './constants';

export interface SanitizeConversationStateOptions {
  stateMaxAgeMs?: number;
  clarifyTtlMs?: number;
}

export interface SanitizeConversationStateResult {
  contextSession: ContextSessionState | null;
  pendingClarify: PendingClarify | null;
  /** 폐기 사유 전수(§7.4). 빈 배열이면 원본 그대로 신뢰했다는 뜻이다. */
  discarded: StateDiscardReason[];
}

/**
 * 클라이언트가 보관한 대화 상태 봉투를 재검증한다(FR-10-4, NFR-S5, §7.4).
 * `resolveTurn`이 항상 첫 줄에서 호출한다 — `state`를 신뢰 가능한 선택 단계로 두지 않고
 * 항상 sanitize를 강제해 검증 누락을 구조적으로 불가능하게 만든다.
 * 어떤 검사도 예외를 던지지 않으며, 실패는 전부 "폐기 + 새 대화"로 귀결한다.
 */
export function sanitizeConversationState(
  raw: unknown,
  bundle: DialogueBundle,
  now: Date,
  options: SanitizeConversationStateOptions = {},
): SanitizeConversationStateResult {
  const discarded: StateDiscardReason[] = [];

  // 최초 턴은 보관된 상태가 없어 `state`가 비어 있는 것이 정상이다(첫 대화) — 이건 "손상"이 아니므로
  // 폐기 사유를 남기지 않는다. 실제로 값이 있는데 형태가 잘못된 경우만 INVALID_SCHEMA로 취급한다.
  if (raw === undefined || raw === null) {
    return { contextSession: null, pendingClarify: null, discarded };
  }

  const parsed = ConversationStateSchema.safeParse(raw);
  if (!parsed.success) {
    discarded.push('INVALID_SCHEMA');
    return { contextSession: null, pendingClarify: null, discarded };
  }

  const state = parsed.data;
  // `z.literal(CONVERSATION_STATE_VERSION)`가 이미 버전 불일치를 스키마 실패로 처리하므로
  // 이 분기는 도달하지 않지만, 향후 버전이 늘어날 때를 대비해 방어적으로 남겨둔다.
  if ((state.version as number) !== 1) {
    discarded.push('VERSION_MISMATCH');
    return { contextSession: null, pendingClarify: null, discarded };
  }

  let contextSession: ContextSessionState | null = state.contextSession ?? null;
  let pendingClarify: PendingClarify | null = state.pendingClarify ?? null;

  if (contextSession) {
    // 정확한 UTF-8 바이트 수 대신 직렬화 문자열 길이로 근사한다(엔진은 Node/DOM lib 무의존, §7.1).
    // 한글 등 멀티바이트 문자에서는 실제 바이트 수보다 작게 잡히므로 상한을 보수적으로 다룬다는 뜻이다.
    const size = JSON.stringify(contextSession).length;
    const keys = Object.keys(contextSession.filledValues);
    const oversized =
      size > STATE_MAX_BYTES ||
      keys.length > STATE_MAX_FILLED_VALUE_KEYS ||
      keys.some((k) => (contextSession as ContextSessionState).filledValues[k].length > STATE_MAX_FILLED_VALUE_LENGTH);
    if (oversized) {
      discarded.push('OVERSIZED');
      contextSession = null;
    }
  }

  if (contextSession) {
    const known = bundle.contexts.some((c) => c.id === (contextSession as ContextSessionState).contextVariableId);
    if (!known) {
      discarded.push('UNKNOWN_CONTEXT');
      contextSession = null;
    }
  }

  if (contextSession) {
    const stateMaxAgeMs = options.stateMaxAgeMs ?? STATE_MAX_AGE_MS;
    const startedAt = contextSession.startedAt.getTime();
    const nowMs = now.getTime();
    const isFuture = startedAt > nowMs + STATE_FUTURE_TOLERANCE_MS;
    const isTooOld = nowMs - startedAt > stateMaxAgeMs;
    if (isFuture || isTooOld) {
      discarded.push('SESSION_EXPIRED');
      contextSession = null;
    }
  }

  if (contextSession && contextSession.lastInteractedAt.getTime() > now.getTime()) {
    // 폐기가 아니라 보정이다(§7.4 규칙 6).
    contextSession = { ...contextSession, lastInteractedAt: now };
  }

  if (pendingClarify) {
    const known = bundle.homonyms.some((h) => h.id === (pendingClarify as PendingClarify).homonymId);
    if (!known) {
      discarded.push('UNKNOWN_HOMONYM');
      pendingClarify = null;
    }
  }

  if (pendingClarify) {
    const clarifyTtlMs = options.clarifyTtlMs ?? CLARIFY_TTL_MS;
    if (now.getTime() - pendingClarify.askedAt.getTime() > clarifyTtlMs) {
      discarded.push('CLARIFY_EXPIRED');
      pendingClarify = null;
    }
  }

  return { contextSession, pendingClarify, discarded };
}
