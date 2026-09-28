import { parseRetryAfterMs } from './retry-after';

describe('parseRetryAfterMs', () => {
  it('초 단위 숫자를 ms로 변환한다', () => {
    expect(parseRetryAfterMs('5', new Date())).toBe(5000);
  });
  it('HTTP-date(미래)는 now와의 차이를 ms로 반환한다', () => {
    const now = new Date();
    const future = new Date(now.getTime() + 10_000);
    expect(parseRetryAfterMs(future.toUTCString(), now)).toBeGreaterThan(9000);
  });
  it('과거 날짜·0 이하·파싱 불가는 null', () => {
    const now = new Date();
    expect(parseRetryAfterMs('0', now)).toBeNull();
    expect(parseRetryAfterMs('-1', now)).toBeNull();
    expect(parseRetryAfterMs('not-a-date', now)).toBeNull();
    expect(parseRetryAfterMs(new Date(now.getTime() - 10_000).toUTCString(), now)).toBeNull();
  });
  it('값이 없으면 null', () => {
    expect(parseRetryAfterMs(undefined, new Date())).toBeNull();
    expect(parseRetryAfterMs(null, new Date())).toBeNull();
  });
  it('상한(30분)을 넘으면 잘라낸다', () => {
    expect(parseRetryAfterMs(String(3600), new Date())).toBe(30 * 60 * 1000);
  });
});
