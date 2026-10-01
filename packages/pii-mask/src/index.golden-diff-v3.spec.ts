import v2 from './__golden__/storage-corpus.v2.json';
import v3 from './__golden__/storage-corpus.json';
import { maskPii } from './index';

/**
 * [T-5, 규칙 v3 = v2 다섯 단계 + 사후 카드 보강(개정 ①)] 차분 증명 — 동결 v2(`storage-corpus.v2.json`)와 갱신본의 차이는 "14자리 이상 숫자 연속이 든 닫힌 15건"뿐이고,
 * 그 차이는 `[주민등록번호]<잔여숫자>` → `[카드번호]`(rrn 카운트가 card로 이동)뿐이다. 닫힌 목록은 구현 스크립트가 확정한 값이다.
 */
interface GoldenCase {
  text: string;
  PARTIAL: { maskedText: string; counts: Record<string, number> };
  FULL: { maskedText: string; counts: Record<string, number> };
}
const oldCases = (v2 as { cases: GoldenCase[] }).cases;
const newCases = (v3 as { cases: GoldenCase[] }).cases;

const CLOSED_CHANGED_TEXTS: readonly string[] = [
  '1234567890123456',
  '[1234567890123456]',
  '12345678901234',
  '12345678901234, 그리고 12345678901234',
  '주문번호 20260930123456',
  '1234567890123456 / 1234 5678 9012 3456 그리고 011-234-5678',
  '12345678901234 / 011-234-5678 그리고 901231-1234567',
  '12345678901234 / 011-234-5678 그리고 1002-123-456789',
  '1234567890123456 / x@y.z 그리고 x@y.z',
  '1234567890123456 / 1002-123-456789 그리고 1002-123-456789',
  '12345678901234 / 901231-1234567 그리고 x@y.z',
  '12345678901234 / x@y.z 그리고 011-234-5678',
  '1234567890123456 / 901231-1234567 그리고 1234 5678 9012 3456',
  '1234567890123456 / 011-234-5678 그리고 x@y.z',
  '12345678901234 / 901231-1234567 그리고 1234 5678 9012 3456',
];

const LONG_RUN = /(?<!\d)\d{14,}(?!\d)/;
const RRN_RESIDUE = /\[주민등록번호\]\d+/g;

describe('저장 골든 v2 → v3 차분(T-5)', () => {
  it('① 케이스 수·순서·text가 같다', () => {
    expect(newCases.map((c) => c.text)).toEqual(oldCases.map((c) => c.text));
  });

  it('② 달라진 케이스의 text 집합 = 닫힌 목록 상수(15건)', () => {
    const changed = oldCases.filter((o, i) => JSON.stringify(o) !== JSON.stringify(newCases[i])).map((o) => o.text);
    expect([...changed].sort()).toEqual([...CLOSED_CHANGED_TEXTS].sort());
    expect(changed).toHaveLength(15);
  });

  it('③ 나머지 291건은 v2 동결본과 deep-equal이다', () => {
    let same = 0;
    oldCases.forEach((o, i) => {
      if (CLOSED_CHANGED_TEXTS.includes(o.text)) return;
      expect({ text: o.text, c: newCases[i] }).toEqual({ text: o.text, c: o });
      same += 1;
    });
    expect(same).toBe(291);
  });

  it('④ 달라진 케이스 = 변환 규칙([주민등록번호]<잔여숫자> → [카드번호], rrn−k · card+k)', () => {
    oldCases.forEach((o, i) => {
      if (!CLOSED_CHANGED_TEXTS.includes(o.text)) return;
      for (const mode of ['PARTIAL', 'FULL'] as const) {
        const before = o[mode];
        const k = (before.maskedText.match(RRN_RESIDUE) ?? []).length;
        expect(k).toBeGreaterThan(0);
        expect({ text: o.text, mode, after: newCases[i][mode] }).toEqual({
          text: o.text,
          mode,
          after: {
            maskedText: before.maskedText.replace(RRN_RESIDUE, '[카드번호]'),
            counts: { ...before.counts, rrn: before.counts.rrn - k, card: before.counts.card + k },
          },
        });
      }
    });
  });

  it('⑤ 달라진 케이스마다 14자리 이상 숫자 연속을 포함하고, 안 달라진 케이스는 14자리 이상 숫자 연속이 없다(13자리 주민번호 연속형 포함)', () => {
    for (const o of oldCases) {
      expect({ text: o.text, long: LONG_RUN.test(o.text) }).toEqual({ text: o.text, long: CLOSED_CHANGED_TEXTS.includes(o.text) });
    }
  });

  it('⑥ 갱신 골든은 현재 구현 출력과 같다(재확인 — 골든 시험과 별개로 닫힌 목록 15건 직접 호출)', () => {
    for (const t of CLOSED_CHANGED_TEXTS) {
      const c = newCases.find((x) => x.text === t)!;
      expect({ t, r: maskPii(t, { mode: 'PARTIAL' }) }).toEqual({ t, r: c.PARTIAL });
    }
  });
});
