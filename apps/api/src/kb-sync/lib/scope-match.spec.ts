import { isInScope } from './scope-match';

const baseCfg = { allowedHosts: ['intra.example.local'], allowedOrigins: ['intra.example.local'], pathPrefixes: ['/hr/'], excludePatterns: [], maxDepth: 3 };

describe('isInScope', () => {
  it('허용 호스트·경로 접두·깊이를 모두 만족하면 true', () => {
    expect(isInScope('https://intra.example.local/hr/notice', 1, baseCfg)).toBe(true);
  });

  it('하위 도메인은 자동으로 포함되지 않는다(정확 일치)', () => {
    expect(isInScope('https://sub.intra.example.local/hr/', 1, baseCfg)).toBe(false);
  });

  it('경로 접두 목록 밖이면 false', () => {
    expect(isInScope('https://intra.example.local/finance/', 1, baseCfg)).toBe(false);
  });

  it('경로 접두 목록이 비어 있으면 전부 허용', () => {
    expect(isInScope('https://intra.example.local/anything', 1, { ...baseCfg, pathPrefixes: [] })).toBe(true);
  });

  it('제외 글롭에 일치하면 false', () => {
    expect(isInScope('https://intra.example.local/hr/archive/old', 1, { ...baseCfg, excludePatterns: ['/hr/archive/*'] })).toBe(false);
  });

  it('깊이가 상한을 넘으면 false', () => {
    expect(isInScope('https://intra.example.local/hr/', 5, baseCfg)).toBe(false);
  });
});

describe('isInScope — pass 6 Low-5 · 경로 접두는 경계 검사', () => {
  const cfg = { allowedHosts: ['intra.example.local'], allowedOrigins: ['intra.example.local'], pathPrefixes: ['/docs'], excludePatterns: [], maxDepth: 3 };
  it.each([
    ['/docs', true],
    ['/docs/', true],
    ['/docs/a', true],
    ['/docsecret/', false],
    ['/docs.html', false],
    ['/docsx', false],
  ])('접두 /docs vs %s → %s', (path, expected) => {
    expect(isInScope(`https://intra.example.local${path}`, 1, cfg)).toBe(expected);
  });

  it('슬래시로 끝나는 접두(/hr/)는 그 아래만 통과시킨다', () => {
    const c = { ...cfg, pathPrefixes: ['/hr/'] };
    expect(isInScope('https://intra.example.local/hr/policy', 1, c)).toBe(true);
    expect(isInScope('https://intra.example.local/hrx/policy', 1, c)).toBe(false);
  });
});

describe('isInScope — pass 6 M-4 · 한글 경로', () => {
  const cfg = { allowedHosts: ['intra.example.local'], allowedOrigins: ['intra.example.local'], pathPrefixes: ['/규정'], excludePatterns: ['/규정/보관/*'], maxDepth: 3 };
  it('★ 한글 원문 접두(/규정)가 퍼센트 인코딩된 URL 경로와 일치한다', () => {
    expect(isInScope('https://intra.example.local/규정/인사', 1, cfg)).toBe(true);
    expect(isInScope('https://intra.example.local/공지/인사', 1, cfg)).toBe(false);
  });
  it('★ 한글 제외 글롭(/규정/보관/*)도 같은 형태로 비교한다', () => {
    expect(isInScope('https://intra.example.local/규정/보관/2019', 1, cfg)).toBe(false);
    expect(isInScope('https://intra.example.local/규정/현행/2019', 1, cfg)).toBe(true);
  });
  it('접두를 퍼센트 인코딩으로 적어도 같다', () => {
    expect(isInScope('https://intra.example.local/규정/인사', 1, { ...cfg, pathPrefixes: ['/%EA%B7%9C%EC%A0%95'] })).toBe(true);
  });
});

describe('isInScope — pass 12 · RG-26 같은 호스트의 다른 포트는 허용 출처에 있을 때만 범위 안', () => {
  const cfg = { allowedHosts: ['a.example'], allowedOrigins: ['a.example'], pathPrefixes: [], excludePatterns: [], maxDepth: 3 };

  it('★ 허용 출처에 없는 포트는 호스트 이름이 허용 목록에 있어도 범위 밖이다', () => {
    expect(isInScope('https://a.example:8443/x', 1, cfg)).toBe(false);
    expect(isInScope('https://a.example/x', 1, cfg)).toBe(true);
  });

  it('시작 주소에 명시된 포트는 범위 안이다 · 명시하지 않은 다른 포트는 여전히 밖이다', () => {
    const withPort = { ...cfg, allowedOrigins: ['a.example', 'a.example:8443'] };
    expect(isInScope('https://a.example:8443/x', 1, withPort)).toBe(true);
    expect(isInScope('https://a.example:9443/x', 1, withPort)).toBe(false);
  });

  it('기본 포트 표기 차이(:443 명시 · 생략)는 같은 출처다', () => {
    expect(isInScope('https://a.example:443/x', 1, cfg)).toBe(true);
  });

  it('출처 집합이 비면 아무것도 범위 안이 아니다', () => {
    expect(isInScope('https://a.example/x', 1, { ...cfg, allowedOrigins: [] })).toBe(false);
  });
});
