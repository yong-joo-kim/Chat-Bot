import { buildExternalFileName, urlHash } from '../kb-sync/lib/external-file-name';
import { FakeFetcher, HOST, createHarness, html, page } from './helpers/kb-crawl-db-harness';
import type { Harness } from './helpers/kb-crawl-db-harness';
import type { KbFetchResult } from '../kb-sync/crawl/kb-crawl-http.fetcher';

/**
 * 지식베이스 크롤링(No.43) 백엔드 pass 8 — 작은 잔여(RG-22④ · 사이트맵 요청 중 임대 갱신).
 */
const xml = (body: string): KbFetchResult => ({ kind: 'RESPONSE', status: 200, contentType: 'application/xml', body: Buffer.from(body), headers: {} });
const urlset = (locs: string[]) => `<?xml version="1.0"?><urlset>${locs.map((l) => `<url><loc>${l}</loc></url>`).join('')}</urlset>`;
const sitemapIndex = (locs: string[]) => `<?xml version="1.0"?><sitemapindex>${locs.map((l) => `<sitemap><loc>${l}</loc></sitemap>`).join('')}</sitemapindex>`;

describe('KB pass 8 — 잔여', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await createHarness('pass8-residual');
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

  describe('RG-22④ — 종단 실행 정리 경로의 작업 resultCode', () => {
    /** 소스·실행·문서·PENDING 작업 1건을 만들고 실행을 지정한 종단 상태·사유로 끝난 것으로 만든다(중지 경합으로 남은 고아 작업). */
    async function orphanJob(runFailureCode: string | null) {
      const { id } = await h.createSource();
      const runId = await h.startRun(id, 'SYNC');
      const url = `${HOST}/docs/orphan`;
      const doc = await h.prisma.kbDocument.create({
        data: { sourceId: id, url, urlHash: urlHash(url), kind: 'HTML', externalFileName: buildExternalFileName(id, url, 'html'), seenRunId: runId, visitState: 'VISITED' },
      });
      await h.store.createIngestJobsBulk([{ runId, sourceId: id, documentId: doc.id, lane: 'INCREMENTAL', reason: 'NEW' }]);
      await h.prisma.kbSyncRun.update({ where: { id: runId }, data: { status: 'CANCELLED', failureCode: runFailureCode, finishedAt: new Date(), claimToken: null } });
      const job = await h.prisma.kbIngestJob.findFirstOrThrow({ where: { runId } });
      return { runId, job, doc };
    }
    const resultOf = async (jobId: string) => (await h.prisma.kbIngestJob.findUniqueOrThrow({ where: { id: jobId } })).resultCode;

    it.each([
      ['SOURCE_DISABLED', 'CONFIG_CHANGED'],
      ['CANCELLED_BY_USER', 'CANCELLED_BY_USER'],
      [null, 'CANCELLED_BY_USER'],
    ])('★ cancelJobRunTerminated — 실행 사유 %s → 작업 resultCode %s', async (runFailureCode, expected) => {
      const { job, doc } = await orphanJob(runFailureCode);
      expect(await h.store.cancelJobRunTerminated(job.id)).toBe(true);
      const after = await h.prisma.kbIngestJob.findUniqueOrThrow({ where: { id: job.id } });
      expect(after.status).toBe('CANCELLED');
      expect(after.resultCode).toBe(expected);
      expect((await h.prisma.kbDocument.findUniqueOrThrow({ where: { id: doc.id } })).activeIngestJobId).toBeNull();
    });

    it.each([
      ['SOURCE_DISABLED', 'CONFIG_CHANGED'],
      ['CANCELLED_BY_USER', 'CANCELLED_BY_USER'],
    ])('★ cancelPendingJobsOfTerminatedRun — 실행 사유 %s → 작업 resultCode %s', async (runFailureCode, expected) => {
      const { runId, job } = await orphanJob(runFailureCode);
      expect(await h.store.cancelPendingJobsOfTerminatedRun(runId)).toBe(1);
      expect(await resultOf(job.id)).toBe(expected);
    });

    it('거버넌스 규칙 위반으로 끝난 실행의 남은 작업도 CONFIG_CHANGED다(소스 설정 때문에 제출을 취소한 것)', async () => {
      const { runId, job } = await orphanJob('GOVERNANCE_MASK_REQUIRED');
      expect(await h.store.cancelPendingJobsOfTerminatedRun(runId)).toBe(1);
      expect(await resultOf(job.id)).toBe('CONFIG_CHANGED');
    });
  });

  describe('사이트맵 요청(ensureSeeded)에도 크롤 임대 갱신이 있다 — 최대 50개 × 타임아웃 동안 임대가 만료되지 않게', () => {
    const SITEMAP = `${HOST}/sitemap.xml`;
    const children = [`${HOST}/sitemap-1.xml`, `${HOST}/sitemap-2.xml`, `${HOST}/sitemap-3.xml`];
    function siteWithSitemaps(): FakeFetcher {
      return new FakeFetcher()
        .route(`${HOST}/robots.txt`, html('User-agent: *\nAllow: /\n'))
        .route(SITEMAP, xml(sitemapIndex(children)))
        .route(children[0], xml(urlset([`${HOST}/docs/a`])))
        .route(children[1], xml(urlset([`${HOST}/docs/b`])))
        .route(children[2], xml(urlset([`${HOST}/docs/c`])))
        .route(`${HOST}/docs/`, html(page('목록')))
        .route(`${HOST}/docs/a`, html(page('A')))
        .route(`${HOST}/docs/b`, html(page('B')))
        .route(`${HOST}/docs/c`, html(page('C')));
    }
    const isSitemap = (u: string) => u === SITEMAP || children.includes(u);

    it('★ 사이트맵 파일 요청마다 그 직전에 임대를 갱신한다(요청 사이에 갱신 호출이 늘어난다)', async () => {
      const { id } = await h.createSource({ sitemapUrls: [SITEMAP] });
      const fetcher = siteWithSitemaps();
      const renew = jest.spyOn(h.store, 'renewCrawlLease');
      const snapshots: number[] = [];
      fetcher.onRequest = (req) => {
        if (isSitemap(req.url)) snapshots.push(renew.mock.calls.length);
      };
      const run = await h.drive(h.makeRunner({ fetcher }).runner, await h.startRun(id, 'PREVIEW'));
      expect(run.status).toBe('SUCCEEDED');
      expect(snapshots).toHaveLength(4); // 색인 1 + 자식 3
      for (let i = 1; i < snapshots.length; i += 1) expect(snapshots[i]).toBeGreaterThan(snapshots[i - 1]);
      expect(snapshots[0]).toBeGreaterThan(0); // 첫 사이트맵 요청 전에도 갱신했다
    });

    it('★ 갱신에 실패하면(중지·다른 인스턴스의 인수) 즉시 물러난다 — 이후 사이트맵 요청도 씨앗 넣기도 없다', async () => {
      const { id } = await h.createSource({ sitemapUrls: [SITEMAP] });
      const fetcher = siteWithSitemaps();
      const real = h.store.renewCrawlLease.bind(h.store);
      let calls = 0;
      jest.spyOn(h.store, 'renewCrawlLease').mockImplementation(async (...args) => {
        calls += 1;
        return calls >= 2 ? false : real(...args); // 색인 요청 직전(1)은 성공 · 첫 자식 직전(2)에 임대를 잃는다
      });
      const runId = await h.startRun(id, 'PREVIEW');
      await h.fragment(h.makeRunner({ fetcher }).runner, runId);

      expect(fetcher.urls().filter(isSitemap)).toEqual([SITEMAP]); // 자식 사이트맵은 요청하지 않았다
      expect(fetcher.hitsOf(`${HOST}/docs/`)).toBe(0); // 문서 요청도 없다
      expect(await h.prisma.kbDocument.count({ where: { sourceId: id } })).toBe(0); // 프런티어 씨앗도 넣지 않았다(다음 소유자가 처음부터 한다)
      expect((await h.store.findRun(runId))?.status).toBe('CRAWLING'); // 종결하지 않았다
    });
  });
});
