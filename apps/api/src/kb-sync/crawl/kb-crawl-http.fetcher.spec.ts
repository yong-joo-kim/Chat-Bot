import { KbCrawlHttpFetcher } from './kb-crawl-http.fetcher';
import type { LegacyDnsResolver, LegacyTransport, LegacyTransportRequest, LegacyTransportResult } from '../../legacy-api/transport/legacy-transport.port';

/** [R1 리뷰 M-3 · §6.2] 실행 안에서 호스트별 DNS 결과를 5분 캐시하되, 판정(사설망 허용 목록 등)은
 * 캐시와 무관하게 매번 다시 하는지 검증한다. */
function makeConfig(values: Record<string, unknown>) {
  return { get: (key: string) => values[key] } as never;
}

function makeOkTransport(): LegacyTransport {
  return {
    async request(_req: LegacyTransportRequest): Promise<LegacyTransportResult> {
      return { kind: 'RESPONSE', status: 200, contentType: 'text/html', bytes: 2, body: Buffer.from('ok'), headers: {} };
    },
  };
}

describe('KbCrawlHttpFetcher — 항목 M-3 DNS 5분 캐시(핀 연결은 캐시, 판정은 매번)', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('같은 호스트를 반복 방문해도 DNS 조회는 1회만 한다(캐시 적중)', async () => {
    const lookupAll = jest.fn().mockResolvedValue(['203.0.113.10']);
    const dnsResolver: LegacyDnsResolver = { lookupAll };
    const fetcher = new KbCrawlHttpFetcher(makeOkTransport(), dnsResolver, makeConfig({ KB_CRAWL_PRIVATE_ALLOWLIST: '' }));

    const req = { url: 'https://cached.example.invalid/a', allowedHosts: ['cached.example.invalid'], allowedOrigins: ['cached.example.invalid'], maxBytes: 1000, timeoutMs: 1000 };
    await fetcher.fetchOnce(req);
    await fetcher.fetchOnce({ ...req, url: 'https://cached.example.invalid/b' });
    await fetcher.fetchOnce({ ...req, url: 'https://cached.example.invalid/c' });

    expect(lookupAll).toHaveBeenCalledTimes(1);
    expect(lookupAll).toHaveBeenCalledWith('cached.example.invalid');
  });

  it('다른 호스트는 각각 별도로 조회한다(호스트별 캐시 — 서로 섞이지 않는다)', async () => {
    const lookupAll = jest.fn().mockResolvedValue(['203.0.113.10']);
    const dnsResolver: LegacyDnsResolver = { lookupAll };
    const fetcher = new KbCrawlHttpFetcher(makeOkTransport(), dnsResolver, makeConfig({ KB_CRAWL_PRIVATE_ALLOWLIST: '' }));

    await fetcher.fetchOnce({ url: 'https://host-a.example.invalid/', allowedHosts: ['host-a.example.invalid'], allowedOrigins: ['host-a.example.invalid'], maxBytes: 1000, timeoutMs: 1000 });
    await fetcher.fetchOnce({ url: 'https://host-b.example.invalid/', allowedHosts: ['host-b.example.invalid'], allowedOrigins: ['host-b.example.invalid'], maxBytes: 1000, timeoutMs: 1000 });

    expect(lookupAll).toHaveBeenCalledTimes(2);
  });

  it('★ 5분이 지나면 캐시가 만료돼 다시 조회한다', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask'] });
    const lookupAll = jest.fn().mockResolvedValue(['203.0.113.10']);
    const dnsResolver: LegacyDnsResolver = { lookupAll };
    const fetcher = new KbCrawlHttpFetcher(makeOkTransport(), dnsResolver, makeConfig({ KB_CRAWL_PRIVATE_ALLOWLIST: '' }));
    const req = { url: 'https://ttl.example.invalid/', allowedHosts: ['ttl.example.invalid'], allowedOrigins: ['ttl.example.invalid'], maxBytes: 1000, timeoutMs: 1000 };

    await fetcher.fetchOnce(req);
    expect(lookupAll).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(4 * 60_000); // 4분 — 아직 캐시 유효.
    await fetcher.fetchOnce(req);
    expect(lookupAll).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(2 * 60_000); // 총 6분 — 5분 상한을 넘겼다.
    await fetcher.fetchOnce(req);
    expect(lookupAll).toHaveBeenCalledTimes(2);
  });

  it('빈 조회 결과(DNS 실패)는 캐시하지 않는다 — 다음 호출이 다시 시도한다', async () => {
    const lookupAll = jest.fn().mockResolvedValueOnce([]).mockResolvedValueOnce(['203.0.113.10']);
    const dnsResolver: LegacyDnsResolver = { lookupAll };
    const fetcher = new KbCrawlHttpFetcher(makeOkTransport(), dnsResolver, makeConfig({ KB_CRAWL_PRIVATE_ALLOWLIST: '' }));
    const req = { url: 'https://flaky.example.invalid/', allowedHosts: ['flaky.example.invalid'], allowedOrigins: ['flaky.example.invalid'], maxBytes: 1000, timeoutMs: 1000 };

    const first = await fetcher.fetchOnce(req);
    expect(first).toEqual({ kind: 'BLOCKED', reason: 'DNS_FAILED' });
    const second = await fetcher.fetchOnce(req);
    expect(second.kind).toBe('RESPONSE');
    expect(lookupAll).toHaveBeenCalledTimes(2); // 실패는 캐시되지 않아 재시도됐다.
  });

  it('★ 판정(사설망 허용 목록)은 DNS가 캐시돼도 매번 최신 설정으로 다시 한다', async () => {
    // 사설 대역 주소로 캐시를 채운다 — 처음엔 허용 목록에 없어 차단, 나중엔 같은 캐시된 주소인데도
    // 허용 목록이 바뀌면 통과해야 한다(판정이 캐시되지 않았다는 증거).
    const lookupAll = jest.fn().mockResolvedValue(['10.1.2.3']);
    const dnsResolver: LegacyDnsResolver = { lookupAll };
    let allowlistValue = '';
    const config = { get: (key: string) => (key === 'KB_CRAWL_PRIVATE_ALLOWLIST' ? allowlistValue : undefined) } as never;
    const fetcher = new KbCrawlHttpFetcher(makeOkTransport(), dnsResolver, config);
    const req = { url: 'https://private.example.invalid/', allowedHosts: ['private.example.invalid'], allowedOrigins: ['private.example.invalid'], maxBytes: 1000, timeoutMs: 1000 };

    const blocked = await fetcher.fetchOnce(req);
    expect(blocked).toEqual({ kind: 'BLOCKED', reason: 'PRIVATE_NOT_ALLOWLISTED' });

    allowlistValue = '10.1.2.3'; // 운영자가 방금 허용 목록에 추가했다고 가정.
    const allowed = await fetcher.fetchOnce(req);
    expect(allowed.kind).toBe('RESPONSE'); // 같은(캐시된) 주소인데 판정 결과가 바뀌었다 — 판정이 매번 새로 돌았다는 뜻.
    expect(lookupAll).toHaveBeenCalledTimes(1); // 그런데도 DNS 조회는 1번뿐이다(핀 연결은 캐시 그대로).
  });

  it.each([
    [304, 'RESPONSE'],
    [302, 'REDIRECT'],
    [301, 'REDIRECT'],
  ] as const)('★ %s 응답은 %s로 돌려준다 — 304(조건부 요청의 변경 없음)를 리다이렉트로 오인해 접속 오류로 만들지 않는다', async (code, kind) => {
    const transport: LegacyTransport = {
      async request(): Promise<LegacyTransportResult> {
        return { kind: 'RESPONSE', status: code, contentType: undefined, bytes: 0, body: Buffer.alloc(0), headers: code === 304 ? { etag: '"v1"' } : { location: '/next' } };
      },
    };
    const fetcher = new KbCrawlHttpFetcher(transport, { lookupAll: jest.fn().mockResolvedValue(['203.0.113.10']) }, makeConfig({ KB_CRAWL_PRIVATE_ALLOWLIST: '' }));
    const res = await fetcher.fetchOnce({ url: 'https://cond.example.invalid/', allowedHosts: ['cond.example.invalid'], allowedOrigins: ['cond.example.invalid'], maxBytes: 1000, timeoutMs: 1000 });
    expect(res.kind).toBe(kind);
    if (res.kind === 'RESPONSE') expect(res.status).toBe(304);
  });

  it('응답 헤더 retry-after를 캡처 목록에 넣어 요청한다(429·503 재시도 지연 — RG-4)', async () => {
    const request = jest.fn(async (_req: LegacyTransportRequest): Promise<LegacyTransportResult> => ({ kind: 'RESPONSE', status: 200, contentType: 'text/html', bytes: 0, body: Buffer.alloc(0), headers: {} }));
    const fetcher = new KbCrawlHttpFetcher({ request }, { lookupAll: jest.fn().mockResolvedValue(['203.0.113.10']) }, makeConfig({ KB_CRAWL_PRIVATE_ALLOWLIST: '' }));
    await fetcher.fetchOnce({ url: 'https://cap.example.invalid/', allowedHosts: ['cap.example.invalid'], allowedOrigins: ['cap.example.invalid'], maxBytes: 1000, timeoutMs: 1000 });
    expect(request.mock.calls[0][0].captureHeaders).toEqual(expect.arrayContaining(['retry-after', 'x-robots-tag', 'etag']));
  });
});


describe('KbCrawlHttpFetcher — pass 12 · RG-26 허용 출처(host:port) 단계', () => {
  const dnsResolver: LegacyDnsResolver = { lookupAll: jest.fn().mockResolvedValue(['203.0.113.10']) };
  const requestSpy = () => jest.fn(async (_req: LegacyTransportRequest): Promise<LegacyTransportResult> => ({ kind: 'RESPONSE', status: 200, contentType: 'text/html', bytes: 2, body: Buffer.from('ok'), headers: {} }));
  const base = { allowedHosts: ['a.example.invalid'], maxBytes: 1000, timeoutMs: 1000 };

  it('★ 호스트 이름이 허용돼도 출처 집합에 없는 포트는 HOST_NOT_ALLOWED — 전송·DNS 조회가 나가지 않는다', async () => {
    const request = requestSpy();
    const lookupAll = jest.fn().mockResolvedValue(['203.0.113.10']);
    const fetcher = new KbCrawlHttpFetcher({ request }, { lookupAll }, makeConfig({ KB_CRAWL_PRIVATE_ALLOWLIST: '' }));
    const res = await fetcher.fetchOnce({ ...base, url: 'https://a.example.invalid:8443/x', allowedOrigins: ['a.example.invalid'] });
    expect(res).toEqual({ kind: 'BLOCKED', reason: 'HOST_NOT_ALLOWED' });
    expect(request).not.toHaveBeenCalled();
    expect(lookupAll).not.toHaveBeenCalled();
  });

  it('명시된 포트는 통과하고, 기본 포트 표기 차이(:443)는 같은 출처다', async () => {
    const request = requestSpy();
    const fetcher = new KbCrawlHttpFetcher({ request }, dnsResolver, makeConfig({ KB_CRAWL_PRIVATE_ALLOWLIST: '' }));
    expect((await fetcher.fetchOnce({ ...base, url: 'https://a.example.invalid:8443/x', allowedOrigins: ['a.example.invalid:8443'] })).kind).toBe('RESPONSE');
    expect((await fetcher.fetchOnce({ ...base, url: 'https://a.example.invalid:443/x', allowedOrigins: ['a.example.invalid'] })).kind).toBe('RESPONSE');
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('출처 집합이 비면 어떤 URL도 HOST_NOT_ALLOWED', async () => {
    const request = requestSpy();
    const fetcher = new KbCrawlHttpFetcher({ request }, dnsResolver, makeConfig({ KB_CRAWL_PRIVATE_ALLOWLIST: '' }));
    expect(await fetcher.fetchOnce({ ...base, url: 'https://a.example.invalid/x', allowedOrigins: [] })).toEqual({ kind: 'BLOCKED', reason: 'HOST_NOT_ALLOWED' });
  });
});
