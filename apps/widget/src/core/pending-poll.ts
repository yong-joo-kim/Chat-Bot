/**
 * `pendingAnswer` 폴링 순수 로직(간격 계산·상한 판정·중단 처리) — DOM·fetch 무의존
 * (`nlu-rag-answering-ui-spec.md` §4.4.3, §9-6 `core/` → `ui/` 원칙). `ui/app.ts`가 이 값들을
 * 참고해 실제 `setTimeout`/`fetch` 부수효과를 수행한다.
 */
export interface PendingPollConfig {
  /** 최초 대기(서버 `pollAfterMs`, 기본 1,200ms). */
  initialDelayMs: number;
  /** 이후 폴링 간격(고정 1.5초). */
  intervalMs: number;
  /** 최초 전송 시점부터의 하드 상한(고정 90초). */
  hardLimitMs: number;
}

export const DEFAULT_PENDING_POLL_INTERVAL_MS = 1500;
export const DEFAULT_PENDING_POLL_HARD_LIMIT_MS = 90_000;

export function createPendingPollConfig(pollAfterMs: number): PendingPollConfig {
  return {
    initialDelayMs: pollAfterMs > 0 ? pollAfterMs : DEFAULT_PENDING_POLL_INTERVAL_MS,
    intervalMs: DEFAULT_PENDING_POLL_INTERVAL_MS,
    hardLimitMs: DEFAULT_PENDING_POLL_HARD_LIMIT_MS,
  };
}

/** `attempt`번째(0-based) 폴링까지 기다릴 시간. 최초 1회만 서버 지정 값, 이후 고정 간격이다. */
export function nextPollDelayMs(attempt: number, config: PendingPollConfig): number {
  return attempt === 0 ? config.initialDelayMs : config.intervalMs;
}

/** 최초 전송 시점(`startedAt`) 기준으로 하드 상한(90초)을 넘었는지 판정한다(로컬 판단, 서버 호출 없음). */
export function hasExceededHardLimit(startedAt: number, now: number, config: PendingPollConfig): boolean {
  return now - startedAt >= config.hardLimitMs;
}

export type PendingPollResultKind =
  | { kind: 'READY' }
  | { kind: 'FAILED' }
  | { kind: 'EXPIRED' } // 404 PENDING_ANSWER_NOT_FOUND 또는 status: 'EXPIRED'
  | { kind: 'PENDING' } // 계속 폴링
  | { kind: 'NETWORK_ERROR' }; // 폴링 요청 자체 실패 — 같은 간격으로 재시도(하드 상한까지)

export type PendingPollDecision =
  | { action: 'CONTINUE' }
  | { action: 'STOP'; reason: 'READY' | 'FAILED' | 'EXPIRED' | 'TIMEOUT' };

/**
 * 폴링 1회 시행 결과 + 경과시간으로 다음 행동을 결정한다(FR-N2-38/39, §4.4.3 표).
 * 네트워크 오류는 즉시 포기하지 않고 하드 상한까지 같은 간격으로 재시도한다.
 */
export function decideNextPollAction(result: PendingPollResultKind, elapsedMs: number, config: PendingPollConfig): PendingPollDecision {
  if (elapsedMs >= config.hardLimitMs) {
    return { action: 'STOP', reason: 'TIMEOUT' };
  }
  switch (result.kind) {
    case 'READY':
      return { action: 'STOP', reason: 'READY' };
    case 'FAILED':
      return { action: 'STOP', reason: 'FAILED' };
    case 'EXPIRED':
      return { action: 'STOP', reason: 'EXPIRED' };
    case 'PENDING':
    case 'NETWORK_ERROR':
    default:
      return { action: 'CONTINUE' };
  }
}
