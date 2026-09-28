import { KbRagCallLimiter } from './kb-rag-call-limiter';

describe('KbRagCallLimiter — 항목④ 토큰 버킷(KB_RAG_CALLS_PER_MIN)', () => {
  it('한도 이내면 계속 허용한다', () => {
    const limiter = new KbRagCallLimiter(3);
    const now = new Date();
    expect(limiter.tryAcquire(now)).toBe(true);
    expect(limiter.tryAcquire(now)).toBe(true);
    expect(limiter.tryAcquire(now)).toBe(true);
  });

  it('한도를 넘으면 이번 창에서는 거부한다', () => {
    const limiter = new KbRagCallLimiter(2);
    const now = new Date();
    expect(limiter.tryAcquire(now)).toBe(true);
    expect(limiter.tryAcquire(now)).toBe(true);
    expect(limiter.tryAcquire(now)).toBe(false);
  });

  it('60초가 지나면 다시 허용한다(슬라이딩 윈도)', () => {
    const limiter = new KbRagCallLimiter(1);
    const t0 = new Date('2026-01-01T00:00:00.000Z');
    expect(limiter.tryAcquire(t0)).toBe(true);
    expect(limiter.tryAcquire(new Date(t0.getTime() + 59_000))).toBe(false);
    expect(limiter.tryAcquire(new Date(t0.getTime() + 60_001))).toBe(true);
  });

  it('오래된 호출만큼 창에서 밀려나 다시 허용된다(부분 회복)', () => {
    const limiter = new KbRagCallLimiter(2);
    const t0 = new Date('2026-01-01T00:00:00.000Z');
    expect(limiter.tryAcquire(t0)).toBe(true);
    expect(limiter.tryAcquire(new Date(t0.getTime() + 1_000))).toBe(true);
    expect(limiter.tryAcquire(new Date(t0.getTime() + 2_000))).toBe(false);
    // t0 호출이 창(60초) 밖으로 밀려나면 1자리가 회복된다.
    expect(limiter.tryAcquire(new Date(t0.getTime() + 60_001))).toBe(true);
    expect(limiter.tryAcquire(new Date(t0.getTime() + 60_002))).toBe(false);
  });
});
