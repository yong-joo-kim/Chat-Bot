import { nextMissingState } from './missing-detect';

const base = { missingStreak: 0, state: 'ACTIVE' as const, cleanupReason: null };

describe('nextMissingState', () => {
  it('SEEN_OK는 streak을 0으로 초기화한다', () => {
    const result = nextMissingState({ ...base, missingStreak: 1 }, 'SEEN_OK', { everIngested: true, countable: true });
    expect(result).toEqual({ missingStreak: 0, state: 'ACTIVE', cleanupReason: null });
  });

  it('GONE_HTTP 1회는 아직 GONE이 아니다', () => {
    const result = nextMissingState(base, 'GONE_HTTP', { everIngested: true, countable: true });
    expect(result.missingStreak).toBe(1);
    expect(result.state).toBe('ACTIVE');
  });

  it('GONE_HTTP 연속 2회면 GONE — 적재된 적 있으면 cleanupReason=GONE', () => {
    const result = nextMissingState({ ...base, missingStreak: 1 }, 'GONE_HTTP', { everIngested: true, countable: true });
    expect(result.state).toBe('GONE');
    expect(result.cleanupReason).toBe('GONE');
  });

  it('적재된 적 없으면 GONE이어도 cleanupReason은 null이다', () => {
    const result = nextMissingState({ ...base, missingStreak: 1 }, 'GONE_HTTP', { everIngested: false, countable: true });
    expect(result.state).toBe('GONE');
    expect(result.cleanupReason).toBeNull();
  });

  it('TRANSIENT(5xx·타임아웃)는 삭제로 세지 않는다', () => {
    const result = nextMissingState({ ...base, missingStreak: 1 }, 'TRANSIENT', { everIngested: true, countable: true });
    expect(result).toEqual({ ...base, missingStreak: 1 });
  });

  it('countable=false(PREVIEW·상한 도달·중단 호스트)면 세지 않는다', () => {
    const result = nextMissingState(base, 'GONE_HTTP', { everIngested: true, countable: false });
    expect(result).toEqual(base);
  });

  it('ROBOTS_BLOCKED는 EXCLUDED로 표시한다', () => {
    const result = nextMissingState(base, 'ROBOTS_BLOCKED', { everIngested: true, countable: true });
    expect(result.state).toBe('EXCLUDED');
    expect(result.cleanupReason).toBe('ROBOTS_DISALLOWED');
  });
});
