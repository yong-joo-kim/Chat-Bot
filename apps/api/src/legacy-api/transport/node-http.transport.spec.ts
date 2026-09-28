import * as http from 'node:http';
import { NodeHttpTransport } from './node-http.transport';
import type { LegacyTransportRequest } from './legacy-transport.port';
import { parseXRobotsTag } from '../../kb-sync/lib/x-robots-tag';

/**
 * [pass 6 · Low-8] 실제 `NodeHttpTransport`를 로컬 HTTP 서버에 연결해 확인한다. 예전 시험은 통합 시험의 **가짜 전송**이 헤더 캡처를
 * 자체 구현(배열 헤더는 버림)해 실제 경로가 검증되지 않았다 — 여기서는 진짜 전송의 ① `captureHeaders`(같은 이름 여러 줄을 쉼표로 결합)
 * ② `redirectMode: 'REPORT'` · 기본값(`FAIL`, No.26 레거시·웹훅 동작) ③ `retry-after` 캡처를 본다.
 * 검증 주소 고정(`pinnedAddresses`)은 로컬 서버(127.0.0.1)로 — 절대 차단 판정은 이 계층 위(fetcher)의 일이다.
 */
describe('NodeHttpTransport (실제 전송 · 로컬 서버)', () => {
  let server: http.Server;
  let port = 0;
  const transport = new NodeHttpTransport();

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const path = new URL(req.url ?? '/', 'http://x').pathname;
      if (path === '/multi') {
        // 같은 이름의 헤더 2줄 — 배열로 보내면 Node가 각각 별도 헤더 줄로 쓴다.
        res.setHeader('X-Robots-Tag', ['googlebot: noindex', 'noindex']);
        res.setHeader('ETag', '"abc"');
        res.setHeader('Last-Modified', 'Wed, 21 Oct 2015 07:28:00 GMT');
        res.setHeader('X-Not-Captured', 'secret');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<html>ok</html>');
        return;
      }
      if (path === '/redirect') {
        res.writeHead(302, { Location: '/target', 'Content-Length': '5' });
        res.end('moved');
        return;
      }
      if (path === '/ratelimited') {
        res.writeHead(429, { 'Retry-After': '7' });
        res.end();
        return;
      }
      if (path === '/single') {
        res.writeHead(200, { 'X-Robots-Tag': 'nofollow', 'Content-Type': 'text/plain' });
        res.end('x');
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    port = typeof address === 'object' && address !== null ? address.port : 0;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const base = (path: string, extra: Partial<LegacyTransportRequest> = {}): LegacyTransportRequest => ({
    url: `http://kb-test.example:${port}${path}`,
    method: 'GET',
    headers: {},
    body: null,
    pinnedAddresses: ['127.0.0.1'],
    hostname: 'kb-test.example',
    timeoutMs: 5000,
    maxBytes: 1024 * 1024,
    exitId: 'KB_CRAWL',
    ...extra,
  });

  it('★ captureHeaders — 요청한 헤더만 소문자 키로 돌려주고, 같은 이름 여러 줄은 쉼표로 결합한다', async () => {
    const res = await transport.request(base('/multi', { captureHeaders: ['x-robots-tag', 'etag', 'last-modified', 'retry-after'] }));
    expect(res.kind).toBe('RESPONSE');
    if (res.kind !== 'RESPONSE') return;
    expect(res.headers).toEqual({
      'x-robots-tag': 'googlebot: noindex, noindex',
      etag: '"abc"',
      'last-modified': 'Wed, 21 Oct 2015 07:28:00 GMT',
    });
    expect(res.headers).not.toHaveProperty('x-not-captured');
    expect(res.contentType).toContain('text/html');
    expect(res.body.toString()).toBe('<html>ok</html>');
  });

  it('captureHeaders를 주지 않으면 headers 키 자체가 없다(No.26·웹훅 호출부 무수정)', async () => {
    const res = await transport.request(base('/multi'));
    expect(res.kind).toBe('RESPONSE');
    if (res.kind === 'RESPONSE') expect('headers' in res).toBe(false);
  });

  it('★ 결합된 X-Robots-Tag를 그대로 해석해도 우리에게 준 noindex를 놓치지 않는다(안전한 방향 — RG-20④)', async () => {
    const res = await transport.request(base('/multi', { captureHeaders: ['x-robots-tag'] }));
    if (res.kind !== 'RESPONSE') throw new Error('응답이어야 한다');
    // 'googlebot: noindex' 줄 뒤의 접두 없는 'noindex' 줄은 모든 봇용 — 줄 경계가 사라져도 우리에게 적용된다.
    expect(parseXRobotsTag(res.headers?.['x-robots-tag'], 'chatbotkbcrawler').noindex).toBe(true);
  });

  it('★ redirectMode REPORT — 3xx를 오류가 아니라 RESPONSE(본문 비움 · location 헤더)로 돌려준다', async () => {
    const res = await transport.request(base('/redirect', { redirectMode: 'REPORT', captureHeaders: ['location'] }));
    expect(res.kind).toBe('RESPONSE');
    if (res.kind !== 'RESPONSE') return;
    expect(res.status).toBe(302);
    expect(res.body.length).toBe(0);
    expect(res.headers?.location).toBe('/target');
  });

  it('★ 기본(redirectMode 미지정 · FAIL)은 현행 동작 — 3xx는 REDIRECT_NOT_ALLOWED 오류(No.26)', async () => {
    const res = await transport.request(base('/redirect'));
    expect(res).toEqual({ kind: 'ERROR', outcome: 'REDIRECT_NOT_ALLOWED' });
    const explicit = await transport.request(base('/redirect', { redirectMode: 'FAIL' }));
    expect(explicit).toEqual({ kind: 'ERROR', outcome: 'REDIRECT_NOT_ALLOWED' });
  });

  it('★ retry-after 캡처 — captureHeaders로 요청하면 헤더 맵에 담긴다(크롤러의 429·503 지연 근거)', async () => {
    const captured = await transport.request(base('/ratelimited', { captureHeaders: ['retry-after'] }));
    if (captured.kind !== 'RESPONSE') throw new Error('응답이어야 한다');
    expect(captured.status).toBe(429);
    expect(captured.headers?.['retry-after']).toBe('7');

    const plain = await transport.request(base('/ratelimited'));
    if (plain.kind !== 'RESPONSE') throw new Error('응답이어야 한다');
    expect(plain.status).toBe(429);
    expect('headers' in plain).toBe(false); // 요청하지 않으면 키 없음(No.26 무수정).
  });

  it('STATUS_ONLY(업무 자동화 웹훅)는 기존대로 결과 retryAfter 필드에 담긴다', async () => {
    const res = await transport.request(base('/ratelimited', { responseMode: 'STATUS_ONLY' }));
    if (res.kind !== 'RESPONSE') throw new Error('응답이어야 한다');
    expect(res.retryAfter).toBe('7');
  });

  it('한 줄짜리 헤더는 그대로 돌려준다', async () => {
    const res = await transport.request(base('/single', { captureHeaders: ['x-robots-tag'] }));
    if (res.kind !== 'RESPONSE') throw new Error('응답이어야 한다');
    expect(res.headers).toEqual({ 'x-robots-tag': 'nofollow' });
  });
});
