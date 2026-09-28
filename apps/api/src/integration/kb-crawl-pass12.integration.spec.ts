import { strFromU8, unzipSync } from 'fflate';
import { KbIngestRunner } from '../kb-sync/engine/kb-ingest.runner';
import { InProcessExtractor } from '../kb-sync/extract/in-process.extractor';
import { buildExternalFileName, urlHash } from '../kb-sync/lib/external-file-name';
import { FakeFetcher, HOST, createHarness, html, makeConfig, page } from './helpers/kb-crawl-db-harness';
import type { Harness } from './helpers/kb-crawl-db-harness';

/**
 * 지식베이스 크롤링(No.43) 백엔드 pass 12 — RG-26 / U-5(b): 범위·허용 호스트 검사·인증 헤더 판정이 **호스트 이름만이 아니라 host:port(허용 출처)**를 본다.
 * 허용 출처 = 시작 주소·사이트맵 URL에서 실행 시점에 계산(스키마·`allowedHosts` 저장 형식 변경 없음). 실제 DB(SQLite 마이그레이션 적용) + 실제 저장소·서비스·러너, 네트워크·시간·문서 해석·외부 RAG만 가짜.
 */
const DOCS = `${HOST}/docs/`;
const OTHER = 'https://a.example:8443';
const AUTH = { kind: 'STATIC_HEADER' as const, headerName: 'X-Api-Key', secretRef: 'KB_TEST' };
const redirect = (location: string, code = 302) => ({ kind: 'REDIRECT' as const, status: code, location, headers: {} });
const okRobots = (f: FakeFetcher, origin = HOST): FakeFetcher => f.route(`${origin}/robots.txt`, html('User-agent: *\nAllow: /\n'));

const portOf = (url: string): string => new URL(url).port;
/** 요청이 나간 URL 중 기본 포트가 아닌 포트를 가진 것. */
const nonDefaultPortRequests = (f: FakeFetcher): string[] => f.urls().filter((u) => portOf(u) !== '');

function makeRag() {
  return {
    isConfigured: () => true,
    status: jest.fn(async () => ({ networkError: false, httpStatus: 200, body: { vllm_ready: true } })),
    ingest: jest.fn(async () => ({ networkError: false, httpStatus: 200, body: { result: 'RAG Vector DB 추가 성공.' } })),
    taskStatus: jest.fn(),
  };
}

describe('KB pass 12 — RG-26 허용 출처(host:port)', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await createHarness('pass12');
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

  async function addDocUrl(sourceId: string, url: string, over: Record<string, unknown> = {}) {
    return h.prisma.kbDocument.create({
      data: { sourceId, url, urlHash: urlHash(url), kind: 'HTML', externalFileName: buildExternalFileName(sourceId, url, 'html'), seenRunId: 'old-run', visitState: 'VISITED', ...over },
    });
  }

  async function ingestPendingJob(sourceId: string, docUrl: string) {
    const runId = await h.startRun(sourceId, 'SYNC');
    await h.prisma.kbSyncRun.update({ where: { id: runId }, data: { status: 'INGESTING' } });
    const doc = await addDocUrl(sourceId, docUrl, { seenRunId: runId });
    await h.store.createIngestJobsBulk([{ runId, sourceId, documentId: doc.id, lane: 'INCREMENTAL', reason: 'NEW' }]);
    return { runId, job: await h.prisma.kbIngestJob.findFirstOrThrow({ where: { runId } }) };
  }

  function makeIngestRunner(fetcher: FakeFetcher) {
    const rag = makeRag();
    const runner = new KbIngestRunner(h.store, h.sourcesService, h.prisma, rag as never, fetcher as never, { get: () => 'top-secret' } as never, makeConfig({ KB_INGEST_POLL_MS: 10 }), new InProcessExtractor(), { tryAcquire: () => true } as never);
    return { runner, rag };
  }

  describe('(a) 링크로 발견한 같은 호스트의 다른 포트 URL은 범위 밖이다', () => {
    it.each([
      ['인증 없음', { kind: 'NONE' as const }],
      ['인증 있음', AUTH],
    ])('★ %s — 요청이 나가지 않고 범위 밖 링크로 센다', async (_l, auth) => {
      const { id } = await h.createSource({ auth });
      const fetcher = okRobots(new FakeFetcher())
        .route(DOCS, html(page('목록', [`${OTHER}/docs/x`, '/docs/ok'])))
        .route(`${HOST}/docs/ok`, html(page('같은 출처')))
        .route(`${OTHER}/docs/x`, html(page('다른 포트')));
      const { runner } = h.makeRunner({ fetcher, secretResolver: { get: () => 'top-secret' } });
      const run = await h.drive(runner, await h.startRun(id, 'PREVIEW'));
      expect(nonDefaultPortRequests(fetcher)).toEqual([]);
      expect(fetcher.hitsOf(`${HOST}/docs/ok`)).toBe(1);
      expect((JSON.parse(run.counts) as { outOfScopeLinks: number }).outOfScopeLinks).toBe(1);
      expect(await h.prisma.kbDocument.count({ where: { sourceId: id, url: `${OTHER}/docs/x` } })).toBe(0);
    });
  });

  describe('(b) 시작 주소에 명시한 포트의 URL은 범위 안이고 요청에 인증 헤더가 실린다', () => {
    it('★ 시작 주소 · 그 포트의 링크 · robots.txt(그 포트에서 읽는다 · 헤더 없음)', async () => {
      const { id } = await h.createSource({ auth: AUTH, seedUrls: [`${OTHER}/docs/`] });
      const fetcher = okRobots(new FakeFetcher(), OTHER)
        .route(`${OTHER}/docs/`, html(page('목록', ['/docs/y', `${HOST}/docs/default-port`])))
        .route(`${OTHER}/docs/y`, html(page('같은 포트')))
        .route(`${HOST}/docs/default-port`, html(page('기본 포트')));
      const { runner } = h.makeRunner({ fetcher, secretResolver: { get: () => 'top-secret' } });
      const run = await h.drive(runner, await h.startRun(id, 'PREVIEW'));
      const req = (url: string) => fetcher.requests.find((r) => r.url === url);
      expect(req(`${OTHER}/docs/`)?.headers['x-api-key']).toBe('top-secret');
      expect(req(`${OTHER}/docs/y`)?.headers['x-api-key']).toBe('top-secret');
      // 시작 주소에 명시하지 않은 기본 포트는 이 소스의 허용 출처가 아니다 — 링크는 범위 밖, 요청 0.
      expect(req(`${HOST}/docs/default-port`)).toBeUndefined();
      expect(fetcher.urls().filter((u) => portOf(u) === '')).toEqual([]); // 기본 포트로는 robots.txt 포함 어떤 요청도 나가지 않는다.
      // robots.txt는 명시된 포트에서 읽고(기본 포트 robots는 허용 출처 밖이라 호스트 중단이 되면 안 된다) 자격증명을 싣지 않는다.
      expect(req(`${OTHER}/robots.txt`)).toBeDefined();
      expect(req(`${OTHER}/robots.txt`)?.headers['x-api-key']).toBeUndefined();
      expect(run.status).toBe('SUCCEEDED');
      expect(await h.prisma.kbDocument.count({ where: { sourceId: id, url: `${OTHER}/docs/y` } })).toBe(1);
    });
  });

  describe('(c) 인증 헤더가 있는 소스에서 다른 포트 URL로 요청이 나가는 경로는 0', () => {
    it('★ 크롤 — 링크 · 리다이렉트(홉 1) · 리다이렉트 체인 어디로도 8443/9443 요청이 없다', async () => {
      const { id } = await h.createSource({ auth: AUTH });
      const fetcher = okRobots(new FakeFetcher())
        .route(DOCS, html(page('목록', [`${OTHER}/docs/link`, '/docs/r1', '/docs/r2'])))
        .route(`${HOST}/docs/r1`, redirect(`${OTHER}/docs/x1`))
        .route(`${HOST}/docs/r2`, redirect('/docs/r3'))
        .route(`${HOST}/docs/r3`, redirect('https://a.example:9443/docs/x2'));
      const { runner } = h.makeRunner({ fetcher, secretResolver: { get: () => 'top-secret' } });
      const run = await h.drive(runner, await h.startRun(id, 'PREVIEW'));
      expect(nonDefaultPortRequests(fetcher)).toEqual([]);
      // 리다이렉트 목적지가 범위 밖 → 제외(REDIRECT_OUT_OF_SCOPE)로 기록된다.
      const counts = JSON.parse(run.counts) as { excluded: Record<string, number> };
      expect(counts.excluded.REDIRECT_OUT_OF_SCOPE).toBeGreaterThanOrEqual(2);
    });

    it('★ 첫 요청 — 설정 변경으로 대기열에 허용 출처 밖 URL이 남아도 인증 헤더는 실리지 않는다(허용 출처와 정확히 일치할 때만)', async () => {
      const { id } = await h.createSource({ auth: AUTH });
      const runId = await h.startRun(id, 'PREVIEW');
      // 실행 도중 시작 주소에서 8443이 빠진 상황 — 이미 대기열에 들어 있던 행이 남는다(실 fetcher는 HOST_NOT_ALLOWED로 막지만, 헤더는 그 전에 이미 없어야 한다).
      await addDocUrl(id, `${OTHER}/docs/stale`, { seenRunId: runId, visitState: 'QUEUED', depth: 0 });
      const fetcher = okRobots(new FakeFetcher(), OTHER).route(`${OTHER}/docs/stale`, html(page('남은 행')));
      const { runner } = h.makeRunner({ fetcher, secretResolver: { get: () => 'top-secret' } });
      await h.drive(runner, runId);
      const staleReq = fetcher.requests.find((r) => r.url === `${OTHER}/docs/stale`);
      expect(staleReq).toBeDefined();
      expect(staleReq?.headers['x-api-key']).toBeUndefined();
    });

    it('★ 적재 재수집 — 다른 포트로의 리다이렉트는 요청 없이 SKIPPED(EXCLUDED_AT_INGEST)', async () => {
      const { id } = await h.createSource({ auth: AUTH });
      const { job } = await ingestPendingJob(id, `${HOST}/docs/r1`);
      const fetcher = new FakeFetcher().route(`${HOST}/docs/r1`, redirect(`${OTHER}/docs/x1`)).route(`${OTHER}/docs/x1`, html(page('다른 포트')));
      const { runner, rag } = makeIngestRunner(fetcher);
      await runner.runFragment(new Date());
      expect(fetcher.urls()).toEqual([`${HOST}/docs/r1`]);
      expect(fetcher.requests[0].headers['x-api-key']).toBe('top-secret');
      const after = await h.prisma.kbIngestJob.findUniqueOrThrow({ where: { id: job.id } });
      expect(after.status).toBe('SKIPPED');
      expect(after.resultCode).toBe('EXCLUDED_AT_INGEST');
      expect(rag.ingest).not.toHaveBeenCalled();
    });
  });

  describe('(d) 사이트맵에 명시된 포트는 허용된다', () => {
    const sitemap = (locs: string[]) => ({ kind: 'RESPONSE' as const, status: 200, contentType: 'application/xml', body: Buffer.from(`<?xml version="1.0"?><urlset>${locs.map((l) => `<url><loc>${l}</loc></url>`).join('')}</urlset>`), headers: {} });

    it('★ 사이트맵 URL의 포트(8443)는 허용 출처가 되어 그 포트의 항목이 씨앗이 된다 — 사이트맵 안에서 새로 나온 포트(9443)는 범위 밖', async () => {
      const { id } = await h.createSource({ auth: AUTH, sitemapUrls: [`${OTHER}/sitemap.xml`], pathPrefixes: ['/docs'] });
      const fetcher = okRobots(okRobots(new FakeFetcher()), OTHER)
        .route(`${OTHER}/sitemap.xml`, sitemap([`${OTHER}/docs/s1`, 'https://a.example:9443/docs/s2', `${HOST}/docs/s3`]))
        .route(DOCS, html(page('목록')))
        .route(`${OTHER}/docs/s1`, html(page('사이트맵 8443')))
        .route(`${HOST}/docs/s3`, html(page('기본 포트')))
        .route('https://a.example:9443/docs/s2', html(page('9443')));
      const { runner } = h.makeRunner({ fetcher, secretResolver: { get: () => 'top-secret' } });
      await h.drive(runner, await h.startRun(id, 'PREVIEW'));
      expect(fetcher.hitsOf(`${OTHER}/docs/s1`)).toBe(1);
      expect(fetcher.hitsOf(`${HOST}/docs/s3`)).toBe(1);
      expect(fetcher.hitsOf('https://a.example:9443/docs/s2')).toBe(0);
      // 사이트맵 파일 요청에는 자격증명을 싣지 않는다(기존 규칙) · 문서 요청에는 명시된 출처라 싣는다.
      expect(fetcher.requests.find((r) => r.url === `${OTHER}/sitemap.xml`)?.headers['x-api-key']).toBeUndefined();
      expect(fetcher.requests.find((r) => r.url === `${OTHER}/docs/s1`)?.headers['x-api-key']).toBe('top-secret');
    });
  });

  describe('(e) 기본 포트 표기 차이(:443 명시 · 생략)는 같은 출처다', () => {
    it('★ 시작 주소가 :443을 명시해도 포트 없는 링크가 범위 안이고 인증 헤더가 실린다(반대도 같다)', async () => {
      const { id } = await h.createSource({ auth: AUTH, seedUrls: [`${HOST}:443/docs/`] });
      const fetcher = okRobots(new FakeFetcher())
        .route(DOCS, html(page('목록', [`${HOST}/docs/n1`, `${HOST}:443/docs/n2`])))
        .route(`${HOST}/docs/n1`, html(page('N1')))
        .route(`${HOST}/docs/n2`, html(page('N2')));
      const { runner } = h.makeRunner({ fetcher, secretResolver: { get: () => 'top-secret' } });
      await h.drive(runner, await h.startRun(id, 'PREVIEW'));
      expect(fetcher.hitsOf(`${HOST}/docs/n1`)).toBe(1);
      expect(fetcher.hitsOf(`${HOST}/docs/n2`)).toBe(1);
      expect(fetcher.requests.filter((r) => r.url.includes('/docs/n')).every((r) => r.headers['x-api-key'] === 'top-secret')).toBe(true);
    });
  });

  describe('(f) 적재 단계 submitJob — 다른 포트 문서는 SKIPPED(EXCLUDED_AT_INGEST)', () => {
    it('★ 소스 범위에 없는 포트의 문서 URL은 재수집·외부 제출·인증 헤더 전송 없이 종결한다', async () => {
      const { id } = await h.createSource({ auth: AUTH });
      const { job } = await ingestPendingJob(id, `${OTHER}/docs/z`);
      const fetcher = new FakeFetcher().route(`${OTHER}/docs/z`, html(page('다른 포트')));
      const { runner, rag } = makeIngestRunner(fetcher);
      await runner.runFragment(new Date());
      const after = await h.prisma.kbIngestJob.findUniqueOrThrow({ where: { id: job.id } });
      expect(after.status).toBe('SKIPPED');
      expect(after.resultCode).toBe('EXCLUDED_AT_INGEST');
      expect(fetcher.requests).toHaveLength(0);
      expect(rag.ingest).not.toHaveBeenCalled();
    });

    it('대조 — 그 포트가 시작 주소에 명시된 소스에서는 같은 문서가 재수집·제출된다(헤더 동행)', async () => {
      const { id } = await h.createSource({ auth: AUTH, seedUrls: [DOCS, `${OTHER}/docs/`] });
      const { job } = await ingestPendingJob(id, `${OTHER}/docs/z`);
      const fetcher = new FakeFetcher().route(`${OTHER}/docs/z`, html(page('명시된 포트')));
      const { runner, rag } = makeIngestRunner(fetcher);
      await runner.runFragment(new Date());
      expect(fetcher.urls()).toEqual([`${OTHER}/docs/z`]);
      expect(fetcher.requests[0].headers['x-api-key']).toBe('top-secret');
      expect(rag.ingest).toHaveBeenCalled();
      expect((await h.prisma.kbIngestJob.findUniqueOrThrow({ where: { id: job.id } })).status).not.toBe('SKIPPED');
    });
  });

  describe('AC-KB6-1 — DOCX(기본 변환 형식) 머리 줄 `제목:`도 마스킹된다', () => {
    const PII_TITLE = '문의 010-1234-5678 담당 hong@example.com';

    async function crawlAndIngestDocx(sourceOver: Record<string, unknown>, title: string) {
      const { id } = await h.createSource(sourceOver);
      const fetcher = okRobots(new FakeFetcher()).route(DOCS, html(page(title)));
      const run = await h.drive(h.makeRunner({ fetcher }).runner, await h.startRun(id, 'SYNC'));
      expect(run.status).toBe('INGESTING');
      const rag = makeRag();
      // KB_HTML_INGEST_FORMAT를 지정하지 않는다 — 기본값이 DOCX다.
      const ingestRunner = new KbIngestRunner(h.store, h.sourcesService, h.prisma, rag as never, fetcher as never, { get: () => null } as never, makeConfig({ KB_INGEST_POLL_MS: 10 }), new InProcessExtractor(), { tryAcquire: () => true } as never);
      await ingestRunner.runFragment(new Date());
      expect(rag.ingest).toHaveBeenCalledTimes(1);
      const call = (rag.ingest.mock.calls as unknown as Array<[{ file: { name: string; bytes: Uint8Array; contentType: string } }]>)[0][0];
      expect(call.file.contentType).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      // 압축을 풀어 word/document.xml 안의 문단만 본다(압축 상태에서는 원문 검색이 무의미하다).
      const entries = unzipSync(call.file.bytes);
      return strFromU8(entries['word/document.xml']);
    }

    it('★ piiMask 소스 — 머리 줄 제목에 전화번호·이메일 원문이 없고 마스킹된 값이 들어 있다', async () => {
      const xml = await crawlAndIngestDocx({}, PII_TITLE);
      const titleLine = /<w:t xml:space="preserve">(제목: [^<]*)<\/w:t>/.exec(xml)?.[1];
      expect(titleLine).toBeDefined();
      expect(titleLine).toMatch(/^제목: 문의 010-\*{4}-5678 담당 /);
      expect(titleLine).toContain('010-****-5678');
      for (const leak of ['1234', 'hong@example.com']) {
        expect(titleLine).not.toContain(leak);
        expect(xml).not.toContain(leak); // 머리 줄만이 아니라 문서 전체
      }
    });

    it('대조 — piiMask = false 소스는 기존 규칙대로 머리 줄 제목을 마스킹하지 않는다', async () => {
      const xml = await crawlAndIngestDocx({ piiMask: false }, PII_TITLE);
      expect(xml).toContain(`제목: ${PII_TITLE}`);
    });
  });

  describe('설정 변경 — 허용 출처는 저장하지 않고 실행 시점에 다시 계산한다', () => {
    it('소스의 시작 주소에서 포트를 빼면 다음 실행부터 그 포트는 범위 밖이다(스키마 변경 없음)', async () => {
      const { id } = await h.createSource({ seedUrls: [DOCS, `${OTHER}/docs/`] });
      const row = await h.prisma.kbSource.findUniqueOrThrow({ where: { id } });
      expect(JSON.parse(row.allowedHosts)).toEqual(['a.example']); // 저장 형식은 호스트 이름 단위 그대로.
      await h.prisma.kbSource.update({ where: { id }, data: { seedUrls: JSON.stringify([DOCS]) } });
      const fetcher = okRobots(new FakeFetcher()).route(DOCS, html(page('목록', [`${OTHER}/docs/x`]))).route(`${OTHER}/docs/x`, html(page('x')));
      const { runner } = h.makeRunner({ fetcher });
      await h.drive(runner, await h.startRun(id, 'PREVIEW'));
      expect(nonDefaultPortRequests(fetcher)).toEqual([]);
    });
  });
});
