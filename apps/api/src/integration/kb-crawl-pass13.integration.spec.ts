import { KbIngestRunner } from '../kb-sync/engine/kb-ingest.runner';
import { InProcessExtractor } from '../kb-sync/extract/in-process.extractor';
import { buildExternalFileName, urlHash } from '../kb-sync/lib/external-file-name';
import { FakeFetcher, HOST, createHarness, html, makeConfig, page } from './helpers/kb-crawl-db-harness';
import type { Harness } from './helpers/kb-crawl-db-harness';

/**
 * 지식베이스 크롤링(No.43) 백엔드 pass 13 — RG-28: `URL.host`는 스킴 기본 포트를 지워 `https://a`와 `http://a`가 같은 출처로 보이므로,
 * https 시작 주소 소스가 링크·사이트맵에서 만난 같은 호스트의 `http://` URL 첫 요청에 인증 헤더가 **평문으로** 나갔다(크롤 `applyAuthHeader` · 적재 `applyAuth`).
 * 이제 평문 `http:` 요청에는 `http:`를 명시한 시작 주소·사이트맵 출처에만 헤더를 싣는다. **범위 판정은 그대로**(`http://a/x`는 수집될 수 있으나 헤더는 없다).
 * 실제 DB(SQLite 마이그레이션 적용) + 실제 저장소·서비스·러너, 네트워크·시간·문서 해석·외부 RAG만 가짜.
 */
const PLAIN = 'http://a.example';
const AUTH = { kind: 'STATIC_HEADER' as const, headerName: 'X-Api-Key', secretRef: 'KB_TEST' };
const KEY = 'x-api-key';
const redirect = (location: string, code = 302) => ({ kind: 'REDIRECT' as const, status: code, location, headers: {} });
const robots = (f: FakeFetcher, origin: string): FakeFetcher => f.route(`${origin}/robots.txt`, html('User-agent: *\nAllow: /\n'));
const bothRobots = (f: FakeFetcher): FakeFetcher => robots(robots(f, HOST), PLAIN);
const sitemap = (locs: string[]) => ({ kind: 'RESPONSE' as const, status: 200, contentType: 'application/xml', body: Buffer.from(`<?xml version="1.0"?><urlset>${locs.map((l) => `<url><loc>${l}</loc></url>`).join('')}</urlset>`), headers: {} });

function makeRag() {
  return {
    isConfigured: () => true,
    status: jest.fn(async () => ({ networkError: false, httpStatus: 200, body: { vllm_ready: true } })),
    ingest: jest.fn(async () => ({ networkError: false, httpStatus: 200, body: { result: 'RAG Vector DB 추가 성공.' } })),
    taskStatus: jest.fn(),
  };
}

describe('KB pass 13 — RG-28 평문 http 요청의 인증 헤더', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await createHarness('pass13');
  }, 60_000);

  afterAll(async () => {
    await h?.dispose();
  }, 15_000);

  afterEach(async () => {
    jest.restoreAllMocks();
    await h.prisma.kbSyncRun.updateMany({ where: { status: { in: ['QUEUED', 'CRAWLING', 'INGESTING'] } }, data: { status: 'CANCELLED', finishedAt: new Date(), claimToken: null } });
    await h.prisma.kbSource.updateMany({ data: { activeRunId: null } });
    await h.prisma.kbIngestJob.deleteMany({});
    await h.prisma.kbDocument.deleteMany({});
    await h.prisma.kbSource.deleteMany({});
  });

  const headerOf = (f: FakeFetcher, url: string) => f.requests.find((r) => r.url === url)?.headers[KEY];

  async function ingestPendingJob(sourceId: string, docUrl: string) {
    const runId = await h.startRun(sourceId, 'SYNC');
    await h.prisma.kbSyncRun.update({ where: { id: runId }, data: { status: 'INGESTING' } });
    const doc = await h.prisma.kbDocument.create({
      data: { sourceId, url: docUrl, urlHash: urlHash(docUrl), kind: 'HTML', externalFileName: buildExternalFileName(sourceId, docUrl, 'html'), seenRunId: runId, visitState: 'VISITED' },
    });
    await h.store.createIngestJobsBulk([{ runId, sourceId, documentId: doc.id, lane: 'INCREMENTAL', reason: 'NEW' }]);
  }

  function makeIngestRunner(fetcher: FakeFetcher) {
    const rag = makeRag();
    const runner = new KbIngestRunner(h.store, h.sourcesService, h.prisma, rag as never, fetcher as never, { get: () => 'top-secret' } as never, makeConfig({ KB_INGEST_POLL_MS: 10 }), new InProcessExtractor(), { tryAcquire: () => true } as never);
    return { runner, rag };
  }

  const crawl = async (id: string, fetcher: FakeFetcher) => {
    const { runner } = h.makeRunner({ fetcher, secretResolver: { get: () => 'top-secret' } });
    return h.drive(runner, await h.startRun(id, 'PREVIEW'));
  };

  describe('(a) https 시작 주소 — 링크로 발견한 같은 호스트의 http: URL', () => {
    it('★ 크롤 — 요청은 범위 안이라 나가지만 인증 헤더는 없다(https 요청에는 그대로 실린다)', async () => {
      const { id } = await h.createSource({ auth: AUTH });
      const fetcher = bothRobots(new FakeFetcher())
        .route(`${HOST}/docs/`, html(page('목록', [`${PLAIN}/docs/x`, '/docs/ok'])))
        .route(`${HOST}/docs/ok`, html(page('https')))
        .route(`${PLAIN}/docs/x`, html(page('http')));
      await crawl(id, fetcher);
      expect(fetcher.hitsOf(`${PLAIN}/docs/x`)).toBe(1); // 범위 판정은 바뀌지 않았다.
      expect(headerOf(fetcher, `${PLAIN}/docs/x`)).toBeUndefined();
      expect(headerOf(fetcher, `${HOST}/docs/`)).toBe('top-secret');
      expect(headerOf(fetcher, `${HOST}/docs/ok`)).toBe('top-secret');
      // 어떤 평문 요청에도 헤더가 없다(robots 포함).
      expect(fetcher.requests.filter((r) => r.url.startsWith('http://')).every((r) => r.headers[KEY] === undefined)).toBe(true);
    });

    it('★ 적재 재수집 — 문서 URL이 http:면 요청은 나가도 인증 헤더는 없다', async () => {
      const { id } = await h.createSource({ auth: AUTH });
      await ingestPendingJob(id, `${PLAIN}/docs/x`);
      const fetcher = new FakeFetcher().route(`${PLAIN}/docs/x`, html(page('http 문서')));
      const { runner, rag } = makeIngestRunner(fetcher);
      await runner.runFragment(new Date());
      expect(fetcher.urls()).toEqual([`${PLAIN}/docs/x`]);
      expect(fetcher.requests[0].headers[KEY]).toBeUndefined();
      expect(rag.ingest).toHaveBeenCalled();
    });

    it('대조 — 같은 소스의 https 문서 재수집에는 헤더가 실린다', async () => {
      const { id } = await h.createSource({ auth: AUTH });
      await ingestPendingJob(id, `${HOST}/docs/x`);
      const fetcher = new FakeFetcher().route(`${HOST}/docs/x`, html(page('https 문서')));
      await makeIngestRunner(fetcher).runner.runFragment(new Date());
      expect(fetcher.requests[0].headers[KEY]).toBe('top-secret');
    });
  });

  describe('(b) https 시작 주소 + 사이트맵 URL이 http:를 명시 — 그 http: 출처에는 헤더가 실린다', () => {
    it('★ 크롤 — 사이트맵 항목·링크의 http: 요청에 헤더 · 사이트맵 파일 요청에는 없다', async () => {
      const { id } = await h.createSource({ auth: AUTH, sitemapUrls: [`${PLAIN}/sitemap.xml`] });
      const fetcher = bothRobots(new FakeFetcher())
        .route(`${PLAIN}/sitemap.xml`, sitemap([`${PLAIN}/docs/s1`]))
        .route(`${HOST}/docs/`, html(page('목록', [`${PLAIN}/docs/link`])))
        .route(`${PLAIN}/docs/s1`, html(page('사이트맵 항목')))
        .route(`${PLAIN}/docs/link`, html(page('링크')));
      await crawl(id, fetcher);
      expect(headerOf(fetcher, `${PLAIN}/docs/s1`)).toBe('top-secret');
      expect(headerOf(fetcher, `${PLAIN}/docs/link`)).toBe('top-secret');
      expect(headerOf(fetcher, `${PLAIN}/sitemap.xml`)).toBeUndefined();
      expect(headerOf(fetcher, `${PLAIN}/robots.txt`)).toBeUndefined();
    });

    it('★ 적재 재수집 — http: 문서에 헤더가 실린다', async () => {
      const { id } = await h.createSource({ auth: AUTH, sitemapUrls: [`${PLAIN}/sitemap.xml`] });
      await ingestPendingJob(id, `${PLAIN}/docs/s1`);
      const fetcher = new FakeFetcher().route(`${PLAIN}/docs/s1`, html(page('http 문서')));
      await makeIngestRunner(fetcher).runner.runFragment(new Date());
      expect(fetcher.requests[0].headers[KEY]).toBe('top-secret');
    });
  });

  describe('(c) http 시작 주소 소스 — http: 요청에 헤더가 실린다(기존 동작)', () => {
    it('★ 크롤 — 시작 주소·같은 출처 http 링크', async () => {
      const { id } = await h.createSource({ auth: AUTH, seedUrls: [`${PLAIN}/docs/`] });
      const fetcher = bothRobots(new FakeFetcher())
        .route(`${PLAIN}/docs/`, html(page('목록', ['/docs/y'])))
        .route(`${PLAIN}/docs/y`, html(page('http 링크')));
      await crawl(id, fetcher);
      expect(headerOf(fetcher, `${PLAIN}/docs/`)).toBe('top-secret');
      expect(headerOf(fetcher, `${PLAIN}/docs/y`)).toBe('top-secret');
    });

    it('★ 적재 재수집 — http 문서', async () => {
      const { id } = await h.createSource({ auth: AUTH, seedUrls: [`${PLAIN}/docs/`] });
      await ingestPendingJob(id, `${PLAIN}/docs/y`);
      const ingestFetcher = new FakeFetcher().route(`${PLAIN}/docs/y`, html(page('http 문서')));
      await makeIngestRunner(ingestFetcher).runner.runFragment(new Date());
      expect(ingestFetcher.requests[0].headers[KEY]).toBe('top-secret');
    });
  });

  describe('(d) http→https 상향은 헤더를 유지한다(TLS)', () => {
    it('★ 크롤 — http 시작 주소가 https 링크·리다이렉트(홉 1)로 가도 헤더가 실린다', async () => {
      const { id } = await h.createSource({ auth: AUTH, seedUrls: [`${PLAIN}/docs/`] });
      const fetcher = bothRobots(new FakeFetcher())
        .route(`${PLAIN}/docs/`, html(page('목록', [`${HOST}/docs/up`, '/docs/r'])))
        .route(`${HOST}/docs/up`, html(page('https 링크')))
        .route(`${PLAIN}/docs/r`, redirect(`${HOST}/docs/target`))
        .route(`${HOST}/docs/target`, html(page('리다이렉트 목적지')));
      await crawl(id, fetcher);
      expect(headerOf(fetcher, `${HOST}/docs/up`)).toBe('top-secret');
      expect(headerOf(fetcher, `${HOST}/docs/target`)).toBe('top-secret'); // 홉 1 — 시작 URL과 같은 host:port(기본 포트 정규화).
    });

    it('★ 적재 재수집 — http 문서가 https로 상향 리다이렉트되면 홉 1에도 헤더가 실린다', async () => {
      const { id } = await h.createSource({ auth: AUTH, seedUrls: [`${PLAIN}/docs/`] });
      await ingestPendingJob(id, `${PLAIN}/docs/r`);
      const fetcher = new FakeFetcher().route(`${PLAIN}/docs/r`, redirect(`${HOST}/docs/target`)).route(`${HOST}/docs/target`, html(page('목적지')));
      await makeIngestRunner(fetcher).runner.runFragment(new Date());
      expect(fetcher.requests[0].headers[KEY]).toBe('top-secret');
      expect(fetcher.requests[1]).toMatchObject({ url: `${HOST}/docs/target` });
      expect(fetcher.requests[1].headers[KEY]).toBe('top-secret');
    });
  });

  describe('(e) 기본 포트 표기 차이(:443 명시 · 생략)는 같은 출처 — https 요청 헤더는 그대로다', () => {
    it('★ 시작 주소 https://a:443 — 포트 없는 https 링크는 헤더 · 같은 호스트 http는 여전히 없다', async () => {
      const { id } = await h.createSource({ auth: AUTH, seedUrls: [`${HOST}:443/docs/`] });
      const fetcher = bothRobots(new FakeFetcher())
        .route(`${HOST}/docs/`, html(page('목록', [`${HOST}/docs/n1`, `${PLAIN}/docs/n2`])))
        .route(`${HOST}/docs/n1`, html(page('N1')))
        .route(`${PLAIN}/docs/n2`, html(page('N2')));
      await crawl(id, fetcher);
      expect(headerOf(fetcher, `${HOST}/docs/n1`)).toBe('top-secret');
      expect(fetcher.hitsOf(`${PLAIN}/docs/n2`)).toBe(1);
      expect(headerOf(fetcher, `${PLAIN}/docs/n2`)).toBeUndefined();
    });
  });
});
