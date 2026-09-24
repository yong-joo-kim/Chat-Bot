import { describe, expect, it } from 'vitest';
import type { HandoffPollResponse, PublicHandoffState } from '@chat-bot/shared-types';
import {
  createHandoffPollState,
  isPollingUnstable,
  nextDelayMs,
  onPendingResult,
  onPollFailure,
  onPollRateLimited,
  onPollResponse,
  onSendResponse,
  shouldPoll,
} from './handoff-poll';

describe('widget core/handoff-poll — 상담 전용 짧은 폴링 순수 로직(ADR-0036 §14)', () => {
  it('초기 상태는 IDLE이고 커서는 0이다', () => {
    const state = createHandoffPollState();
    expect(state.mode).toBe('IDLE');
    expect(state.cursor).toBe(0);
    expect(state.token).toBeUndefined();
  });

  describe('onSendResponse — 전송 응답의 handoff 조각 반영(§5.3)', () => {
    it('handoff 필드가 없으면 상태를 바꾸지 않는다(바이트 동일 원칙)', () => {
      const state = createHandoffPollState();
      const next = onSendResponse(state, undefined, Date.now());
      expect(next).toBe(state);
    });

    it('status=NONE + watch.trigger=NOW → 관찰 창(WATCHING)을 즉시 연다', () => {
      const state = createHandoffPollState();
      const handoff: PublicHandoffState = { status: 'NONE', watch: { windowMs: 180_000, pollAfterMs: 5000, trigger: 'NOW' } };
      const now = 1_000_000;
      const next = onSendResponse(state, handoff, now);
      expect(next.mode).toBe('WATCHING');
      expect(next.watchUntil).toBe(now + 180_000);
      expect(next.serverPollAfterMs).toBe(5000);
    });

    it('status=NONE + watch.trigger=IF_PENDING_FAILS → 즉시 열지 않고 보류만 기록한다', () => {
      const state = createHandoffPollState();
      const handoff: PublicHandoffState = { status: 'NONE', watch: { windowMs: 180_000, pollAfterMs: 5000, trigger: 'IF_PENDING_FAILS' } };
      const next = onSendResponse(state, handoff, Date.now());
      expect(next.mode).toBe('IDLE');
      expect(next.pendingWatch).toEqual({ windowMs: 180_000, pollAfterMs: 5000 });
    });

    it('status=CONNECTED(토큰 최초 수신, G-2) → CONNECTED로 전환하고 토큰을 저장한다', () => {
      const state = createHandoffPollState();
      const handoff: PublicHandoffState = { status: 'CONNECTED', token: 'tok-abc', pollAfterMs: 0 };
      const next = onSendResponse(state, handoff, Date.now());
      expect(next.mode).toBe('CONNECTED');
      expect(next.token).toBe('tok-abc');
    });

    it('status=CONNECTED(이후 턴, 토큰 없음) → 기존 토큰을 유지한다', () => {
      const state = { ...createHandoffPollState(), mode: 'CONNECTED' as const, token: 'tok-abc' };
      const handoff: PublicHandoffState = { status: 'CONNECTED', pollAfterMs: 3000 };
      const next = onSendResponse(state, handoff, Date.now());
      expect(next.token).toBe('tok-abc');
    });

    it('status=ENDED → ENDED로 전환한다(G-7)', () => {
      const state = { ...createHandoffPollState(), mode: 'CONNECTED' as const, token: 'tok-abc' };
      const handoff: PublicHandoffState = { status: 'ENDED', pollAfterMs: 0 };
      const next = onSendResponse(state, handoff, Date.now());
      expect(next.mode).toBe('ENDED');
    });
  });

  describe('onPendingResult — 보류 답변(PENDING) 결과 반영(§5.5)', () => {
    it('보류가 없으면 아무 것도 하지 않는다', () => {
      const state = createHandoffPollState();
      const next = onPendingResult(state, 'FAILED', Date.now());
      expect(next).toBe(state);
    });

    it('FAILED/EXPIRED/TIMEOUT이면 관찰 창을 연다', () => {
      const withPending = { ...createHandoffPollState(), pendingWatch: { windowMs: 180_000, pollAfterMs: 5000 } };
      for (const reason of ['FAILED', 'EXPIRED', 'TIMEOUT'] as const) {
        const now = 2_000_000;
        const next = onPendingResult(withPending, reason, now);
        expect(next.mode).toBe('WATCHING');
        expect(next.watchUntil).toBe(now + 180_000);
        expect(next.pendingWatch).toBeUndefined();
      }
    });

    it('READY면 보류만 해제하고 창을 열지 않는다', () => {
      const withPending = { ...createHandoffPollState(), pendingWatch: { windowMs: 180_000, pollAfterMs: 5000 } };
      const next = onPendingResult(withPending, 'READY', Date.now());
      expect(next.mode).toBe('IDLE');
      expect(next.pendingWatch).toBeUndefined();
    });

    it('이미 CONNECTED면 모드를 WATCHING으로 되돌리지 않는다', () => {
      const state = {
        ...createHandoffPollState(),
        mode: 'CONNECTED' as const,
        token: 'tok',
        pendingWatch: { windowMs: 180_000, pollAfterMs: 5000 },
      };
      const next = onPendingResult(state, 'FAILED', Date.now());
      expect(next.mode).toBe('CONNECTED');
    });
  });

  describe('nextDelayMs — 다음 폴링 간격(§14.1/§14.4)', () => {
    it('CONNECTED는 서버값이 없으면 3000ms', () => {
      const state = { ...createHandoffPollState(), mode: 'CONNECTED' as const };
      expect(nextDelayMs(state, 'visible')).toBe(3000);
    });

    it('WATCHING은 서버값이 없으면 5000ms', () => {
      const state = { ...createHandoffPollState(), mode: 'WATCHING' as const };
      expect(nextDelayMs(state, 'visible')).toBe(5000);
    });

    it('서버 pollAfterMs가 있으면 모드와 무관하게 그 값을 우선한다', () => {
      const state = { ...createHandoffPollState(), mode: 'CONNECTED' as const, serverPollAfterMs: 1234 };
      expect(nextDelayMs(state, 'visible')).toBe(1234);
    });

    it('탭이 숨겨지면 최소 15000ms로 늘어난다', () => {
      const state = { ...createHandoffPollState(), mode: 'CONNECTED' as const, serverPollAfterMs: 3000 };
      expect(nextDelayMs(state, 'hidden')).toBe(15000);
    });

    it('탭이 숨겨져도 서버가 더 긴 간격을 지정했으면 그 값을 쓴다', () => {
      const state = { ...createHandoffPollState(), mode: 'CONNECTED' as const, serverPollAfterMs: 20000 };
      expect(nextDelayMs(state, 'hidden')).toBe(20000);
    });
  });

  describe('shouldPoll — 계속 폴링해야 하는지(관찰 창 만료 포함)', () => {
    it('CONNECTED는 항상 계속한다', () => {
      expect(shouldPoll({ ...createHandoffPollState(), mode: 'CONNECTED' }, Date.now())).toBe(true);
    });
    it('WATCHING은 만료 전까지만 계속한다', () => {
      const state = { ...createHandoffPollState(), mode: 'WATCHING' as const, watchUntil: 1000 };
      expect(shouldPoll(state, 500)).toBe(true);
      expect(shouldPoll(state, 1500)).toBe(false);
    });
    it('IDLE/ENDED는 계속하지 않는다', () => {
      expect(shouldPoll(createHandoffPollState(), Date.now())).toBe(false);
      expect(shouldPoll({ ...createHandoffPollState(), mode: 'ENDED' }, Date.now())).toBe(false);
    });
  });

  describe('onPollResponse — 폴링 응답 1회 반영(§7.2)', () => {
    function res(overrides: Partial<HandoffPollResponse> = {}): HandoffPollResponse {
      return { status: 'CONNECTED', messages: [], cursor: 5, pollAfterMs: 3000, ...overrides };
    }

    it('커서를 전진시키고 CONTINUE를 반환한다', () => {
      const state = { ...createHandoffPollState(), mode: 'CONNECTED' as const, cursor: 2 };
      const outcome = onPollResponse(state, res({ cursor: 9 }), Date.now());
      expect(outcome.action).toBe('CONTINUE');
      expect(outcome.state.cursor).toBe(9);
    });

    it('커서는 뒤로 가지 않는다(응답이 더 작은 값을 주더라도 max 유지)', () => {
      const state = { ...createHandoffPollState(), mode: 'CONNECTED' as const, cursor: 20 };
      const outcome = onPollResponse(state, res({ cursor: 3 }), Date.now());
      expect(outcome.state.cursor).toBe(20);
    });

    it('status=ENDED면 STOP을 반환하고 모드를 ENDED로 만든다', () => {
      const state = { ...createHandoffPollState(), mode: 'CONNECTED' as const };
      const outcome = onPollResponse(state, res({ status: 'ENDED', pollAfterMs: null }), Date.now());
      expect(outcome.action).toBe('STOP');
      expect(outcome.state.mode).toBe('ENDED');
    });

    it('pollAfterMs=null이면 status와 무관하게 STOP이다', () => {
      const state = { ...createHandoffPollState(), mode: 'CONNECTED' as const };
      const outcome = onPollResponse(state, res({ status: 'CONNECTED', pollAfterMs: null }), Date.now());
      expect(outcome.action).toBe('STOP');
    });

    it('토큰을 최초 수신하면 저장한다(§6.2 폴링 경유 발급)', () => {
      const state = createHandoffPollState();
      const outcome = onPollResponse(state, res({ token: 'new-token' }), Date.now());
      expect(outcome.state.token).toBe('new-token');
    });

    it('WATCHING 중 status=NONE이고 관찰 창이 만료됐으면 STOP(IDLE)이다', () => {
      const now = 10_000;
      const state = { ...createHandoffPollState(), mode: 'WATCHING' as const, watchUntil: now - 1 };
      const outcome = onPollResponse(state, res({ status: 'NONE', pollAfterMs: 5000 }), now);
      expect(outcome.action).toBe('STOP');
      expect(outcome.state.mode).toBe('IDLE');
    });

    it('WATCHING 중 status=NONE이고 관찰 창이 아직 유효하면 CONTINUE다', () => {
      const now = 10_000;
      const state = { ...createHandoffPollState(), mode: 'WATCHING' as const, watchUntil: now + 5000 };
      const outcome = onPollResponse(state, res({ status: 'NONE', pollAfterMs: 5000 }), now);
      expect(outcome.action).toBe('CONTINUE');
    });
  });

  describe('실패·불안정 판정(§3.2 PollingStaleBanner와 같은 원칙)', () => {
    it('연속 실패가 30초 미만이면 불안정으로 보지 않는다', () => {
      const now = 1000;
      let state = onPollFailure(createHandoffPollState(), now);
      expect(isPollingUnstable(state, now + 29_000)).toBe(false);
    });

    it('연속 실패가 30초 이상이면 불안정으로 본다', () => {
      const now = 1000;
      const state = onPollFailure(createHandoffPollState(), now);
      expect(isPollingUnstable(state, now + 30_000)).toBe(true);
    });

    it('성공(onPollResponse)하면 실패 카운터가 초기화된다', () => {
      const failed = onPollFailure(createHandoffPollState(), 1000);
      const outcome = onPollResponse(failed, { status: 'CONNECTED', messages: [], cursor: 1, pollAfterMs: 3000 }, 5000);
      expect(outcome.state.consecutiveFailures).toBe(0);
    });

    it('429(RATE_LIMITED)는 실패로 집계하면서 다음 간격을 백오프시킨다', () => {
      const state = onPollRateLimited(createHandoffPollState(), 1000);
      expect(state.consecutiveFailures).toBe(1);
      expect(nextDelayMs(state, 'visible')).toBeGreaterThanOrEqual(10_000);
    });
  });
});
