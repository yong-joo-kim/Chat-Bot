import { maskPii } from './index';

/**
 * [L-5] 생년월일 문맥 판정 성능 — 정규식 역추적 없는 고정 창(32글자) 선형 스캔이므로 날짜 수에 선형이어야 한다.
 * 상한은 CI 흔들림을 감안해 느슨하게 잡는다(실측은 수십 ms).
 */
describe('maskPii 생년월일 문맥 판정 성능(L-5)', () => {
  it('날짜 1만 개 · 모든 날짜 앞이 긴 글자 연속인 20만 글자 입력이 선형 범위 안에서 끝난다', () => {
    const unit = `${'가'.repeat(9)} 2026-09-30 `; // 글자 연속 9 + 공백 + 날짜 + 공백 = 21자 안팎
    const input = unit.repeat(10_000);
    expect(input.length).toBeGreaterThan(200_000);
    const t0 = Date.now();
    const r = maskPii(input);
    const elapsed = Date.now() - t0;
    expect(r.counts.account).toBe(0);
    expect(r.maskedText).toBe(input);
    expect(elapsed).toBeLessThan(3000);
  });

  it('날짜 앞이 긴 글자 연속(키워드 접두 반복)이어도 날짜당 상수 시간이다', () => {
    const input = `${'생일'.repeat(100_000)} 1990-05-12`;
    const t0 = Date.now();
    const r = maskPii(input);
    expect(Date.now() - t0).toBeLessThan(3000);
    // 낱말이 '생일생일…'(창 32글자 안에서 접미 30자)이라 허용치 초과 → 날짜 그대로.
    expect(r.counts.account).toBe(0);
  });

  it('2차 — 주석·구분 문자·보이지 않는 문자가 반복된 최악 입력(날짜 1만 개)도 선형 범위 안에서 끝난다', () => {
    const unit = `생일(양력) :/\u200B\u200B- 2026-09-30 ${'a'.repeat(8)} `;
    const input = unit.repeat(10_000);
    const t0 = Date.now();
    const r = maskPii(input);
    expect(Date.now() - t0).toBeLessThan(5000);
    expect(r.counts.account).toBe(10_000); // 모두 생년월일 문맥(주석 1개 + 구분 문자 ≤6)이라 가려진다.
  });

  it('구분 문자·숫자가 길게 이어진 병적 입력도 끝난다', () => {
    // (이메일 정규식 자체가 '1-1-1-…' 같은 입력에서 2차 시간이 걸리는 기존 한계가 있어 숫자-하이픈 반복은 쓰지 않는다 — 이 시험은 문맥 판정 비용만 본다.)
    const input = '가:'.repeat(100_000) + ' ::::::: ' + '2026-09-30 '.repeat(5_000);
    const t0 = Date.now();
    maskPii(input);
    expect(Date.now() - t0).toBeLessThan(5000);
  });
});
