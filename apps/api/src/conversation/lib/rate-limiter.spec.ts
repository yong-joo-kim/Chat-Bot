import { consume } from './rate-limiter';

describe('consume — 고정 윈도 카운터(DD-23)', () => {
  it('첫 요청은 항상 허용되고 카운트 1로 시작한다', () => {
    const result = consume(undefined, 0, 5, 60_000);
    expect(result.allowed).toBe(true);
    expect(result.entry.count).toBe(1);
  });

  it('한도 이내면 계속 허용된다', () => {
    let entry = consume(undefined, 0, 3, 60_000).entry;
    entry = consume(entry, 1000, 3, 60_000).entry;
    const third = consume(entry, 2000, 3, 60_000);
    expect(third.allowed).toBe(true);
    expect(third.entry.count).toBe(3);
  });

  it('한도를 초과하면 거부되고 retryAfterSec이 계산된다', () => {
    let entry = consume(undefined, 0, 2, 60_000).entry;
    entry = consume(entry, 1000, 2, 60_000).entry;
    const blocked = consume(entry, 2000, 2, 60_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
  });

  it('윈도가 지나면 카운트가 리셋된다', () => {
    const entry = consume(undefined, 0, 1, 60_000).entry;
    const blocked = consume(entry, 1000, 1, 60_000);
    expect(blocked.allowed).toBe(false);

    const afterWindow = consume(entry, 61_000, 1, 60_000);
    expect(afterWindow.allowed).toBe(true);
    expect(afterWindow.entry.count).toBe(1);
  });
});
