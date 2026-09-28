import { fetchFollowingRedirects } from './kb-redirect-follow';
import type { RedirectFetcher } from './kb-redirect-follow';
import type { KbFetchResult } from './kb-crawl-http.fetcher';

const redirect = (location: string): KbFetchResult => ({ kind: 'REDIRECT', status: 301, location, headers: {} });
const ok = (): KbFetchResult => ({ kind: 'RESPONSE', status: 200, contentType: 'text/html', body: Buffer.from('x'), headers: {} });
const scope = { allowedHosts: ['a.example'], allowedOrigins: ['a.example'], pathPrefixes: ['/docs'], excludePatterns: [], maxDepth: 3 };
const baseReq = { allowedHosts: ['a.example'], allowedOrigins: ['a.example'], maxBytes: 1000, timeoutMs: 1000, headersFor: () => ({}) };

function fetcherOf(routes: Record<string, KbFetchResult>): RedirectFetcher & { urls: string[] } {
  const urls: string[] = [];
  return {
    urls,
    async fetchOnce(req) {
      urls.push(req.url);
      return routes[req.url] ?? { kind: 'RESPONSE', status: 404, contentType: 'text/html', body: Buffer.alloc(0), headers: {} };
    },
  };
}

describe('fetchFollowingRedirects — 재개 상태(pass 9 · M-4)', () => {
  const routes = () => ({
    'https://a.example/docs/h0': redirect('/docs/h1'),
    'https://a.example/docs/h1': redirect('/docs/h2'),
    'https://a.example/docs/h2': ok(),
  });

  it('홉 ≥ 1에서 미루면 다음 홉 URL·홉 번호·방문 URL을 돌려준다', async () => {
    const f = fetcherOf(routes());
    const res = await fetchFollowingRedirects(f, { ...baseReq, url: 'https://a.example/docs/h0' }, { allowQueryUrls: false, scope, beforeRequest: async (_u, hop) => (hop === 1 ? { kind: 'DEFERRED' } : null) });
    expect(res).toEqual({ kind: 'DEFERRED', resume: { url: 'https://a.example/docs/h1', hop: 1, visited: ['https://a.example/docs/h0', 'https://a.example/docs/h1'] } });
    expect(f.urls).toEqual(['https://a.example/docs/h0']);
  });

  it('홉 0에서 미루면 재개 상태가 없다(아직 아무 요청도 나가지 않았다)', async () => {
    const f = fetcherOf(routes());
    const res = await fetchFollowingRedirects(f, { ...baseReq, url: 'https://a.example/docs/h0' }, { allowQueryUrls: false, scope, beforeRequest: async () => ({ kind: 'DEFERRED' }) });
    expect(res).toEqual({ kind: 'DEFERRED' });
    expect(f.urls).toHaveLength(0);
  });

  it('재개 상태로 시작하면 앞 홉을 다시 요청하지 않고 그 홉부터 이어가 최종 URL을 돌려준다', async () => {
    const f = fetcherOf(routes());
    const hops: number[] = [];
    const res = await fetchFollowingRedirects(
      f,
      { ...baseReq, url: 'https://a.example/docs/h0', resume: { url: 'https://a.example/docs/h1', hop: 1, visited: ['https://a.example/docs/h0', 'https://a.example/docs/h1'] } },
      { allowQueryUrls: false, scope, beforeRequest: async (_u, hop) => { hops.push(hop); return null; } },
    );
    expect(f.urls).toEqual(['https://a.example/docs/h1', 'https://a.example/docs/h2']);
    expect(hops).toEqual([1, 2]);
    expect(res).toMatchObject({ kind: 'RESPONSE', status: 200, finalUrl: 'https://a.example/docs/h2' });
  });

  it('재개해도 홉 수 상한(3회)과 순환 검사가 이어진다 — 방문한 URL로 되돌아가면 LOOP', async () => {
    const f = fetcherOf({ 'https://a.example/docs/h1': redirect('/docs/h0') });
    const res = await fetchFollowingRedirects(
      f,
      { ...baseReq, url: 'https://a.example/docs/h0', resume: { url: 'https://a.example/docs/h1', hop: 1, visited: ['https://a.example/docs/h0', 'https://a.example/docs/h1'] } },
      { allowQueryUrls: false, scope },
    );
    expect(res).toMatchObject({ kind: 'REDIRECT_OUT_OF_SCOPE', reason: 'LOOP' });
  });

  it('재개한 홉 번호가 3이면 다음 리다이렉트는 MAX_HOPS다', async () => {
    const f = fetcherOf({ 'https://a.example/docs/h3': redirect('/docs/h4') });
    const res = await fetchFollowingRedirects(
      f,
      { ...baseReq, url: 'https://a.example/docs/h0', resume: { url: 'https://a.example/docs/h3', hop: 3, visited: ['https://a.example/docs/h0', 'https://a.example/docs/h3'] } },
      { allowQueryUrls: false, scope },
    );
    expect(res).toMatchObject({ kind: 'REDIRECT_OUT_OF_SCOPE', reason: 'MAX_HOPS' });
  });

  // [pass 11 · L-C] 재개 상태의 url은 미룰 때 한 번 검증한 값이다 — 최대 30분 사이 범위 설정이 좁혀졌다면 재개 시 다시 검사한다.
  describe('재개 시 범위 재검사(pass 11 · L-C)', () => {
    const resume = { url: 'https://a.example/docs/h1', hop: 1, visited: ['https://a.example/docs/h0', 'https://a.example/docs/h1'] };

    it('★ 재개한 홉 URL이 지금 범위 밖이면(경로 접두가 좁혀짐) 요청을 보내지 않고 REDIRECT_OUT_OF_SCOPE(SCOPE · target = 그 URL)로 끝낸다', async () => {
      const f = fetcherOf(routes());
      const before = jest.fn(async () => null);
      const narrowed = { ...scope, pathPrefixes: ['/docs/public'] };
      const res = await fetchFollowingRedirects(f, { ...baseReq, url: 'https://a.example/docs/h0', resume }, { allowQueryUrls: false, scope: narrowed, beforeRequest: before });
      expect(res).toEqual({ kind: 'REDIRECT_OUT_OF_SCOPE', reason: 'SCOPE', target: 'https://a.example/docs/h1' });
      expect(f.urls).toHaveLength(0);
      expect(before).not.toHaveBeenCalled();
    });

    it('재개한 홉 URL의 호스트가 허용 호스트에서 빠졌어도 같다', async () => {
      const f = fetcherOf(routes());
      const res = await fetchFollowingRedirects(f, { ...baseReq, url: 'https://a.example/docs/h0', resume }, { allowQueryUrls: false, scope: { ...scope, allowedHosts: ['b.example'], allowedOrigins: ['b.example'] } });
      expect(res).toMatchObject({ kind: 'REDIRECT_OUT_OF_SCOPE', reason: 'SCOPE' });
      expect(f.urls).toHaveLength(0);
    });

    it('재개한 홉 URL이 제외 패턴에 걸리게 되었어도 같다', async () => {
      const f = fetcherOf(routes());
      const res = await fetchFollowingRedirects(f, { ...baseReq, url: 'https://a.example/docs/h0', resume }, { allowQueryUrls: false, scope: { ...scope, excludePatterns: ['/docs/h1'] } });
      expect(res).toMatchObject({ kind: 'REDIRECT_OUT_OF_SCOPE', reason: 'SCOPE' });
    });

    it('재개한 홉 URL이 쿼리를 달고 있는데 쿼리 URL 허용이 꺼졌으면 범위 밖이다', async () => {
      const f = fetcherOf(routes());
      const withQuery = { url: 'https://a.example/docs/h1?x=1', hop: 1, visited: ['https://a.example/docs/h0', 'https://a.example/docs/h1?x=1'] };
      const res = await fetchFollowingRedirects(f, { ...baseReq, url: 'https://a.example/docs/h0', resume: withQuery }, { allowQueryUrls: false, scope });
      expect(res).toMatchObject({ kind: 'REDIRECT_OUT_OF_SCOPE', reason: 'SCOPE' });
      expect(f.urls).toHaveLength(0);
    });

    it('대조 — 범위 안이면 종전대로 그 홉부터 이어간다', async () => {
      const f = fetcherOf(routes());
      const res = await fetchFollowingRedirects(f, { ...baseReq, url: 'https://a.example/docs/h0', resume }, { allowQueryUrls: false, scope });
      expect(f.urls).toEqual(['https://a.example/docs/h1', 'https://a.example/docs/h2']);
      expect(res).toMatchObject({ kind: 'RESPONSE', finalUrl: 'https://a.example/docs/h2' });
    });

    it('재개한 요청도 headersFor에 (URL, 홉 번호)가 함께 넘어간다 — 홉 0을 건너뛰어도 번호가 이어진다(자격증명은 홉 번호·출처로 호출부가 정한다)', async () => {
      const f = fetcherOf(routes());
      const calls: Array<[string, number]> = [];
      await fetchFollowingRedirects(
        f,
        {
          ...baseReq,
          url: 'https://a.example/docs/h0',
          resume,
          headersFor: (url, hop) => {
            calls.push([url, hop]);
            return { 'x-hop': String(hop) };
          },
        },
        { allowQueryUrls: false, scope },
      );
      expect(calls).toEqual([
        ['https://a.example/docs/h1', 1],
        ['https://a.example/docs/h2', 2],
      ]);
    });

    it('재개하지 않는 요청의 headersFor는 홉 0부터 순서대로 불린다', async () => {
      const f = fetcherOf(routes());
      const calls: Array<[string, number]> = [];
      await fetchFollowingRedirects(f, { ...baseReq, url: 'https://a.example/docs/h0', headersFor: (url, hop) => (calls.push([url, hop]), {}) }, { allowQueryUrls: false, scope });
      expect(calls).toEqual([
        ['https://a.example/docs/h0', 0],
        ['https://a.example/docs/h1', 1],
        ['https://a.example/docs/h2', 2],
      ]);
    });
  });
});

describe('fetchFollowingRedirects — 다른 포트로의 리다이렉트(pass 12 · RG-26)', () => {
  it('★ 허용 출처에 없는 포트로의 리다이렉트는 REDIRECT_OUT_OF_SCOPE(SCOPE) — 그 포트로 요청이 나가지 않는다', async () => {
    const f = fetcherOf({ 'https://a.example/docs/a': redirect('https://a.example:8443/docs/b'), 'https://a.example:8443/docs/b': ok() });
    const res = await fetchFollowingRedirects(f, { ...baseReq, url: 'https://a.example/docs/a' }, { allowQueryUrls: false, scope });
    expect(res).toEqual({ kind: 'REDIRECT_OUT_OF_SCOPE', reason: 'SCOPE', target: 'https://a.example:8443/docs/b' });
    expect(f.urls).toEqual(['https://a.example/docs/a']);
  });

  it('출처 집합에 그 포트가 명시돼 있으면 따라간다 · 기본 포트 표기(:443)는 같은 출처다', async () => {
    const withPort = { ...scope, allowedOrigins: ['a.example', 'a.example:8443'] };
    const f = fetcherOf({ 'https://a.example/docs/a': redirect('https://a.example:8443/docs/b'), 'https://a.example:8443/docs/b': redirect('https://a.example:443/docs/c'), 'https://a.example/docs/c': ok() });
    const res = await fetchFollowingRedirects(f, { ...baseReq, allowedOrigins: withPort.allowedOrigins, url: 'https://a.example/docs/a' }, { allowQueryUrls: false, scope: withPort });
    expect(res).toMatchObject({ kind: 'RESPONSE', finalUrl: 'https://a.example/docs/c' });
  });

  it('재개한 홉 URL의 포트가 출처 집합에서 빠졌으면 요청하지 않고 SCOPE로 끝낸다', async () => {
    const f = fetcherOf({ 'https://a.example:8443/docs/h1': ok() });
    const res = await fetchFollowingRedirects(
      f,
      { ...baseReq, url: 'https://a.example/docs/h0', resume: { url: 'https://a.example:8443/docs/h1', hop: 1, visited: ['https://a.example/docs/h0'] } },
      { allowQueryUrls: false, scope },
    );
    expect(res).toMatchObject({ kind: 'REDIRECT_OUT_OF_SCOPE', reason: 'SCOPE' });
    expect(f.urls).toHaveLength(0);
  });
});
