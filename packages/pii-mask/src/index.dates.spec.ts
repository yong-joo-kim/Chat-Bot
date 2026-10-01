import { maskPii } from './index';

/**
 * [L-5] 저장 마스킹 날짜 판정 표(pm-decisions-2026-10-01-설계 §5.2 — 입력 × v1 × v2). v1은 `preserveDates:false`,
 * v2는 기본 호출이다. 기대값은 설계 표에서 옮겼다(구현 출력 아님).
 */
const A = '[계좌번호]';

const TABLE: ReadonlyArray<readonly [string, string, string]> = [
  // [입력, v1(구 동작), v2(기본)]
  ['2026-09-30', A, '2026-09-30'],
  ['[2000-01-01]', `[${A}]`, '[2000-01-01]'],
  ['2026-09-30에', `${A}에`, '2026-09-30에'],
  ['2026-09-30T10:00', `${A}T10:00`, '2026-09-30T10:00'],
  ['2026-09-30~2026-10-01', `${A}~${A}`, '2026-09-30~2026-10-01'],
  ['2026-13-01', A, A],
  ['2026-00-10', A, A],
  ['2026-09-32', A, A],
  ['1899-01-01', A, A],
  ['2100-01-01', A, A],
  ['12026-09-30', A, A],
  ['x-2026-09-30', `x-${A}`, `x-${A}`],
  ['2026-09-30-12', A, A],
  ['2026-09-30-', `${A}-`, `${A}-`],
  ['2026-09-30-2026-10-01', `${A}-10-01`, `${A}-10-01`],
  ['26-09-30', A, A],
  ['2026.09.30', '2026.09.30', '2026.09.30'],
  ['2026/09/30', '2026/09/30', '2026/09/30'],
  ['2026년 9월 30일', '2026년 9월 30일', '2026년 9월 30일'],
  ['20260930', '20260930', '20260930'],
  ['2026-9-30', '2026-9-30', '2026-9-30'],
];

/** 날짜가 아닌 계좌·번호 모양 — 저장 결과가 구 동작(v1)과 같아야 한다(기대 문자열은 v1 출력과의 동일성으로만 본다). */
const NOT_DATES = ['110-234-567890', '1002-123-456789', '3333-01-1234567', '110-234-567890-12', '010-1234-5678 110-234-567890'];

describe('maskPii 날짜 제외 표(L-5)', () => {
  it.each(['PARTIAL', 'FULL'] as const)('%s: 날짜가 아닌 번호 모양은 v1과 같다', (mode) => {
    for (const input of NOT_DATES) expect({ input, r: maskPii(input, { mode }) }).toEqual({ input, r: maskPii(input, { mode, preserveDates: false }) });
    expect(maskPii('110-234-567890').maskedText).toBe(A);
  });

  it.each(['PARTIAL', 'FULL'] as const)('%s: 표의 모든 행(v1 열 = preserveDates:false · v2 열 = 기본)', (mode) => {
    for (const [input, v1, v2] of TABLE) {
      expect({ input, v1: maskPii(input, { mode, preserveDates: false }).maskedText }).toEqual({ input, v1 });
      expect({ input, v2: maskPii(input, { mode }).maskedText }).toEqual({ input, v2 });
    }
  });

  it('counts.account는 가린 구간만 센다', () => {
    expect(maskPii('2026-09-30').counts.account).toBe(0);
    expect(maskPii('2026-09-30', { preserveDates: false }).counts.account).toBe(1);
    expect(maskPii('2026-09-30 계좌 110-234-567890').counts.account).toBe(1);
    expect(maskPii('2026-09-30~2026-10-01').counts.account).toBe(0);
  });

  it('preserveDates:true 명시는 기본과 같다', () => {
    for (const [input] of TABLE) expect(maskPii(input, { preserveDates: true })).toEqual(maskPii(input));
  });

  it('사설 영역 문자가 든 입력 + kinds + preserveDates 생략이어도 날짜 보호·문맥 예외·5종 가림이 유지된다(K-11 폴백)', () => {
    const r = maskPii(' 2026-09-30 생일 1990-05-12 901231-1234567', { kinds: ['account'] });
    expect(r.maskedText).toBe(` 2026-09-30 생일 ${A} [주민등록번호]`);
    expect(r.counts.account).toBe(1);
    expect(r.counts.rrn).toBe(1);
  });

  it('PII_MASK_RULES_VERSION은 2다', async () => {
    const mod = await import('./index');
    expect(mod.PII_MASK_RULES_VERSION).toBe(2);
  });
});
