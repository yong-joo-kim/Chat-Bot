import { throttleDelayMs } from './throttle-delay';

describe('throttleDelayMs (RG-4)', () => {
  const now = new Date('2026-09-28T00:00:00Z');
  it('Retry-After가 없으면 간격의 4배', () => {
    expect(throttleDelayMs(undefined, 500, now)).toBe(2000);
    expect(throttleDelayMs('', 1000, now)).toBe(4000);
  });
  it('Retry-After 초를 따른다(정상 간격 이상 · 최대 60초)', () => {
    expect(throttleDelayMs('7', 500, now)).toBe(7000);
    expect(throttleDelayMs('0', 500, now)).toBe(500); // 0초 → 정상 간격 아래로 내려가지 않는다.
    expect(throttleDelayMs('99999', 500, now)).toBe(60_000);
  });
  it('Retry-After HTTP 날짜를 따른다 · 과거·형식 오류는 간격×4', () => {
    expect(throttleDelayMs('Mon, 28 Sep 2026 00:00:10 GMT', 500, now)).toBe(10_000);
    expect(throttleDelayMs('Sun, 27 Sep 2026 00:00:00 GMT', 500, now)).toBe(500);
    expect(throttleDelayMs('곧', 500, now)).toBe(2000);
  });
  it('간격×4가 60초를 넘어도 60초로 자른다', () => {
    expect(throttleDelayMs(undefined, 20_000, now)).toBe(60_000);
  });
});
