import { maskPii } from './index';
import corpus from './__golden__/birth-context-corpus.json';

/**
 * [L-5, U-1] 생년월일 문맥 예외 — 손으로 작성한 골든(birth-context-corpus.json)으로 검증한다. 기대값은 규칙 표
 * (pm-decisions-2026-10-01-설계 §5.2-B)를 보고 사람이 쓴 것이며 구현 출력이 아니다.
 */
interface GoldenCase {
  text: string;
  PARTIAL: { maskedText: string; counts: Record<string, number> };
  FULL: { maskedText: string; counts: Record<string, number> };
}
const cases = (corpus as { cases: GoldenCase[] }).cases;
const DATE_GLOBAL = /(?<![\d-])(?:19|20)\d{2}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])(?![\d-])/g;

describe('maskPii 생년월일 문맥 예외(L-5 · U-1)', () => {
  it('손 작성 골든은 40건 이상이다', () => {
    expect(cases.length).toBeGreaterThanOrEqual(40);
  });

  it.each(['PARTIAL', 'FULL'] as const)('① %s: 골든과 같다', (mode) => {
    for (const c of cases) expect({ text: c.text, r: maskPii(c.text, { mode }) }).toEqual({ text: c.text, r: c[mode] });
  });

  it('① 기본 호출·선택 경로(kinds 5종)·preserveDates:true 명시도 골든과 같다', () => {
    for (const c of cases) {
      expect({ text: c.text, r: maskPii(c.text) }).toEqual({ text: c.text, r: c.PARTIAL });
      expect({ text: c.text, r: maskPii(c.text, { preserveDates: true }) }).toEqual({ text: c.text, r: c.PARTIAL });
      expect({ text: c.text, r: maskPii(c.text, { kinds: ['rrn', 'card', 'phone', 'account', 'email'] }) }).toEqual({ text: c.text, r: c.PARTIAL });
    }
  });

  it('② 날짜가 모두 가려진 케이스(문맥 날짜뿐)는 구 동작(preserveDates:false = v1)과 같다', () => {
    let checked = 0;
    for (const c of cases) {
      if ((c.PARTIAL.maskedText.match(DATE_GLOBAL) ?? []).length > 0) continue;
      // 날짜에 붙은 이메일(설계 §5.2-C 마지막 행)은 v1과 다르게 이메일 국소부가 날짜까지 먹는다(§5.5-4 — 더 가리는 방향). 날짜 문맥과 무관.
      if (c.text === '1990-05-12x@y.co') continue;
      checked += 1;
      expect({ text: c.text, r: maskPii(c.text) }).toEqual({ text: c.text, r: maskPii(c.text, { preserveDates: false }) });
    }
    expect(checked).toBeGreaterThan(15);
  });

  it('② 그 밖의 케이스에서 구 동작은 모든 날짜를 가린다(v1)', () => {
    for (const c of cases) expect({ text: c.text, left: maskPii(c.text, { preserveDates: false }).maskedText.match(DATE_GLOBAL) }).toEqual({ text: c.text, left: null });
  });

  describe('③ 출구(kinds + preserveDates)', () => {
    const text = '생년월일 1990-05-12, 배송 2026-09-30';
    it("계좌번호 켬 + 날짜 보호 켬: 문맥 날짜만 가린다", () => {
      expect(maskPii(text, { kinds: ['account'], preserveDates: true }).maskedText).toBe('생년월일 [계좌번호], 배송 2026-09-30');
    });
    it('계좌번호 끔(주민번호·카드): 그대로', () => {
      const r = maskPii(text, { kinds: ['rrn', 'card'], preserveDates: true });
      expect(r.maskedText).toBe(text);
      expect(r.counts.account).toBe(0);
    });
    it('날짜 보호 끔: 모든 날짜를 가린다(구 동작)', () => {
      expect(maskPii(text, { kinds: ['account'], preserveDates: false }).maskedText).toBe('생년월일 [계좌번호], 배송 [계좌번호]');
    });
  });
});
