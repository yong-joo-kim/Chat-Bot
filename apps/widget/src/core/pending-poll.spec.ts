import { describe, expect, it } from 'vitest';
import { createPendingPollConfig, decideNextPollAction, hasExceededHardLimit, nextPollDelayMs } from './pending-poll';

describe('widget core/pending-poll — PENDING 폴링 순수 로직(FR-N2-38/39)', () => {
  it('최초 대기는 서버 지정 pollAfterMs, 이후는 고정 1.5초 간격이다', () => {
    const config = createPendingPollConfig(1200);
    expect(nextPollDelayMs(0, config)).toBe(1200);
    expect(nextPollDelayMs(1, config)).toBe(1500);
    expect(nextPollDelayMs(2, config)).toBe(1500);
  });

  it('서버가 유효하지 않은 pollAfterMs(0 이하)를 주면 기본 간격으로 폴백한다', () => {
    const config = createPendingPollConfig(0);
    expect(config.initialDelayMs).toBe(1500);
  });

  it('90초 하드 상한을 넘기면 초과로 판정한다', () => {
    const config = createPendingPollConfig(1200);
    expect(hasExceededHardLimit(0, 89_000, config)).toBe(false);
    expect(hasExceededHardLimit(0, 90_000, config)).toBe(true);
  });

  it('READY/FAILED/EXPIRED는 즉시 폴링을 중단한다', () => {
    const config = createPendingPollConfig(1200);
    expect(decideNextPollAction({ kind: 'READY' }, 5000, config)).toEqual({ action: 'STOP', reason: 'READY' });
    expect(decideNextPollAction({ kind: 'FAILED' }, 5000, config)).toEqual({ action: 'STOP', reason: 'FAILED' });
    expect(decideNextPollAction({ kind: 'EXPIRED' }, 5000, config)).toEqual({ action: 'STOP', reason: 'EXPIRED' });
  });

  it('PENDING과 네트워크 오류는 하드 상한 전까지 계속 진행한다', () => {
    const config = createPendingPollConfig(1200);
    expect(decideNextPollAction({ kind: 'PENDING' }, 5000, config)).toEqual({ action: 'CONTINUE' });
    expect(decideNextPollAction({ kind: 'NETWORK_ERROR' }, 5000, config)).toEqual({ action: 'CONTINUE' });
  });

  it('경과시간이 90초를 넘으면 결과와 무관하게 TIMEOUT으로 중단한다', () => {
    const config = createPendingPollConfig(1200);
    expect(decideNextPollAction({ kind: 'PENDING' }, 90_000, config)).toEqual({ action: 'STOP', reason: 'TIMEOUT' });
  });
});
