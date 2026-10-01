import { maskPii, PII_MASK_RULES_VERSION, type PiiKind, type PiiMaskCounts } from './index';

/**
 * [T-5, 규칙 v3 = v2 다섯 단계 + 맨 뒤 ⑥ 카드 보강(개정 ①)] 표기에 맞붙은 잔여 숫자·14자리 이상 숫자 연속·AMEX 공백형을 `[카드번호]`로 가린다(설계 §2.5 · B-1~B-22 · R-*).
 * 기대값은 설계 표에서 **사람이 작성**했다(구현 출력을 복사하지 않는다).
 */
const Z: PiiMaskCounts = { rrn: 0, card: 0, account: 0, phone: 0, email: 0 };
const c = (o: Partial<PiiMaskCounts>): PiiMaskCounts => ({ ...Z, ...o });

interface Row {
  id: string;
  text: string;
  partial: string;
  full?: string; // 생략 = partial과 같다
  counts: PiiMaskCounts;
}

const ROWS: Row[] = [
  { id: 'B-1', text: '4111111111111111', partial: '[카드번호]', counts: c({ card: 1 }) },
  { id: 'B-1b', text: '카드 4111111111111111 결제', partial: '카드 [카드번호] 결제', counts: c({ card: 1 }) },
  { id: 'B-2', text: '9012311234567', partial: '[주민등록번호]', counts: c({ rrn: 1 }) },
  { id: 'B-3', text: '901231-1234567', partial: '[주민등록번호]', counts: c({ rrn: 1 }) },
  { id: 'B-4', text: '90123112345678', partial: '[카드번호]', counts: c({ card: 1 }) },
  { id: 'B-5', text: '378282246310005', partial: '[카드번호]', counts: c({ card: 1 }) },
  { id: 'B-6', text: '3782 822463 10005', partial: '[카드번호]', counts: c({ card: 1 }) },
  { id: 'B-7', text: '3782-822463-10005', partial: '[계좌번호]', counts: c({ account: 1 }) }, // 개정 ① — v2와 같다(AMEX 하이픈형은 계좌 표기)
  { id: 'B-8', text: '30569309025904', partial: '[카드번호]', counts: c({ card: 1 }) },
  { id: 'B-9', text: '6212345678901234567', partial: '[카드번호]', counts: c({ card: 1 }) },
  { id: 'B-10', text: '12345678901234567890', partial: '[카드번호]', counts: c({ card: 1 }) },
  { id: 'B-11a', text: '1234-5678-9012-3456', partial: '[카드번호]', counts: c({ card: 1 }) },
  { id: 'B-11b', text: '1234 5678 9012 3456', partial: '[카드번호]', counts: c({ card: 1 }) },
  { id: 'B-12', text: '4111 1111 1111 1111 111', partial: '[카드번호] 111', counts: c({ card: 1 }) },
  { id: 'B-13a', text: 'x4111111111111111', partial: 'x[카드번호]', counts: c({ card: 1 }) },
  { id: 'B-13b', text: '카드4111111111111111번', partial: '카드[카드번호]번', counts: c({ card: 1 }) },
  { id: 'B-14', text: '01012345678', partial: '010-****-5678', full: '[전화번호]', counts: c({ phone: 1 }) },
  { id: 'B-15', text: '0101234567812345', partial: '[카드번호]', counts: c({ card: 1 }) },
  { id: 'B-16', text: '1234560123456', partial: '1234560123456', counts: c({}) },
  { id: 'B-17', text: '주문번호 20260930123456', partial: '주문번호 [카드번호]', counts: c({ card: 1 }) },
  { id: 'B-18', text: '12345678901234-1234567', partial: '[카드번호]-1234567', counts: c({ card: 1 }) },
  { id: 'B-19', text: '2026-09-30 4111111111111111', partial: '2026-09-30 [카드번호]', counts: c({ card: 1 }) },
  { id: 'B-20', text: '4111111111111111-2026-09-30', partial: '[주민등록번호][계좌번호]', counts: c({ rrn: 1, account: 1 }) }, // v2와 같다(덩어리에 숫자 없음)
  { id: 'B-21', text: '4111​111111111111', partial: '4111​111111111111', counts: c({}) },
  { id: 'B-22', text: '４１１１１１１１１１１１１１１１', partial: '４１１１１１１１１１１１１１１１', counts: c({}) },
  // 손 작성 경계 — 14자리 이상 · AMEX
  { id: 'E-1', text: '13자리 9012311234567 다음', partial: '13자리 [주민등록번호] 다음', counts: c({ rrn: 1 }) },
  { id: 'E-2', text: '카드 3782 822463 10005 결제', partial: '카드 [카드번호] 결제', counts: c({ card: 1 }) },
  { id: 'E-3', text: '3782-822463-10005 와 3782 822463 10005', partial: '[계좌번호] 와 [카드번호]', counts: c({ account: 1, card: 1 }) },
  { id: 'E-4', text: '4111111111111111, 5500000000000004', partial: '[카드번호], [카드번호]', counts: c({ card: 2 }) },
  { id: 'E-5', text: '4111111111111111 901231-1234567', partial: '[카드번호] [주민등록번호]', counts: c({ card: 1, rrn: 1 }) },
  { id: 'E-6', text: '4111111111111111 011-234-5678', partial: '[카드번호] 011-****-5678', full: '[카드번호] [전화번호]', counts: c({ card: 1, phone: 1 }) },
  // 개정 ① — 리뷰 재현 입력(설계 §2.5 1~13번, (d) 열)
  { id: 'R-1', text: '4111111111111111-1234567', partial: '[카드번호]-1234567', counts: c({ card: 1 }) },
  { id: 'R-2', text: '주문 20260930123456-1234567', partial: '주문 [카드번호]-1234567', counts: c({ card: 1 }) },
  { id: 'R-3', text: '123456-1234567890123456', partial: '[카드번호]', counts: c({ card: 1 }) },
  { id: 'R-4', text: '900101-1234567', partial: '[주민등록번호]', counts: c({ rrn: 1 }) },
  { id: 'R-5', text: 'a900101-1234567', partial: 'a[주민등록번호]', counts: c({ rrn: 1 }) },
  { id: 'R-6', text: '12900101-1234567', partial: '[카드번호]', counts: c({ card: 1 }) },
  { id: 'R-7', text: '1900101-1234567', partial: '[카드번호]', counts: c({ card: 1 }) }, // v2는 `1[주민등록번호]`(1자리 노출) — 덩어리 흡수로 0
  { id: 'R-8', text: '1234567890123456789-1234567', partial: '[주민등록번호][주민등록번호]', counts: c({ rrn: 2 }) }, // v2와 같다
  { id: 'R-9', text: '12345678901234567 5678 9012 3456', partial: '[주민등록번호][카드번호]', counts: c({ rrn: 1, card: 1 }) }, // v2와 같다
  { id: 'R-10', text: '9001011234567-1234567', partial: '[주민등록번호]-1234567', counts: c({ rrn: 1 }) }, // v2와 같다(Q-10 — 하이픈 뒤는 흡수하지 않음)
  { id: 'R-11', text: '900101-12345678', partial: '[카드번호]', counts: c({ card: 1 }) },
  { id: 'R-12a', text: 'x900101-1234567y', partial: 'x[주민등록번호]y', counts: c({ rrn: 1 }) },
  { id: 'R-12b', text: '-900101-1234567', partial: '-[주민등록번호]', counts: c({ rrn: 1 }) },
  { id: 'R-12c', text: '900101-1234567-1', partial: '[주민등록번호]-1', counts: c({ rrn: 1 }) },
  // 입력에 원래 있던 표기 문자열 — 차감 금지(그 자리의 숫자를 새로 가린 것으로 센다)
  { id: 'R-14', text: '[주민등록번호]123', partial: '[카드번호]', counts: c({ card: 1 }) },
  { id: 'R-15', text: '[카드번호]4', partial: '[카드번호]', counts: c({ card: 1 }) },
  { id: 'R-16', text: '[주민등록번호][주민등록번호]', partial: '[주민등록번호][주민등록번호]', counts: c({}) },
  // 표지 범위(U+E200~E2FF) 입력 — ⑥ 생략, 출력 = v2
  { id: 'R-17', text: '\uE2104111111111111111', partial: '\uE210[주민등록번호]111', counts: c({ rrn: 1 }) },
  { id: 'E-7', text: '4111111111111111 x@y.zz', partial: '[카드번호] x***@y.zz', full: '[카드번호] [이메일]', counts: c({ card: 1, email: 1 }) },
];

describe('maskPii 긴 숫자열·AMEX 카드 우선(T-5, 규칙 v3)', () => {
  it('규칙 버전은 3이다', () => {
    expect(PII_MASK_RULES_VERSION).toBe(3);
  });

  it.each(ROWS)('$id — $text', (row) => {
    expect(maskPii(row.text, { mode: 'PARTIAL' })).toEqual({ maskedText: row.partial, counts: row.counts });
    expect(maskPii(row.text, { mode: 'FULL' })).toEqual({ maskedText: row.full ?? row.partial, counts: row.counts });
  });

  it('kinds 5종 선택 = 기본 호출과 같다(전 입력 · 두 모드)', () => {
    const all: PiiKind[] = ['rrn', 'card', 'phone', 'account', 'email'];
    for (const row of ROWS) {
      for (const mode of ['PARTIAL', 'FULL'] as const) {
        expect({ id: row.id, r: maskPii(row.text, { mode, kinds: all }) }).toEqual({ id: row.id, r: maskPii(row.text, { mode }) });
      }
    }
  });

  describe('출구 kinds 조합(설계 §2.8)', () => {
    it('주민번호+카드(기본) — 16자리 연속은 [카드번호]', () => {
      expect(maskPii('4111111111111111', { kinds: ['rrn', 'card'] })).toEqual({ maskedText: '[카드번호]', counts: c({ card: 1 }) });
    });
    it('카드만 — 16자리 연속은 원문(v2와 같다: 주민번호 일치가 자리표시로 보호되어 덩어리가 아님)', () => {
      expect(maskPii('4111111111111111', { kinds: ['card'] })).toEqual({ maskedText: '4111111111111111', counts: c({}) });
    });
    it('주민번호만(카드 끔) — v2와 같다(⑥ 생략)', () => {
      expect(maskPii('4111111111111111', { kinds: ['rrn'] })).toEqual({ maskedText: '[주민등록번호]111', counts: c({ rrn: 1 }) });
    });
    it('AMEX 공백형 — 카드 선택 시 [카드번호] · 카드 미선택이면 원문', () => {
      expect(maskPii('3782 822463 10005', { kinds: ['card'] })).toEqual({ maskedText: '[카드번호]', counts: c({ card: 1 }) });
      expect(maskPii('3782 822463 10005', { kinds: ['rrn'] })).toEqual({ maskedText: '3782 822463 10005', counts: c({}) });
    });
    it('AMEX 하이픈형 — 계좌 포함 조합은 [계좌번호] · 계좌 미선택(주민번호+카드)은 원문(v2와 같음)', () => {
      expect(maskPii('3782-822463-10005', { kinds: ['rrn', 'card', 'account'] })).toEqual({ maskedText: '[계좌번호]', counts: c({ account: 1 }) });
      expect(maskPii('3782-822463-10005', { kinds: ['rrn', 'card'] })).toEqual({ maskedText: '3782-822463-10005', counts: c({}) });
    });
    it('AMEX 하이픈형 — 계좌만 선택해도 [계좌번호]', () => {
      expect(maskPii('3782-822463-10005', { kinds: ['account'] })).toEqual({ maskedText: '[계좌번호]', counts: c({ account: 1 }) });
    });
    it('선택 경로에서도 덩어리 흡수 — 주민번호+카드로 [주민등록번호]111 잔여가 [카드번호]가 된다', () => {
      expect(maskPii('4111111111111111-1234567', { kinds: ['rrn', 'card'] })).toEqual({ maskedText: '[카드번호]-1234567', counts: c({ card: 1 }) });
    });
  });

  describe('날짜 제외·생년월일 문맥과의 상호작용(설계 §2.6)', () => {
    it('생년월일 문맥 + 카드 + 날짜 — 카드만 가리고 날짜는 원문 유지(문맥은 날짜 바로 앞 낱말만)', () => {
      expect(maskPii('생년월일 4111111111111111 1990-05-12')).toEqual({
        maskedText: '생년월일 [카드번호] 1990-05-12',
        counts: c({ card: 1 }),
      });
    });
    it('생년월일 문맥 날짜는 여전히 계좌로 가려진다(카드와 무관)', () => {
      expect(maskPii('4111111111111111 생년월일 1990-05-12')).toEqual({
        maskedText: '[카드번호] 생년월일 [계좌번호]',
        counts: c({ card: 1, account: 1 }),
      });
    });
    it('preserveDates=false(v1 날짜 오인)도 카드 분류는 같다', () => {
      expect(maskPii('2026-09-30 4111111111111111', { preserveDates: false })).toEqual({
        maskedText: '[계좌번호] [카드번호]',
        counts: c({ card: 1, account: 1 }),
      });
    });
  });

  describe('성능 — 선형(AC-T5-8)', () => {
    const INPUTS: Array<[string, string]> = [
      ["'1'×1e6", '1'.repeat(1_000_000)],
      ["('4111111111111111 ')×5e4", '4111111111111111 '.repeat(50_000)],
      ["('3782 822463 10005 ')×5e4", '3782 822463 10005 '.repeat(50_000)],
      ["('[카드번호]1')×1e5", '[카드번호]1'.repeat(100_000)],
      ["('1[주민등록번호]')×1e5", '1[주민등록번호]'.repeat(100_000)],
    ];
    it.each(INPUTS)('%s — 2모드 합계 3초 미만', (_n, input) => {
      const t0 = Date.now();
      maskPii(input, { mode: 'PARTIAL' });
      maskPii(input, { mode: 'FULL' });
      expect(Date.now() - t0).toBeLessThan(3000);
    }, 30_000);
  });
});
