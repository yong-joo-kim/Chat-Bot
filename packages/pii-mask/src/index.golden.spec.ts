import { maskPii } from './index';
import corpus from './__golden__/storage-corpus.json';

/**
 * [No.36] 저장 마스킹 바이트 불변 증명(ai-guardrails-설계.md §7.3 · AG-7).
 * 골든은 v2 규칙(2026-10-01 저장 마스킹 날짜 제외 · 생년월일 문맥 예외) 기준이다 — 전체 재생성 금지, 부분 갱신 절차는
 * docs/02-spec/pm-decisions-2026-10-01-설계.md §5.6. 구 규칙(v1) 원본은 `storage-corpus.v1.json`에 동결돼 있다.
 */
interface GoldenCase {
  text: string;
  PARTIAL: { maskedText: string; counts: Record<string, number> };
  FULL: { maskedText: string; counts: Record<string, number> };
}
const cases = (corpus as { cases: GoldenCase[] }).cases;

describe('maskPii 골든 — 옵션 없는 호출은 도입 전과 바이트 동일', () => {
  it('말뭉치는 200문장 이상이다', () => {
    expect(cases.length).toBeGreaterThanOrEqual(200);
  });

  it.each(['PARTIAL', 'FULL'] as const)('%s 모드 전체 말뭉치가 골든과 같다', (mode) => {
    for (const c of cases) {
      expect({ text: c.text, result: maskPii(c.text, { mode }) }).toEqual({ text: c.text, result: c[mode] });
    }
  });

  it('mode 생략(설치값 기본 PARTIAL)도 골든과 같다', () => {
    for (const c of cases) expect(maskPii(c.text)).toEqual(c.PARTIAL);
  });
});
