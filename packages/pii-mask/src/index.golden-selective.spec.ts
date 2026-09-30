import { maskPii, type PiiKind } from './index';
import corpus from './__golden__/storage-corpus.json';

/**
 * [No.36] 선택 경로(`kinds`) 동등성 — 골든(구현 전 `maskPii()` 출력)과 비교한다.
 * index.golden.spec.ts는 선택 인자 도입 전 구현에서도 통과해야 하므로 `kinds`를 쓰는 시험은 이 파일로 분리했다.
 */
interface GoldenCase {
  text: string;
  PARTIAL: { maskedText: string; counts: Record<PiiKind, number> };
  FULL: { maskedText: string; counts: Record<PiiKind, number> };
}
const cases = (corpus as { cases: GoldenCase[] }).cases;
const ALL: PiiKind[] = ['rrn', 'card', 'phone', 'account', 'email'];

describe('maskPii 선택 경로 — 5종 전부 선택 시 기존 경로와 동등', () => {
  it.each(['PARTIAL', 'FULL'] as const)('%s: kinds=5종이면 골든과 같다', (mode) => {
    for (const c of cases) {
      const r = maskPii(c.text, { mode, kinds: ALL });
      expect({ text: c.text, r }).toEqual({ text: c.text, r: c[mode] });
    }
  });

  it('kinds 순서·중복과 무관하다', () => {
    const c = cases.find((x) => x.text.includes('주민 901231') && x.text.includes('날짜'))!;
    expect(maskPii(c.text, { kinds: ['email', 'rrn', 'account', 'card', 'phone', 'rrn'] })).toEqual(c.PARTIAL);
  });
});
