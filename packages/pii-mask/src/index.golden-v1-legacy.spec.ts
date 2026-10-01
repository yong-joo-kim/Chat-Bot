import { maskPii } from './index';
import v1 from './__golden__/storage-corpus.v1.json';

/**
 * [L-5] 구 규칙(v1 = 날짜 오인 포함) 동결본 증명 — `preserveDates: false`는 v1과 바이트 동일해야 한다.
 * `storage-corpus.v1.json`은 2026-10-01 이전 `maskPii()` 출력을 그대로 동결한 파일이다(재생성·수정 금지).
 * [T-5, 규칙 v3] 14자리 이상 숫자 연속이 든 15건은 v3에서 `[주민등록번호]<잔여숫자>` → `[카드번호]`(rrn 카운트가 card로 이동)로 바뀐다 —
 * 동결 파일은 그대로 두고 기대값에 같은 변환 규칙을 적용한다(`index.golden-diff-v3.spec.ts`의 닫힌 목록과 같은 15건).
 */
interface GoldenCase {
  text: string;
  PARTIAL: { maskedText: string; counts: Record<string, number> };
  FULL: { maskedText: string; counts: Record<string, number> };
}
const cases = (v1 as { cases: GoldenCase[] }).cases;

const LONG_DIGIT_RUN = /(?<!\d)\d{14,}(?!\d)/;
const RRN_RESIDUE = /\[주민등록번호\]\d+/g;

/** 변환 규칙 — 14자리 이상 숫자 연속이 든 케이스에서 `[주민등록번호]` 바로 뒤에 숫자가 남은 형태만 `[카드번호]`로, 카운트는 rrn → card로 이동. */
function toV3(c: GoldenCase, mode: 'PARTIAL' | 'FULL'): GoldenCase['PARTIAL'] {
  const r = c[mode];
  if (!LONG_DIGIT_RUN.test(c.text)) return r;
  const k = (r.maskedText.match(RRN_RESIDUE) ?? []).length;
  return { maskedText: r.maskedText.replace(RRN_RESIDUE, '[카드번호]'), counts: { ...r.counts, rrn: r.counts.rrn - k, card: r.counts.card + k } };
}

describe('maskPii — preserveDates:false는 규칙 v1과 바이트 동일(L-5, 단 T-5 닫힌 15건은 v3 변환)', () => {
  it('동결 말뭉치는 306건이다(문장 추가·삭제 금지)', () => {
    expect(cases).toHaveLength(306);
  });

  it.each(['PARTIAL', 'FULL'] as const)('%s: 306건 전부 v1(+T-5 변환 15건)과 같다', (mode) => {
    for (const c of cases) {
      expect({ text: c.text, result: maskPii(c.text, { mode, preserveDates: false }) }).toEqual({ text: c.text, result: toV3(c, mode) });
    }
  });
});
