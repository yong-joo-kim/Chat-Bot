import v1 from './__golden__/storage-corpus.v1.json';
import v2 from './__golden__/storage-corpus.json';

/**
 * [L-5] 차분 증명 — 동결 v1과 갱신본의 차이는 "독립 날짜가 든 케이스"뿐이고, 그 차이는 날짜 구간의 `[계좌번호]` → 원문 복원뿐이다.
 * 오라클 전제: 이 말뭉치에는 생년월일 문맥 키워드가 없다(있으면 갱신 기대값 도출이 틀어진다) — 아래 단언 ②가 고정한다.
 */
interface GoldenCase {
  text: string;
  PARTIAL: { maskedText: string; counts: Record<string, number> };
  FULL: { maskedText: string; counts: Record<string, number> };
}
const oldCases = (v1 as { cases: GoldenCase[] }).cases;
const newCases = (v2 as { cases: GoldenCase[] }).cases;

/** G-2에서 스크립트로 확정한 닫힌 목록 — 달라진 케이스 23건(월 13 같은 날짜 아님 8건은 달라지지 않는다). */
const CLOSED_CHANGED_TEXTS: readonly string[] = [
  '2026-09-30',
  '고객 정보는 2026-09-30 입니다.',
  '1999-12-31',
  '문의: 1999-12-31 로 연락 주세요',
  '2000-01-01',
  '[2000-01-01]',
  '2000-01-01 / 1234 5678 9012 3456 그리고 x@y.z',
  '2026-09-30 / 901231-1234567 그리고 901231-1234567',
  '1999-12-31 / 1002-123-456789 그리고 1002-123-456789',
  '2000-01-01 / 901231-1234567 그리고 901231-1234567',
  '2026-09-30 / 011-234-5678 그리고 901231-1234567',
  '1999-12-31 / 1234 5678 9012 3456 그리고 901231-1234567',
  '2000-01-01 / 1234 5678 9012 3456 그리고 901231-1234567',
  '2026-09-30 / 011-234-5678 그리고 1234 5678 9012 3456',
  '1999-12-31 / 901231-1234567 그리고 901231-1234567',
  '2000-01-01 / 1002-123-456789 그리고 1002-123-456789',
  '1999-12-31 / 1234 5678 9012 3456 그리고 1234 5678 9012 3456',
  '2000-01-01 / 901231-1234567 그리고 1234 5678 9012 3456',
  '2026-09-30 / 1234 5678 9012 3456 그리고 1234 5678 9012 3456',
  '1999-12-31 / 901231-1234567 그리고 x@y.z',
  '1999-12-31 / 011-234-5678 그리고 011-234-5678',
  '주민 901231-1234567 카드 1234-5678-9012-3456 전화 010-1234-5678 계좌 110-234-567890 메일 abcd@example.com 날짜 2026-09-30',
  '2026-09-30에 010-1234-5678 로 전화, 계좌 110-234-567890-12',
];

const DATE_GLOBAL = /(?<![\d-])(?:19|20)\d{2}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])(?![\d-])/g;
const KEYWORDS = /생년|생일|출생|탄생일|birth|dob/;

describe('저장 골든 v1 → v2 차분(L-5)', () => {
  it('① 케이스 수·순서·text가 같다', () => {
    expect(newCases.map((c) => c.text)).toEqual(oldCases.map((c) => c.text));
  });

  it('② 말뭉치에 생년월일 문맥 키워드가 0건이다(오라클 전제 고정)', () => {
    for (const c of oldCases) expect({ text: c.text, hit: KEYWORDS.test(c.text.normalize('NFKC').toLowerCase()) }).toEqual({ text: c.text, hit: false });
  });

  it('③ 독립 날짜가 없는 케이스는 v1과 deep-equal이다', () => {
    oldCases.forEach((o, i) => {
      if ((o.text.match(DATE_GLOBAL) ?? []).length === 0) expect({ text: o.text, c: newCases[i] }).toEqual({ text: o.text, c: o });
    });
  });

  it('④ 달라진 케이스의 text 집합 = 닫힌 목록 상수(23건)', () => {
    const changed = oldCases.filter((o, i) => JSON.stringify(o) !== JSON.stringify(newCases[i])).map((o) => o.text);
    expect([...changed].sort()).toEqual([...CLOSED_CHANGED_TEXTS].sort());
    expect(changed).toHaveLength(23);
  });

  it('⑤ 달라진 케이스: account 감소분 = 독립 날짜 수, 다른 4종 카운트 동일, 각 날짜가 그대로 있다', () => {
    oldCases.forEach((o, i) => {
      if (!CLOSED_CHANGED_TEXTS.includes(o.text)) return;
      const dates = o.text.match(DATE_GLOBAL) ?? [];
      expect(dates.length).toBeGreaterThan(0);
      for (const mode of ['PARTIAL', 'FULL'] as const) {
        const before = o[mode];
        const after = newCases[i][mode];
        expect({ text: o.text, mode, account: after.counts.account }).toEqual({ text: o.text, mode, account: before.counts.account - dates.length });
        for (const k of ['rrn', 'card', 'phone', 'email']) expect(after.counts[k]).toBe(before.counts[k]);
        for (const d of dates) expect(after.maskedText).toContain(d);
      }
    });
  });
});
