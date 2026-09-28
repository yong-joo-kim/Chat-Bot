import { canonicalizePathForMatch, globMatchPath, pathMatchesPrefix, splitPathUnits } from './path-canon';
import { isInScope } from './scope-match';

/**
 * [pass 7 · N-13] 경로 정준형 — 이중 인코딩 없음 · `%2F` 유지 · `%xx` 대문자화 · 글롭 `?`가 비ASCII 문자 1자(퍼센트 인코딩 정준형에서는 여러 글자)에 매칭.
 */
describe('canonicalizePathForMatch', () => {
  it('비ASCII 문자는 UTF-8 퍼센트 인코딩(대문자 16진)으로 바꾼다', () => {
    expect(canonicalizePathForMatch('/docs/한')).toBe('/docs/%ED%95%9C');
    expect(canonicalizePathForMatch('/docs/규정/가')).toBe('/docs/%EA%B7%9C%EC%A0%95/%EA%B0%80');
  });

  it('★ 이중 인코딩하지 않는다 — 이미 인코딩된 경로는 그대로이고, 두 번 적용해도 같다(멱등)', () => {
    const once = canonicalizePathForMatch('/docs/한글');
    expect(canonicalizePathForMatch(once)).toBe(once);
    expect(canonicalizePathForMatch('/docs/%ED%95%9C')).toBe('/docs/%ED%95%9C');
    expect(canonicalizePathForMatch('/a%2520b')).toBe('/a%2520b'); // `%25`(%의 인코딩) 뒤 `20`은 그대로 — 한 번 더 풀거나 다시 인코딩하지 않는다
    expect(canonicalizePathForMatch('/a%25b')).toBe('/a%25b');
  });

  it('★ %2F(인코딩된 슬래시)는 슬래시로 풀지 않고 그대로 둔다', () => {
    expect(canonicalizePathForMatch('/docs/a%2Fb')).toBe('/docs/a%2Fb');
    expect(canonicalizePathForMatch('/docs/a%2fb')).toBe('/docs/a%2Fb');
    expect(canonicalizePathForMatch('/docs/a%2Fb')).not.toBe('/docs/a/b');
  });

  it('★ 이미 적힌 %xx는 대문자로 맞춘다', () => {
    expect(canonicalizePathForMatch('/docs/%ed%95%9c')).toBe('/docs/%ED%95%9C');
    expect(canonicalizePathForMatch('/a%3ab%3Ac')).toBe('/a%3Ab%3Ac');
  });

  it('ASCII(글롭 *·?, robots *·$ 포함)는 그대로 둔다', () => {
    expect(canonicalizePathForMatch('/docs/*/x?$')).toBe('/docs/*/x?$');
  });

  it('짝 없는 서로게이트는 예외 없이 그대로 둔다', () => {
    expect(() => canonicalizePathForMatch('/a\uD800b')).not.toThrow();
  });
});

describe('splitPathUnits — 글롭 ?·*가 세는 "문자 1개"', () => {
  it('ASCII 문자와 %HH(ASCII) 1개는 각각 1단위다', () => {
    expect(splitPathUnits('/a%2Fb')).toEqual(['/', 'a', '%2F', 'b']);
  });

  it('★ 한글 1자(UTF-8 3바이트 = %XX 3개)는 1단위다', () => {
    expect(splitPathUnits('/%ED%95%9C%EA%B8%80')).toEqual(['/', '%ED%95%9C', '%EA%B8%80']);
  });

  it('이모지(4바이트)도 1단위다', () => {
    expect(splitPathUnits(canonicalizePathForMatch('/😀'))).toEqual(['/', '%F0%9F%98%80']);
  });

  it('깨진 UTF-8(연속 바이트 부족 · 단독 연속 바이트)은 %HH 1개씩이고, % 뒤가 16진이 아니면 % 1글자다', () => {
    expect(splitPathUnits('%ED%95')).toEqual(['%ED', '%95']);
    expect(splitPathUnits('%9C')).toEqual(['%9C']);
    expect(splitPathUnits('100%')).toEqual(['1', '0', '0', '%']);
    expect(splitPathUnits('%zz')).toEqual(['%', 'z', 'z']);
  });
});

describe('globMatchPath — 글롭 ?는 문자 1개(한글 1자 포함)에 매칭한다', () => {
  it('★ /docs/?? 는 한글 2자에 일치하고 1자·3자에는 일치하지 않는다(예전에는 한글 1자가 9글자로 바뀌어 일치하지 않았다)', () => {
    expect(globMatchPath('/docs/??', '/docs/%EA%B0%80%EB%82%98')).toBe(true); // 가나
    expect(globMatchPath('/docs/??', '/docs/%EA%B0%80')).toBe(false); // 가
    expect(globMatchPath('/docs/??', '/docs/%EA%B0%80%EB%82%98%EB%8B%A4')).toBe(false); // 가나다
  });

  it('패턴이 한글 원문이어도 같은 형태로 맞춰 비교한다', () => {
    expect(globMatchPath('/docs/규?', '/docs/%EA%B7%9C%EC%A0%95')).toBe(true); // 규정
    expect(globMatchPath('/docs/?정', '/docs/%EA%B7%9C%EC%A0%95')).toBe(true);
    expect(globMatchPath('/docs/규정', '/docs/%EA%B7%9C%EC%A0%95')).toBe(true);
    expect(globMatchPath('/docs/규?', '/docs/%EA%B7%9C')).toBe(false);
  });

  it('* 는 임의 길이(한글 포함)에 일치한다', () => {
    expect(globMatchPath('/docs/*', '/docs/%EA%B0%80%EB%82%98/x')).toBe(true);
    expect(globMatchPath('/*/보관', '/a/%EB%B3%B4%EA%B4%80')).toBe(true);
    expect(globMatchPath('/docs/*.pdf', '/docs/%EA%B0%80.pdf')).toBe(true);
    expect(globMatchPath('/docs/*.pdf', '/docs/%EA%B0%80.doc')).toBe(false);
  });

  it('%2F 도 문자 1개다(? 하나로 일치)', () => {
    expect(globMatchPath('/a?b', '/a%2Fb')).toBe(true);
  });

  it('ASCII만이면 예전 글롭과 같다', () => {
    expect(globMatchPath('/a?c', '/abc')).toBe(true);
    expect(globMatchPath('/a?c', '/abbc')).toBe(false);
    expect(globMatchPath('/hr/archive/*', '/hr/archive/2020/old')).toBe(true);
  });
});

describe('isInScope — 제외 글롭 ?가 한글 1자에 매칭한다(N-13)', () => {
  const cfg = { allowedHosts: ['a.example'], allowedOrigins: ['a.example'], pathPrefixes: ['/docs'], excludePatterns: ['/docs/??'], maxDepth: 3 };
  it('★ /docs/가나 는 제외, /docs/가 · /docs/가나다 는 범위 안', () => {
    expect(isInScope('https://a.example/docs/%EA%B0%80%EB%82%98', 1, cfg)).toBe(false);
    expect(isInScope('https://a.example/docs/%EA%B0%80', 1, cfg)).toBe(true);
    expect(isInScope('https://a.example/docs/%EA%B0%80%EB%82%98%EB%8B%A4', 1, cfg)).toBe(true);
  });
});

describe('pathMatchesPrefix', () => {
  it('세그먼트 경계로 비교한다', () => {
    expect(pathMatchesPrefix('/docs/a', '/docs')).toBe(true);
    expect(pathMatchesPrefix('/docsecret', '/docs')).toBe(false);
  });
});
