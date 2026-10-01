import { maskPii } from './index';
import v1 from './__golden__/storage-corpus.v1.json';

/**
 * [L-5] 구 규칙(v1 = 날짜 오인 포함) 동결본 증명 — `preserveDates: false`는 v1과 바이트 동일해야 한다.
 * `storage-corpus.v1.json`은 2026-10-01 이전 `maskPii()` 출력을 그대로 동결한 파일이다(재생성·수정 금지).
 */
interface GoldenCase {
  text: string;
  PARTIAL: { maskedText: string; counts: Record<string, number> };
  FULL: { maskedText: string; counts: Record<string, number> };
}
const cases = (v1 as { cases: GoldenCase[] }).cases;

describe('maskPii — preserveDates:false는 규칙 v1과 바이트 동일(L-5)', () => {
  it('동결 말뭉치는 306건이다(문장 추가·삭제 금지)', () => {
    expect(cases).toHaveLength(306);
  });

  it.each(['PARTIAL', 'FULL'] as const)('%s: 306건 전부 v1과 같다', (mode) => {
    for (const c of cases) {
      expect({ text: c.text, result: maskPii(c.text, { mode, preserveDates: false }) }).toEqual({ text: c.text, result: c[mode] });
    }
  });
});
