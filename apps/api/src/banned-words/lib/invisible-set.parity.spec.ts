import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * L-5 2차 — `packages/pii-mask`의 "보이지 않는 문자" 제거 집합(생년월일 문맥 판정 창 전용)과 N36-2 금지어 정규화(`banned-word-filter.ts`)의
 * 집합이 같은 코드 포인트 목록인지 정적으로 비교한다. pii-mask는 api를 import할 수 없어 정의가 두 곳이므로, 한쪽만 바뀌는 것을 막는다.
 */
const REPO_ROOT = join(__dirname, '../../../../..');
const FILTER_SRC = join(REPO_ROOT, 'apps/api/src/banned-words/lib/banned-word-filter.ts');
const PII_SRC = join(REPO_ROOT, 'packages/pii-mask/src/index.ts');

function extractClass(path: string): string {
  const src = readFileSync(path, 'utf8');
  const m = src.match(/const INVISIBLE_CLASS = '([^']+)';/);
  if (!m) throw new Error(`INVISIBLE_CLASS 리터럴을 찾지 못했습니다: ${path}`);
  // 소스의 `\\p`(문자열 이스케이프)를 정규식 소스로 되돌린다.
  return m[1].replace(/\\\\/g, '\\');
}

describe('보이지 않는 문자 집합 동등성(pii-mask ↔ N36-2 금지어 정규화)', () => {
  const filterClass = extractClass(FILTER_SRC);
  const piiClass = extractClass(PII_SRC);

  it('리터럴 정의가 같다', () => {
    expect(piiClass).toBe(filterClass);
  });

  it('모든 코드 포인트에서 매칭 결과가 같다(U+0000~U+10FFFF)', () => {
    const a = new RegExp(`^${filterClass}$`, 'u');
    const b = new RegExp(`^${piiClass}$`, 'u');
    const diff: number[] = [];
    let hits = 0;
    for (let cp = 0; cp <= 0x10ffff; cp += 1) {
      if (cp >= 0xd800 && cp <= 0xdfff) continue; // 서로게이트 단독 값은 제외
      const ch = String.fromCodePoint(cp);
      const x = a.test(ch);
      if (x) hits += 1;
      if (x !== b.test(ch)) diff.push(cp);
    }
    expect(diff).toEqual([]);
    expect(hits).toBeGreaterThan(100); // 집합이 비어 있지 않다는 가드
  });
});
