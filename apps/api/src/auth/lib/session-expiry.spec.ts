import { computeInitialExpiry, isSessionValid, nextSlidingExpiry, shouldRefresh } from './session-expiry';

describe('computeInitialExpiry', () => {
  it('유휴/절대 만료 시각을 각각 분/시간 단위로 계산한다', () => {
    const now = new Date('2026-09-21T00:00:00.000Z');
    const { expiresAt, absoluteExpiresAt } = computeInitialExpiry(now, 120, 12);
    expect(expiresAt.getTime() - now.getTime()).toBe(120 * 60_000);
    expect(absoluteExpiresAt.getTime() - now.getTime()).toBe(12 * 3_600_000);
  });
});

describe('isSessionValid — AC-12A-6/7/8', () => {
  const base = {
    createdAt: new Date('2026-09-21T00:00:00.000Z'),
    expiresAt: new Date('2026-09-21T02:00:00.000Z'),
    absoluteExpiresAt: new Date('2026-09-21T12:00:00.000Z'),
    revokedAt: null,
  };

  it('만료 전이면 유효하다', () => {
    expect(isSessionValid(base, new Date('2026-09-21T01:00:00.000Z'))).toBe(true);
  });

  it('무효화된 세션은 즉시 무효다', () => {
    expect(isSessionValid({ ...base, revokedAt: new Date('2026-09-21T00:30:00.000Z') }, new Date('2026-09-21T01:00:00.000Z'))).toBe(false);
  });

  it('유휴 만료 시각이 지나면 무효다(AC-12A-7 슬라이딩 미적용 상태)', () => {
    expect(isSessionValid(base, new Date('2026-09-21T02:00:01.000Z'))).toBe(false);
  });

  it('절대 만료 시각이 지나면 무효다', () => {
    expect(isSessionValid(base, new Date('2026-09-21T12:00:01.000Z'))).toBe(false);
  });

  it('시계 역행(createdAt이 미래)이면 무효다(EX-12-10)', () => {
    expect(isSessionValid({ ...base, createdAt: new Date('2026-09-22T00:00:00.000Z') }, new Date('2026-09-21T01:00:00.000Z'))).toBe(false);
  });
});

describe('nextSlidingExpiry — AC-12A-7', () => {
  it('절대 만료를 넘지 않는다', () => {
    const now = new Date('2026-09-21T11:00:00.000Z');
    const absoluteExpiresAt = new Date('2026-09-21T12:00:00.000Z');
    const next = nextSlidingExpiry(now, 120, absoluteExpiresAt);
    expect(next.getTime()).toBe(absoluteExpiresAt.getTime());
  });

  it('절대 만료보다 이르면 유휴 만료를 그대로 적용한다', () => {
    const now = new Date('2026-09-21T01:00:00.000Z');
    const absoluteExpiresAt = new Date('2026-09-21T12:00:00.000Z');
    const next = nextSlidingExpiry(now, 120, absoluteExpiresAt);
    expect(next.getTime()).toBe(now.getTime() + 120 * 60_000);
  });
});

describe('shouldRefresh — §7.3 쓰기 증폭 방지', () => {
  it('idle/10 미만 경과 시 갱신하지 않는다', () => {
    const lastSeenAt = new Date('2026-09-21T00:00:00.000Z');
    const now = new Date('2026-09-21T00:05:00.000Z'); // 5분 경과, idle=120이면 12분 주기
    expect(shouldRefresh(lastSeenAt, now, 120)).toBe(false);
  });

  it('idle/10 이상 경과하면 갱신한다', () => {
    const lastSeenAt = new Date('2026-09-21T00:00:00.000Z');
    const now = new Date('2026-09-21T00:13:00.000Z');
    expect(shouldRefresh(lastSeenAt, now, 120)).toBe(true);
  });
});
