import type { HandoffPollResponse, PublicHandoffState } from '@chat-bot/shared-types';

/**
 * 상담 전용 짧은 폴링 순수 로직(DOM·fetch 무의존, ADR-0036 §2·§14). `ui/app.ts`가 이 값들을 참고해
 * 실제 `setTimeout`/`fetch` 부수효과를 수행한다(`core/pending-poll.ts`와 같은 분리 원칙).
 *
 * 상태 전이(§4.4):
 *   (기본, IDLE) --이번 턴 미응답(watch 수신)--> WATCHING(최대 3분, 새 미응답마다 연장)
 *   WATCHING --폴링 응답 status='CONNECTED'(token 수신)--> CONNECTED(3초 폴링)
 *   CONNECTED --status='ENDED' 또는 pollAfterMs=null--> (ENDED, 폴링 중단 → 호출부가 IDLE로 리셋)
 */
export type HandoffPollMode = 'IDLE' | 'WATCHING' | 'CONNECTED' | 'ENDED';

export interface HandoffPollState {
  mode: HandoffPollMode;
  /** 새 폴링 루프를 시작할 때마다 증가한다 — 폐기된 이전 루프가 계속 도는 것을 막는다(EX-N2-11과 동일 패턴). */
  generation: number;
  /** 다음 폴링의 `after` 쿼리 값(서버가 훑은 최대 seq). */
  cursor: number;
  token?: string;
  /** 관찰 창 만료 시각(ms epoch) — `WATCHING`일 때만 의미가 있다. */
  watchUntil?: number;
  /** 서버가 마지막으로 지정한 폴링 간격(ms). `null`이면 폴링 중단(`ENDED`). */
  serverPollAfterMs?: number | null;
  /** `IF_PENDING_FAILS` 트리거 보류 — 보류 답변(PENDING) 폴링 결과를 기다리는 중이다(§5.5). */
  pendingWatch?: { windowMs: number; pollAfterMs: number };
  consecutiveFailures: number;
  firstFailureAt?: number;
}

export function createHandoffPollState(): HandoffPollState {
  return { mode: 'IDLE', generation: 0, cursor: 0, consecutiveFailures: 0 };
}

/** 새 폴링 루프를 시작할 때 호출한다 — 이전 루프가 이 값과 다른 세대를 보면 스스로 멈춘다. */
export function bumpGeneration(state: HandoffPollState): HandoffPollState {
  return { ...state, generation: state.generation + 1 };
}

/**
 * 전송 응답(`POST …/messages`)의 `handoff` 조각을 반영한다(§5.3 G-2/G-4/G-5/G-7, §5.5 관찰 창).
 * `handoff` 필드 자체가 없으면(상담 꺼진 챗봇 등) 상태를 바꾸지 않는다 — 바이트 동일 원칙의 위젯 측 반영.
 */
export function onSendResponse(state: HandoffPollState, handoff: PublicHandoffState | undefined, now: number): HandoffPollState {
  if (!handoff) return state;
  if (handoff.status === 'CONNECTED') {
    return {
      ...state,
      mode: 'CONNECTED',
      token: handoff.token ?? state.token,
      serverPollAfterMs: handoff.pollAfterMs ?? state.serverPollAfterMs,
      pendingWatch: undefined,
      watchUntil: undefined,
      consecutiveFailures: 0,
      firstFailureAt: undefined,
    };
  }
  if (handoff.status === 'ENDED') {
    return { ...state, mode: 'ENDED', serverPollAfterMs: handoff.pollAfterMs ?? 0, pendingWatch: undefined, watchUntil: undefined };
  }
  // status === 'NONE'
  if (handoff.watch) {
    if (handoff.watch.trigger === 'NOW') {
      return {
        ...state,
        mode: state.mode === 'CONNECTED' ? state.mode : 'WATCHING',
        watchUntil: now + handoff.watch.windowMs,
        serverPollAfterMs: handoff.watch.pollAfterMs,
        pendingWatch: undefined,
      };
    }
    // IF_PENDING_FAILS — 보류 답변 폴링이 실패로 끝날 때만 관찰 창을 연다(onPendingResult).
    return { ...state, pendingWatch: { windowMs: handoff.watch.windowMs, pollAfterMs: handoff.watch.pollAfterMs } };
  }
  return state;
}

/**
 * 보류 답변(PENDING, ADR-0023) 폴링 결과를 반영한다 — `FAILED`/`EXPIRED`/`TIMEOUT`일 때만 관찰 창을 연다
 * (`READY`면 보류만 해제한다). 보류가 없으면 아무 것도 하지 않는다.
 */
export function onPendingResult(
  state: HandoffPollState,
  reason: 'READY' | 'FAILED' | 'EXPIRED' | 'TIMEOUT',
  now: number,
): HandoffPollState {
  const pending = state.pendingWatch;
  if (!pending) return state;
  if (reason === 'READY') {
    return { ...state, pendingWatch: undefined };
  }
  return {
    ...state,
    mode: state.mode === 'CONNECTED' ? state.mode : 'WATCHING',
    watchUntil: now + pending.windowMs,
    serverPollAfterMs: pending.pollAfterMs,
    pendingWatch: undefined,
  };
}

const CONNECTED_INTERVAL_MS = 3000;
const WATCH_INTERVAL_MS = 5000;
const HIDDEN_INTERVAL_MS = 15000;

/** 다음 폴링까지 대기할 시간(ms) — 서버 지정값 우선, 없으면 모드·가시성 기반 기본값(§14.1/§14.4). */
export function nextDelayMs(state: HandoffPollState, visibility: 'visible' | 'hidden'): number {
  if (visibility === 'hidden') {
    return Math.max(state.serverPollAfterMs ?? 0, HIDDEN_INTERVAL_MS);
  }
  if (typeof state.serverPollAfterMs === 'number' && state.serverPollAfterMs > 0) return state.serverPollAfterMs;
  return state.mode === 'CONNECTED' ? CONNECTED_INTERVAL_MS : WATCH_INTERVAL_MS;
}

/** 지금 폴링을 계속해야 하는지(관찰 창 만료 여부 포함). */
export function shouldPoll(state: HandoffPollState, now: number): boolean {
  if (state.mode === 'CONNECTED') return true;
  if (state.mode === 'WATCHING') return state.watchUntil !== undefined && now < state.watchUntil;
  return false;
}

export type HandoffPollOutcome = { action: 'CONTINUE'; state: HandoffPollState } | { action: 'STOP'; state: HandoffPollState };

/**
 * 상담 폴링 응답(`GET …/handoff`) 1회를 상태에 반영한다. `seq` 중복 제거는 서버가 `after` 커서로
 * 이미 걸러 보내므로(§7.2) 여기서는 커서 전진·모드 전이·중단 판정만 한다.
 */
export function onPollResponse(state: HandoffPollState, res: HandoffPollResponse, now: number): HandoffPollOutcome {
  const nextState: HandoffPollState = {
    ...state,
    cursor: Math.max(state.cursor, res.cursor),
    token: res.token ?? state.token,
    mode: res.status === 'CONNECTED' ? 'CONNECTED' : res.status === 'ENDED' ? 'ENDED' : state.mode,
    serverPollAfterMs: res.pollAfterMs,
    consecutiveFailures: 0,
    firstFailureAt: undefined,
  };
  if (res.pollAfterMs === null || res.status === 'ENDED') {
    return { action: 'STOP', state: { ...nextState, mode: 'ENDED' } };
  }
  if (res.status === 'NONE' && nextState.mode === 'WATCHING' && !shouldPoll(nextState, now)) {
    return { action: 'STOP', state: { ...nextState, mode: 'IDLE' } };
  }
  return { action: 'CONTINUE', state: nextState };
}

const UNSTABLE_THRESHOLD_MS = 30_000;

/** 폴링 요청 자체가 실패(네트워크 오류)했을 때 호출한다 — 같은 간격으로 재시도한다(중단하지 않음). */
export function onPollFailure(state: HandoffPollState, now: number): HandoffPollState {
  return { ...state, consecutiveFailures: state.consecutiveFailures + 1, firstFailureAt: state.firstFailureAt ?? now };
}

/** `429 RATE_LIMITED` 백오프 간격(세션당 40/분 한도 — 다음 폴링을 이 간격만큼 늦춘다). */
export const RATE_LIMIT_BACKOFF_MS = 10_000;

/** 429(RATE_LIMITED) 수신 시 호출한다 — 실패로도 집계하되 다음 간격을 강제로 늘린다(백오프). */
export function onPollRateLimited(state: HandoffPollState, now: number): HandoffPollState {
  return { ...onPollFailure(state, now), serverPollAfterMs: RATE_LIMIT_BACKOFF_MS };
}

/** 30초 연속 실패 여부(§3.2 `PollingStaleBanner`와 같은 원칙 — 위젯은 상태 영역 문구로 알린다). */
export function isPollingUnstable(state: HandoffPollState, now: number): boolean {
  return state.consecutiveFailures > 0 && state.firstFailureAt !== undefined && now - state.firstFailureAt >= UNSTABLE_THRESHOLD_MS;
}
