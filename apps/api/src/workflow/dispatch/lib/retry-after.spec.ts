import { parseRetryAfterMs } from './retry-after';

describe('No.41 Retry-After 해석(AC-WF4-3)', () => {
  const now = new Date('2026-01-01T00:00:00Z');

  it('초 단위 숫자', () => {
    expect(parseRetryAfterMs('120', now)).toBe(120_000);
  });

  it('HTTP-date(미래)', () => {
    const future = new Date(now.getTime() + 60_000).toUTCString();
    expect(parseRetryAfterMs(future, now)).toBe(60_000);
  });

  it('상한 2시간 초과는 2시간으로 절단', () => {
    expect(parseRetryAfterMs(String(3 * 3600), now)).toBe(2 * 3600 * 1000);
  });

  it('과거 날짜는 null(백오프로 대체)', () => {
    const past = new Date(now.getTime() - 60_000).toUTCString();
    expect(parseRetryAfterMs(past, now)).toBeNull();
  });

  it('파싱 실패는 null', () => {
    expect(parseRetryAfterMs('not-a-value', now)).toBeNull();
  });

  it('값 없음은 null', () => {
    expect(parseRetryAfterMs(undefined, now)).toBeNull();
  });

  it('0 이하 초는 null', () => {
    expect(parseRetryAfterMs('0', now)).toBeNull();
    expect(parseRetryAfterMs('-5', now)).toBeNull();
  });
});
