import { maskPii } from './index';

/**
 * [L-5 2차 규칙 적대적 확인 — 시험 담당 2026-10-01] 새는 입력/오탐/fail-closed/성능/출구 동치.
 * 기대값은 설계 §5.2-B 규칙 표와 사용자 지시 목록을 보고 쓴 것이다(구현 출력 아님).
 */
const D = '1990-05-12';
const LEAK_MUST_MASK = [
  `생년월일 - ${D}`, `생년월일 / ${D}`, `생년월일 ~ ${D}`, `생년월일 “${D}”`, `생년월일 「${D}」`,
  `생년월일 (양력) ${D}`, `Birth date: ${D}`, `Birth Date ${D}`, `생일 \u200B${D}`, `생년월일 :  ${D}`,
];
const KEEP = [
  '발생일 2026-09-30', '생일 선물 2026-09-30', 'birth-date 1990-05-12', 'birth dates 1990-05-12',
  'birth   date 1990-05-12', '생년월일(선물) 1990-05-12', '입금일 2026-09-30',
];
const FAIL_CLOSED = [
  '2026-09-30-123456', '12026-09-30', '2026-13-01',
  '생년월일 1990-05-12 900101-1234567', '1990-05-12 4111-1111-1111-1111', '1990-05-12 010-1234-5678', '생년월일 1990-05-12-010-1234-5678',
  '2026-09-30900101-1234567', '2026-09-30 4111111111111111',
];

describe('L-5 2차 규칙 적대적 확인', () => {
  it.each(LEAK_MUST_MASK)('(a) 가려진다: %j', (t) => {
    const r = maskPii(t);
    expect({ t, out: r.maskedText.includes(D) }).toEqual({ t, out: false });
    expect(r.maskedText).toContain('[계좌번호]');
  });
  it.each(KEEP)('(b) 날짜가 남는다: %j', (t) => {
    const r = maskPii(t);
    expect({ t, out: r.maskedText }).toEqual({ t, out: t });
  });
  it.each(FAIL_CLOSED)('(c) fail-closed: %j', (t) => {
    const r = maskPii(t);
    // 어떤 경우에도 날짜 앞뒤에 붙은 다른 PII는 남지 않는다
    expect({ t, out: r.maskedText }).not.toEqual({ t, out: t });
    expect(r.maskedText).not.toMatch(/900101-1234567|4111-?1111-?1111-?1111|010-1234-5678|123456$/);
  });
  it('(c) 문맥 없는 날짜 변형 2026-13-01은 계좌번호 후보로 가려진다(v1 동작)', () => {
    expect(maskPii('2026-13-01').maskedText).toBe(maskPii('2026-13-01', { preserveDates: false }).maskedText);
  });

  describe('(d) ReDoS/성능', () => {
    const budget = 2000;
    const cases: Array<[string, string]> = [
      ['날짜 20만 개', Array(200_000).fill('2026-09-30').join(' ')],
      ['키워드 반복', '생년월일 '.repeat(100_000)],
      ['키워드+구분 반복', ('생년월일' + ' :-/~'.repeat(10)).repeat(10_000)],
      ['공백 반복 후 날짜', '생년월일' + ' '.repeat(200_000) + D],
      ['Birth date 공백 반복', 'Birth' + ' '.repeat(200_000) + 'date ' + D],
      ['날짜 하이픈 반복', ('2026-09-30-').repeat(50_000)],
      ['키워드+괄호 반복', '생년월일 ' + '('.repeat(100_000) + D],
      ['제로폭 반복', '생일 ' + '\u200B'.repeat(200_000) + D],
    ];
    it.each(cases)('%s', (_n, input) => {
      const s = Date.now();
      maskPii(input);
      maskPii(input, { mode: 'FULL' });
      const el = Date.now() - s;
      expect(el).toBeLessThan(budget * 3);
    });
  });

  describe('(e) 출구 경로와 기본 경로 동치', () => {
    const all = [...LEAK_MUST_MASK, ...KEEP, ...FAIL_CLOSED, '생년월일 1990-05-12, 배송 2026-09-30'];
    it('kinds 5종 명시 = 기본 호출', () => {
      for (const t of all) expect({ t, r: maskPii(t, { kinds: ['rrn', 'card', 'phone', 'account', 'email'] }) }).toEqual({ t, r: maskPii(t) });
    });
    it('날짜가 계좌번호로 가려지는 판정은 account 단독 출구와 기본 경로가 같다(다른 PII 없는 입력)', () => {
      const pure = [...LEAK_MUST_MASK, ...KEEP, '2026-13-01', '2026-09-30-123456', '12026-09-30'];
      for (const t of pure) {
        const a = maskPii(t, { kinds: ['account'], preserveDates: true }).maskedText;
        const b = maskPii(t).maskedText;
        expect({ t, a }).toEqual({ t, a: b });
      }
    });
  });
});
