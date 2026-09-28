import { InProcessExtractor } from '../kb-sync/extract/in-process.extractor';
import type { KbExtractorPort } from '../kb-sync/extract/kb-extractor.port';
import type { KbFetchResult } from '../kb-sync/crawl/kb-crawl-http.fetcher';
import { buildExternalFileName, urlHash } from '../kb-sync/lib/external-file-name';
import { FakeFetcher, HOST, OpenPacer, createHarness, html, makeClockedPacer, makeConfig, page, status } from './helpers/kb-crawl-db-harness';
import type { Harness } from './helpers/kb-crawl-db-harness';

/**
 * 지식베이스 크롤링(No.43) 백엔드 pass 7 — R4 리뷰(N-1~N-13)의 재현 시험(크롤 단계).
 * 실제 DB(SQLite 마이그레이션 적용) + 실제 저장소·서비스·크롤러, 네트워크·시간·문서 해석만 가짜.
 */
const DOCS = `${HOST}/docs/`;
const okRobots = (f: FakeFetcher, body = 'User-agent: *\nAllow: /\n'): FakeFetcher => f.route(`${HOST}/robots.txt`, html(body));
const redirect = (location: string, code = 302): KbFetchResult => ({ kind: 'REDIRECT', status: code, location, headers: {} });
const pdf = (bytes: Buffer = Buffer.from('%PDF-1.4 x')): KbFetchResult => ({ kind: 'RESPONSE', status: 200, contentType: 'application/pdf', body: bytes, headers: {} });
const docOf = (h: Harness, sourceId: string, path: string) => h.prisma.kbDocument.findUniqueOrThrow({ where: { sourceId_urlHash: { sourceId, urlHash: urlHash(`${HOST}${path}`) } } });

async function addDoc(h: Harness, sourceId: string, path: string, over: Record<string, unknown> = {}) {
  const url = `${HOST}${path}`;
  const kind = (over.kind as string | undefined) ?? 'HTML';
  const ext = kind === 'PDF' ? 'pdf' : kind === 'HTML' ? 'html' : (kind.toLowerCase() as 'docx');
  return h.prisma.kbDocument.create({
    data: { sourceId, url, urlHash: urlHash(url), kind, externalFileName: buildExternalFileName(sourceId, url, ext), seenRunId: 'old-run', visitState: 'VISITED', ...over },
  });
}

/** 파일 사전 검사 결과를 정하는 추출기(진짜 PDF 해석은 jest에서 동적 import가 안 돼 쓰지 않는다 — 이 시험의 관심사는 크롤 판정이다). */
function fileExtractor(over: { truncated?: boolean; piiMaskedCount?: number } = {}): KbExtractorPort {
  return {
    async extract(req) {
      if (req.kind === 'HTML') return new InProcessExtractor().extract(req);
      return { ok: true, normalizedText: '본문', text: '본문', piiMaskedCount: over.piiMaskedCount ?? 0, truncated: over.truncated, flags: [] };
    },
  };
}

describe('KB pass 7 — 크롤 단계', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await createHarness('pass7-crawl');
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

  /* ───────────────────────── N-1 ───────────────────────── */
  describe('N-1 — 리다이렉트 문서 + 호스트 간격 > 조각 예산이어도 진행이 보장된다(라이브락 없음)', () => {
    /**
     * 조각 사이에 tick 주기(KB_SYNC_INTERVAL_MS 기본 10초 — `PollingLoop`는 "이전 tick 종료 뒤 interval 뒤"에 다음 tick을 돈다)만큼 시각이 흐른다.
     */
    async function driveClocked(runner: Parameters<Harness['fragment']>[0], runId: string, clock: { t: number }, opts: { fragments: number; budgetMs?: number }): Promise<number> {
      let n = 0;
      for (; n < opts.fragments; n += 1) {
        const run = await h.store.findRun(runId);
        if (run && run.status !== 'QUEUED' && run.status !== 'CRAWLING') break;
        await h.fragment(runner, runId, { deadlineAt: clock.t + (opts.budgetMs ?? 25_000) });
        clock.t += 10_000;
      }
      return n;
    }

    it('★ S3 — Crawl-delay 30초 · /docs/a → /docs/a/ · 조각 25초 × 12회: 목적지가 기록되고 실행이 종결된다(홉 0을 반복 요청하지 않는다)', async () => {
      const { id } = await h.createSource({ minIntervalMs: 500 });
      const { pacer, clock } = makeClockedPacer();
      const fetcher = okRobots(new FakeFetcher(), 'User-agent: *\nCrawl-delay: 30\n')
        .route(DOCS, html(page('목록', ['/docs/a'])))
        .route(`${HOST}/docs/a`, redirect('/docs/a/', 301))
        .route(`${HOST}/docs/a/`, html(page('A 폴더')));
      const times: Array<{ url: string; at: number }> = [];
      fetcher.onRequest = (r) => {
        times.push({ url: r.url, at: clock.t });
      };
      const { runner } = h.makeRunner({ fetcher, pacer });
      const runId = await h.startRun(id, 'PREVIEW');
      await driveClocked(runner, runId, clock, { fragments: 12 });

      const run = await h.store.findRun(runId);
      expect(run?.status).toBe('SUCCEEDED');
      expect(fetcher.hitsOf(`${HOST}/docs/a`)).toBe(1); // 홉 0은 한 번만
      expect(fetcher.hitsOf(`${HOST}/docs/a/`)).toBe(1); // 목적지가 실제로 요청됐다
      const to = await docOf(h, id, '/docs/a/');
      expect(to.title).toBe('A 폴더');
      expect(to.observedChange).toBe('NEW');
      expect((await docOf(h, id, '/docs/a')).visitState).toBe('VISITED');
      // 호스트 간격(Crawl-delay 30초)은 홉 사이에도 지킨다 — 조각 예산을 넘겨 기다릴 뿐이다.
      const pageTimes = times.filter((t) => !t.url.endsWith('/robots.txt'));
      const gaps = pageTimes.slice(1).map((t, i) => t.at - pageTimes[i].at);
      expect(Math.min(...gaps)).toBeGreaterThanOrEqual(30_000);
    });

    it('★ 리다이렉트가 없는 문서는 예전처럼 조각 예산을 넘겨 기다리지 않고 다음 조각으로 미룬다(조각당 예산 준수)', async () => {
      const { id } = await h.createSource({ minIntervalMs: 500 });
      const { pacer, clock } = makeClockedPacer();
      const fetcher = okRobots(new FakeFetcher(), 'User-agent: *\nCrawl-delay: 30\n')
        .route(DOCS, html(page('목록', ['/docs/a'])))
        .route(`${HOST}/docs/a`, html(page('A')));
      const { runner } = h.makeRunner({ fetcher, pacer });
      const runId = await h.startRun(id, 'PREVIEW');
      const start = clock.t;
      await h.fragment(runner, runId, { deadlineAt: start + 25_000 });
      expect((await h.store.findRun(runId))?.status).toBe('CRAWLING'); // 목록만 처리하고 /docs/a는 다음 조각
      expect(clock.t).toBeLessThanOrEqual(start + 25_000);
      expect(fetcher.hitsOf(`${HOST}/docs/a`)).toBe(0);
    });

    it('★ 다중 홉(3회)도 끝까지 진행해 목적지를 기록한다 — 홉마다 호스트 간격을 지킨다', async () => {
      const { id } = await h.createSource({ minIntervalMs: 500 });
      const { pacer, clock } = makeClockedPacer();
      const fetcher = okRobots(new FakeFetcher(), 'User-agent: *\nCrawl-delay: 30\n')
        .route(DOCS, html(page('목록', ['/docs/h0'])))
        .route(`${HOST}/docs/h0`, redirect('/docs/h1'))
        .route(`${HOST}/docs/h1`, redirect('/docs/h2'))
        .route(`${HOST}/docs/h2`, redirect('/docs/h3'))
        .route(`${HOST}/docs/h3`, html(page('최종')));
      const times: number[] = [];
      fetcher.onRequest = (r) => {
        if (!r.url.endsWith('/robots.txt')) times.push(clock.t);
      };
      const { runner } = h.makeRunner({ fetcher, pacer });
      const runId = await h.startRun(id, 'PREVIEW');
      await driveClocked(runner, runId, clock, { fragments: 12 });
      expect((await h.store.findRun(runId))?.status).toBe('SUCCEEDED');
      expect((await docOf(h, id, '/docs/h3')).title).toBe('최종');
      expect(fetcher.hitsOf(`${HOST}/docs/h0`)).toBe(1);
      expect(Math.min(...times.slice(1).map((t, i) => t - times[i]))).toBeGreaterThanOrEqual(30_000);
    });

    it('★ 홉 사이를 오래 기다려도 크롤 임대를 갱신한다(N-10) — 갱신 간격이 임대 최소값(300초)에 근접하지 않는다', async () => {
      const { id } = await h.createSource({ minIntervalMs: 500 });
      const { pacer, clock } = makeClockedPacer();
      const fetcher = okRobots(new FakeFetcher(), 'User-agent: *\nCrawl-delay: 100\n')
        .route(DOCS, html(page('목록', ['/docs/a'])))
        .route(`${HOST}/docs/a`, redirect('/docs/a/', 301))
        .route(`${HOST}/docs/a/`, html(page('A 폴더')));
      const { runner } = h.makeRunner({ fetcher, pacer });
      const runId = await h.startRun(id, 'PREVIEW');
      const real = h.store.renewCrawlLease.bind(h.store);
      const at: number[] = [];
      jest.spyOn(h.store, 'renewCrawlLease').mockImplementation(async (...args) => {
        at.push(clock.t);
        return real(...args);
      });
      // [pass 9 · M-4] 홉 사이 간격(100초)을 조각 예산 안에서만 기다리므로(강제 대기 제거) 간격이 여러 조각에 나뉜다 — 조각 사이 10초 × 최대 40조각(=400초)이면 홉 2번(≈200초)이 끝난다.
      // 검증 의도(대기 구간에도 임대 갱신 간격이 임대 최소값에 근접하지 않는다)는 그대로다.
      await driveClocked(runner, runId, clock, { fragments: 40 });
      expect((await h.store.findRun(runId))?.status).toBe('SUCCEEDED');
      expect(fetcher.hitsOf(`${HOST}/docs/a/`)).toBe(1);
      const gaps = at.slice(1).map((t, i) => t - at[i]);
      expect(Math.max(...gaps)).toBeLessThanOrEqual(12_000);
    });

    it('★ 홉 응답 직후 임대를 잃으면(중지·인수) 대기를 마친 뒤에도 다음 홉 요청을 보내지 않는다(요청 직전 갱신)', async () => {
      const { id } = await h.createSource({ minIntervalMs: 500 });
      const { pacer, clock } = makeClockedPacer();
      const fetcher = okRobots(new FakeFetcher(), 'User-agent: *\nCrawl-delay: 5\n')
        .route(DOCS, html(page('목록', ['/docs/a'])))
        .route(`${HOST}/docs/a`, redirect('/docs/a/', 301))
        .route(`${HOST}/docs/a/`, html(page('A 폴더')));
      const { runner } = h.makeRunner({ fetcher, pacer });
      const runId = await h.startRun(id, 'PREVIEW');
      fetcher.onRequest = async (r) => {
        if (r.url === `${HOST}/docs/a`) await h.store.cancelRun(runId, new Date(), 'user-1'); // 홉 0 응답 직후 중지(claimToken 비움)
      };
      await driveClocked(runner, runId, clock, { fragments: 16 });
      expect(fetcher.hitsOf(`${HOST}/docs/a/`)).toBe(0);
      expect((await h.store.findRun(runId))?.status).toBe('CANCELLED');
    });

    it('★ 실효 간격 상한 — Crawl-delay·소스 간격이 아무리 커도 페이서에는 300초까지만 기록한다(서버 쪽 클램프 · 계약 변경 없음)', async () => {
      const { id } = await h.createSource({ minIntervalMs: 1_000_000 });
      const fetcher = okRobots(new FakeFetcher(), 'User-agent: *\nCrawl-delay: 900\n').route(DOCS, html(page('목록')));
      const { runner, pacer } = h.makeRunner({ fetcher });
      await h.drive(runner, await h.startRun(id, 'PREVIEW'));
      expect(pacer.releases.length).toBeGreaterThanOrEqual(2); // robots + 목록
      for (const r of pacer.releases) expect(r.intervalMs).toBeLessThanOrEqual(300_000);
      expect(Math.max(...pacer.releases.map((r) => r.intervalMs))).toBe(300_000);
    });

    it('상한 이하의 간격은 그대로 쓴다(Crawl-delay 90초 → 90초)', async () => {
      const { id } = await h.createSource({ minIntervalMs: 500 });
      const fetcher = okRobots(new FakeFetcher(), 'User-agent: *\nCrawl-delay: 90\n').route(DOCS, html(page('목록')));
      const { runner, pacer } = h.makeRunner({ fetcher });
      await h.drive(runner, await h.startRun(id, 'PREVIEW'));
      expect(pacer.releases.map((r) => r.intervalMs)).toContain(90_000);
    });
  });

  /* ───────────────────────── N-2 ───────────────────────── */
  describe('N-2 — FULL_RESEND는 리다이렉트 원본 행을 적재 작업으로 만들지 않는다', () => {
    it('★ /docs/a → /docs/c 사이트에서 FULL_RESEND 시 작업 대상에 /docs/a가 없다(같은 내용이 C·A 이름으로 중복 적재되지 않는다)', async () => {
      const { id } = await h.createSource();
      const fetcher = okRobots(new FakeFetcher())
        .route(DOCS, html(page('목록', ['/docs/a', '/docs/b'])))
        .route(`${HOST}/docs/a`, redirect('/docs/c', 301))
        .route(`${HOST}/docs/b`, html(page('B')))
        .route(`${HOST}/docs/c`, html(page('C')));
      const { runner } = h.makeRunner({ fetcher });
      const runId = await h.startRun(id, 'FULL_RESEND');
      const run = await h.drive(runner, runId);
      expect(run.status).toBe('INGESTING');

      const jobs = await h.prisma.kbIngestJob.findMany({ where: { runId } });
      const docs = await h.prisma.kbDocument.findMany({ where: { id: { in: jobs.map((j) => j.documentId) } } });
      expect(docs.map((d) => d.url).sort()).toEqual([DOCS, `${HOST}/docs/b`, `${HOST}/docs/c`].sort());
      expect(docs.some((d) => d.url === `${HOST}/docs/a`)).toBe(false);
    });

    it('대조: 이전에 적재된 문서가 이번에 304(내용 미관측)여도 FULL_RESEND 대상이다', async () => {
      const { id } = await h.createSource();
      await addDoc(h, id, '/docs/', { lastIngestedAt: new Date(Date.now() - 3_600_000), contentHash: 'h', ingestFingerprint: 'f', etag: '"r1"' });
      const fetcher = okRobots(new FakeFetcher()).route(DOCS, (r) => (r.headers['if-none-match'] === '"r1"' ? status(304) : html(page('목록'))));
      const { runner } = h.makeRunner({ fetcher });
      const runId = await h.startRun(id, 'FULL_RESEND');
      expect((await h.drive(runner, runId)).status).toBe('INGESTING');
      const jobs = await h.prisma.kbIngestJob.findMany({ where: { runId } });
      expect(jobs).toHaveLength(1);
      expect(jobs[0].reason).toBe('FULL_RESEND');
    });

    it('일반 SYNC의 적재 후보 판정은 그대로다 — 리다이렉트 원본은 후보가 아니고 목적지만 NEW로 후보다', async () => {
      const { id } = await h.createSource();
      const fetcher = okRobots(new FakeFetcher())
        .route(DOCS, html(page('목록', ['/docs/a'])))
        .route(`${HOST}/docs/a`, redirect('/docs/c', 301))
        .route(`${HOST}/docs/c`, html(page('C')));
      const { runner } = h.makeRunner({ fetcher });
      const runId = await h.startRun(id, 'SYNC');
      await h.drive(runner, runId);
      const jobs = await h.prisma.kbIngestJob.findMany({ where: { runId } });
      const urls = (await h.prisma.kbDocument.findMany({ where: { id: { in: jobs.map((j) => j.documentId) } } })).map((d) => d.url).sort();
      expect(urls).toEqual([DOCS, `${HOST}/docs/c`].sort());
    });
  });

  /* ───────────────────────── N-3 ───────────────────────── */
  describe('N-3 — maxPages는 "행 수" 상한이다: 이미 넣은 행은 모두 방문하고, 더 넣지 않는다', () => {
    it('★ maxPages 5 · 루트 1쪽에 링크 4개 → 5쪽 모두 방문한다', async () => {
      const { id } = await h.createSource({ maxPages: 5 });
      const kids = ['/docs/k0', '/docs/k1', '/docs/k2', '/docs/k3'];
      const fetcher = okRobots(new FakeFetcher()).route(DOCS, html(page('목록', kids)));
      for (const k of kids) fetcher.route(`${HOST}${k}`, html(page(k)));
      const { runner } = h.makeRunner({ fetcher });
      const runId = await h.startRun(id, 'PREVIEW');
      const run = await h.drive(runner, runId);

      expect(run.status).toBe('SUCCEEDED');
      expect(await h.prisma.kbDocument.count({ where: { sourceId: id, visitState: 'VISITED' } })).toBe(5);
      for (const k of kids) expect(fetcher.hitsOf(`${HOST}${k}`)).toBe(1);
      expect(run.maxPagesReached).toBe(true); // 행 수가 상한에 닿았다(AC-KB2-5 경고 · 삭제 감지 끔)
    });

    it('★ 링크가 더 있으면 상한을 넘겨 넣지 않는다(행 5 · 요청 없음) — 넣은 5쪽은 모두 방문', async () => {
      const { id } = await h.createSource({ maxPages: 5 });
      const kids = Array.from({ length: 10 }, (_, i) => `/docs/k${i}`);
      const fetcher = okRobots(new FakeFetcher()).route(DOCS, html(page('목록', kids)));
      for (const k of kids) fetcher.route(`${HOST}${k}`, html(page(k)));
      const { runner } = h.makeRunner({ fetcher });
      const run = await h.drive(runner, await h.startRun(id, 'PREVIEW'));

      expect(run.status).toBe('SUCCEEDED');
      expect(await h.prisma.kbDocument.count({ where: { sourceId: id } })).toBe(5);
      expect(await h.prisma.kbDocument.count({ where: { sourceId: id, visitState: 'VISITED' } })).toBe(5);
      for (const k of kids.slice(4)) expect(fetcher.hitsOf(`${HOST}${k}`)).toBe(0);
      expect(run.maxPagesReached).toBe(true);
    });

    it('상한 미만이면 maxPagesReached는 false다(대조)', async () => {
      const { id } = await h.createSource({ maxPages: 5 });
      const fetcher = okRobots(new FakeFetcher()).route(DOCS, html(page('목록', ['/docs/a']))).route(`${HOST}/docs/a`, html(page('A')));
      const { runner } = h.makeRunner({ fetcher });
      const run = await h.drive(runner, await h.startRun(id, 'PREVIEW'));
      expect(run.maxPagesReached).toBe(false);
    });

    it('★ carryChildren(H-2)도 상한을 지킨다 — 304 부모의 지난 자식을 maxPages 넘게 프런티어에 넣지 않는다', async () => {
      const { id } = await h.createSource({ maxPages: 3 });
      const root = page('목록', ['/docs/p']);
      await addDoc(h, id, '/docs/', { contentHash: 'r', lastIngestedAt: new Date() });
      const p = await addDoc(h, id, '/docs/p', { etag: '"p1"', contentHash: 'p', lastIngestedAt: new Date() });
      for (let i = 0; i < 5; i += 1) await addDoc(h, id, `/docs/c${i}`, { discoveredFromId: p.id, discoveredSeq: i + 10 });
      const fetcher = okRobots(new FakeFetcher())
        .route(DOCS, html(root))
        .route(`${HOST}/docs/p`, (r) => (r.headers['if-none-match'] === '"p1"' ? status(304) : html(page('P'))));
      for (let i = 0; i < 5; i += 1) fetcher.route(`${HOST}/docs/c${i}`, html(page(`c${i}`)));
      const { runner } = h.makeRunner({ fetcher });
      const runId = await h.startRun(id, 'SYNC');
      await h.drive(runner, runId);

      const frontier = await h.store.countFrontier(id, runId);
      expect(frontier.total).toBeLessThanOrEqual(3);
      const childHits = [0, 1, 2, 3, 4].reduce((n, i) => n + fetcher.hitsOf(`${HOST}/docs/c${i}`), 0);
      expect(childHits).toBeLessThanOrEqual(1); // 루트 + p + 자식 1 = 3행
    });

    it('★ 리다이렉트 목적지도 행 수 상한을 지킨다(원본 + 목적지 = 2행)', async () => {
      const { id } = await h.createSource({ maxPages: 2 });
      const fetcher = okRobots(new FakeFetcher())
        .route(DOCS, html(page('목록', ['/docs/a'])))
        .route(`${HOST}/docs/a`, redirect('/docs/c', 301))
        .route(`${HOST}/docs/c`, html(page('C')));
      const { runner } = h.makeRunner({ fetcher });
      const run = await h.drive(runner, await h.startRun(id, 'PREVIEW'));
      expect(run.status).toBe('SUCCEEDED');
      expect(await h.prisma.kbDocument.count({ where: { sourceId: id } })).toBeLessThanOrEqual(2);
      expect(run.maxPagesReached).toBe(true);
    });
  });

  /* ───────────────────────── N-4 ───────────────────────── */
  describe('N-4 — 크롤 단계의 파일 다운로드도 타임아웃 ×4를 적용한다', () => {
    it('★ 페이지는 KB_CRAWL_TIMEOUT_MS, 문서 파일(PDF)은 ×4로 요청한다', async () => {
      const { id } = await h.createSource({ allowRawFileIngest: true });
      const fetcher = okRobots(new FakeFetcher()).route(DOCS, html(page('목록', ['/docs/f.pdf']))).route(`${HOST}/docs/f.pdf`, pdf());
      const { runner } = h.makeRunner({ fetcher, extractor: fileExtractor(), config: makeConfig({ KB_CRAWL_TIMEOUT_MS: 15000 }) });
      await h.drive(runner, await h.startRun(id, 'PREVIEW'));
      expect(fetcher.requests.find((r) => r.url === DOCS)?.timeoutMs).toBe(15000);
      expect(fetcher.requests.find((r) => r.url === `${HOST}/docs/f.pdf`)?.timeoutMs).toBe(60000);
    });

    it('★ HTML URL이 파일 URL로 리다이렉트되면 그 홉(파일)은 ×4 · 응답 상한은 소스 파일 상한이다', async () => {
      const { id, row } = await h.createSource({ allowRawFileIngest: true });
      const fetcher = okRobots(new FakeFetcher())
        .route(DOCS, html(page('목록', ['/docs/dl'])))
        .route(`${HOST}/docs/dl`, redirect('/docs/files/x.pdf'))
        .route(`${HOST}/docs/files/x.pdf`, pdf());
      const { runner } = h.makeRunner({ fetcher, extractor: fileExtractor(), config: makeConfig({ KB_CRAWL_TIMEOUT_MS: 15000 }) });
      await h.drive(runner, await h.startRun(id, 'PREVIEW'));
      const hop0 = fetcher.requests.find((r) => r.url === `${HOST}/docs/dl`);
      const hop1 = fetcher.requests.find((r) => r.url === `${HOST}/docs/files/x.pdf`);
      expect(hop0?.timeoutMs).toBe(15000);
      expect(hop0?.maxBytes).toBe(2 * 1024 * 1024);
      expect(hop1?.timeoutMs).toBe(60000);
      expect(hop1?.maxBytes).toBe(row.maxFileBytes);
      expect((await docOf(h, id, '/docs/files/x.pdf')).observedChange).toBe('NEW');
    });
  });

  /* ───────────────────────── N-6 ───────────────────────── */
  describe('N-6 — 리다이렉트로 종류가 바뀌어도 원본 파일 전달·HTML 상한 판정이 유지된다', () => {
    it('★ HTML URL이 파일로 리다이렉트되고 allowRawFileIngest=false면 RAW_FILE_OFF로 제외한다(적재 후보 아님)', async () => {
      const { id } = await h.createSource({ allowRawFileIngest: false });
      const fetcher = okRobots(new FakeFetcher())
        .route(DOCS, html(page('목록', ['/docs/dl'])))
        .route(`${HOST}/docs/dl`, redirect('/docs/files/x.pdf'))
        .route(`${HOST}/docs/files/x.pdf`, pdf());
      const { runner } = h.makeRunner({ fetcher, extractor: fileExtractor() });
      const runId = await h.startRun(id, 'SYNC');
      const run = await h.drive(runner, runId);
      const d = await docOf(h, id, '/docs/files/x.pdf');
      expect(d.state).toBe('EXCLUDED');
      expect(d.excludeReason).toBe('RAW_FILE_OFF');
      expect(d.observedChange).toBeNull();
      const jobs = await h.prisma.kbIngestJob.findMany({ where: { runId } });
      const urls = (await h.prisma.kbDocument.findMany({ where: { id: { in: jobs.map((j) => j.documentId) } } })).map((x) => x.url);
      expect(urls).not.toContain(`${HOST}/docs/files/x.pdf`);
      expect((JSON.parse(run.counts) as { excluded: Record<string, number> }).excluded.RAW_FILE_OFF).toBe(1);
    });

    it('대조: allowRawFileIngest=true면 같은 리다이렉트 파일이 NEW로 기록된다', async () => {
      const { id } = await h.createSource({ allowRawFileIngest: true });
      const fetcher = okRobots(new FakeFetcher())
        .route(DOCS, html(page('목록', ['/docs/dl'])))
        .route(`${HOST}/docs/dl`, redirect('/docs/files/x.pdf'))
        .route(`${HOST}/docs/files/x.pdf`, pdf());
      const { runner } = h.makeRunner({ fetcher, extractor: fileExtractor() });
      await h.drive(runner, await h.startRun(id, 'PREVIEW'));
      const d = await docOf(h, id, '/docs/files/x.pdf');
      expect(d.state).toBe('ACTIVE');
      expect(d.observedChange).toBe('NEW');
    });

    it('★ 파일 URL이 HTML로 리다이렉트되면 2MB HTML 상한을 적용한다(초과 = SIZE)', async () => {
      const { id } = await h.createSource({ allowRawFileIngest: true });
      const big = `<html><head><title>큰 페이지</title></head><body>${'x'.repeat(2 * 1024 * 1024 + 10)}</body></html>`;
      const fetcher = okRobots(new FakeFetcher())
        .route(DOCS, html(page('목록', ['/docs/a.pdf'])))
        .route(`${HOST}/docs/a.pdf`, redirect('/docs/page'))
        .route(`${HOST}/docs/page`, html(big));
      // 2MB 본문을 실제로 해석하면 시험이 느려진다 — 큰 페이지만 가짜 결과로 대신한다(판정은 크기이므로 해석 결과는 관심 밖).
      const stub: KbExtractorPort = {
        async extract(req) {
          if (req.kind === 'HTML' && req.html.includes('큰 페이지')) return { ok: true, normalizedText: '본문'.repeat(200), text: '본문'.repeat(200), piiMaskedCount: 0, title: '큰 페이지', links: [], flags: [] };
          return fileExtractor().extract(req);
        },
      };
      const { runner } = h.makeRunner({ fetcher, extractor: stub });
      await h.drive(runner, await h.startRun(id, 'PREVIEW'));
      expect(fetcher.requests.find((r) => r.url === `${HOST}/docs/page`)?.maxBytes).toBe(2 * 1024 * 1024); // 홉 상한도 HTML 기준
      const d = await docOf(h, id, '/docs/page');
      expect(d.state).toBe('EXCLUDED');
      expect(d.excludeReason).toBe('SIZE');
    });
  });

  /* ───────────────────────── N-7 ───────────────────────── */
  describe('N-7 — 삭제(GONE)된 자식은 부모가 304일 때마다 다시 요청하지 않는다', () => {
    async function setup() {
      const { id } = await h.createSource();
      const root = await addDoc(h, id, '/docs/', { contentHash: 'r', lastIngestedAt: new Date(), etag: '"r1"' });
      const p = await addDoc(h, id, '/docs/p', { etag: '"p1"', contentHash: 'p', lastIngestedAt: new Date(), discoveredFromId: root.id });
      await addDoc(h, id, '/docs/gone', { discoveredFromId: p.id, state: 'GONE', cleanupReason: 'GONE', missingStreak: 2, lastIngestedAt: new Date(), discoveredSeq: 10 });
      await addDoc(h, id, '/docs/live', { discoveredFromId: p.id, discoveredSeq: 11, contentHash: 'l', lastIngestedAt: new Date() });
      return { id, p };
    }

    it('★ GONE 자식은 이어 방문하지 않고 ACTIVE 자식만 방문한다', async () => {
      const { id } = await setup();
      const fetcher = okRobots(new FakeFetcher())
        .route(DOCS, (r) => (r.headers['if-none-match'] === '"r1"' ? status(304) : html(page('목록', ['/docs/p']))))
        .route(`${HOST}/docs/p`, (r) => (r.headers['if-none-match'] === '"p1"' ? status(304) : html(page('P'))))
        .route(`${HOST}/docs/gone`, status(404))
        .route(`${HOST}/docs/live`, html(page('live')));
      const { runner } = h.makeRunner({ fetcher });
      await h.drive(runner, await h.startRun(id, 'SYNC')); // 루트 304 → 자식 p 이어 방문 → p 304 → 자식 gone·live
      expect(fetcher.hitsOf(`${HOST}/docs/gone`)).toBe(0);
      expect(fetcher.hitsOf(`${HOST}/docs/live`)).toBe(1);
      expect((await docOf(h, id, '/docs/gone')).state).toBe('GONE'); // 상태는 그대로(삭제 감지 스윕이 다시 세지도 않는다 — GONE은 대상이 아니다)
    });

    it('★ 부모가 200으로 다시 그 링크를 내놓으면(재발견) GONE 자식이 방문되고 200이면 ACTIVE로 복귀한다(RG-10 복귀 규칙)', async () => {
      const { id } = await setup();
      const fetcher = okRobots(new FakeFetcher())
        .route(DOCS, html(page('목록', ['/docs/p'])))
        .route(`${HOST}/docs/p`, html(page('P', ['/docs/gone', '/docs/live'])))
        .route(`${HOST}/docs/gone`, html(page('돌아온 문서')))
        .route(`${HOST}/docs/live`, html(page('live')));
      const { runner } = h.makeRunner({ fetcher });
      await h.drive(runner, await h.startRun(id, 'SYNC'));
      expect(fetcher.hitsOf(`${HOST}/docs/gone`)).toBe(1);
      const g = await docOf(h, id, '/docs/gone');
      expect(g.state).toBe('ACTIVE');
      expect(g.missingStreak).toBe(0);
      expect(g.cleanupReason).toBeNull();
    });
  });

  /* ───────────────────────── N-9 ───────────────────────── */
  describe('N-9 — PDF이 잘렸으면(truncated) 거버넌스 ON에서는 검사하지 못한 구간의 개인정보를 보낼 수 없으니 제외한다', () => {
    async function crawlPdf(over: { truncated: boolean; governance: 'ON' | 'OFF' }) {
      const { id } = await h.createSource({ allowRawFileIngest: true });
      const fetcher = okRobots(new FakeFetcher()).route(DOCS, html(page('목록', ['/docs/f.pdf']))).route(`${HOST}/docs/f.pdf`, pdf());
      const { runner } = h.makeRunner({ fetcher, extractor: fileExtractor({ truncated: over.truncated }), config: makeConfig({ DATA_GOVERNANCE_MODE: over.governance }) });
      await h.drive(runner, await h.startRun(id, 'PREVIEW'));
      return docOf(h, id, '/docs/f.pdf');
    }

    it('★ 거버넌스 ON + truncated → EXCLUDED(FILE_UNSAFE) — 적재 후보가 아니다', async () => {
      const d = await crawlPdf({ truncated: true, governance: 'ON' });
      expect(d.state).toBe('EXCLUDED');
      expect(d.excludeReason).toBe('FILE_UNSAFE');
      expect(d.observedChange).toBeNull();
    });

    it('대조: 거버넌스 OFF + truncated는 그대로 통과한다', async () => {
      const d = await crawlPdf({ truncated: true, governance: 'OFF' });
      expect(d.state).toBe('ACTIVE');
      expect(d.observedChange).toBe('NEW');
    });

    it('대조: 거버넌스 ON이라도 truncated가 아니면(전체 검사) 통과한다', async () => {
      const d = await crawlPdf({ truncated: false, governance: 'ON' });
      expect(d.state).toBe('ACTIVE');
      expect(d.observedChange).toBe('NEW');
    });
  });

  /* ───────────────────────── 보조: OpenPacer로 throttle 지연이 기본 간격보다 짧아지지 않는다 ───────────────────────── */
  describe('보조 — 429·503 재시도 지연은 (클램프된) 정상 간격보다 짧아지지 않는다', () => {
    it('★ 정상 간격이 90초일 때 429 뒤 지연도 90초 이상이다(예전에는 60초 상한이 정상 간격 아래로 깎았다)', async () => {
      const { id } = await h.createSource({ minIntervalMs: 500, maxPages: 5 });
      const fetcher = okRobots(new FakeFetcher(), 'User-agent: *\nCrawl-delay: 90\n')
        .route(DOCS, (_r, n) => (n === 1 ? status(429) : html(page('목록'))));
      const pacer = new OpenPacer();
      const { runner } = h.makeRunner({ fetcher, pacer });
      await h.drive(runner, await h.startRun(id, 'PREVIEW'));
      const docReleases = pacer.releases.slice(1); // 첫 항목 = robots
      expect(docReleases[0].intervalMs).toBeGreaterThanOrEqual(90_000);
    });
  });
});
