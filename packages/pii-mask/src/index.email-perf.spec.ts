import { maskPii } from './index';

/**
 * [L-6] 이메일 탐지 성능 — 입력 길이에 선형이어야 한다. 입력마다 PARTIAL + FULL + `kinds` 5종을 3회 호출한 합계가
 * 3초 미만이다(구현 전 `'a'×1e6`은 수 분 — 시험 시간 상한 30초).
 */
const ALL = ['rrn', 'card', 'phone', 'account', 'email'] as const;

const INPUTS: Array<[string, () => string]> = [
  ["'a'×1e6 + 날짜", () => `${'a'.repeat(1_000_000)} 2026-09-30`],
  ["'a'×1e6 + '@'", () => `${'a'.repeat(1_000_000)}@`],
  ["'a@' + 'b'×1e6", () => `a@${'b'.repeat(1_000_000)}`],
  ["'x@y.com' + '1'×1e6", () => `x@y.com${'1'.repeat(1_000_000)}`],
  ["('x@y.com1')×1e5", () => 'x@y.com1'.repeat(100_000)],
  ["'.'×1e6", () => '.'.repeat(1_000_000)],
  ["('a.')×5e5", () => 'a.'.repeat(500_000)],
  ["'-'×1e6", () => '-'.repeat(1_000_000)],
  ["'@'×1e6", () => '@'.repeat(1_000_000)],
  ["('a@')×5e5", () => 'a@'.repeat(500_000)],
];

describe('maskPii 이메일 탐지 성능(L-6)', () => {
  it.each(INPUTS)('%s — 3초 미만', (_name, make) => {
    const input = make();
    const t0 = Date.now();
    maskPii(input, { mode: 'PARTIAL' });
    maskPii(input, { mode: 'FULL' });
    maskPii(input, { mode: 'PARTIAL', kinds: ALL });
    expect(Date.now() - t0).toBeLessThan(3000);
  }, 30_000);
});
