import { KbIngestRunner } from '../kb-sync/engine/kb-ingest.runner';
import { InProcessExtractor } from '../kb-sync/extract/in-process.extractor';
import { computeIngestFingerprint, sha256Hex } from '../kb-sync/lib/content-fingerprint';
import { buildExternalFileName, urlHash } from '../kb-sync/lib/external-file-name';
import type { KbFetchResult } from '../kb-sync/crawl/kb-crawl-http.fetcher';
import { FakeFetcher, HOST, createHarness, html, makeClockedPacer, makeConfig, page, status } from './helpers/kb-crawl-db-harness';
import type { Harness } from './helpers/kb-crawl-db-harness';

/**
 * 지식베이스 크롤링(No.43) 백엔드 pass 9 — R5 리뷰(H-1 · M-3 · M-4 · L-1 · L-3)의 재현 시험. 실제 DB(SQLite 마이그레이션 적용) + 실제 저장소·서비스·크롤러, 네트워크·시간·문서 해석만 가짜.
 */
const DOCS = `${HOST}/docs/`;
const redirect = (location: string, code = 302): KbFetchResult => ({ kind: 'REDIRECT', status: code, location, headers: {} });
const notModified = (): KbFetchResult => ({ kind: 'RESPONSE', status: 304, contentType: 'text/html', body: Buffer.alloc(0), headers: {} });
const okRobots = (f: FakeFetcher, body = 'User-agent: *\nAllow: /\n'): FakeFetcher => f.route(`${HOST}/robots.txt`, html(body));
/** 이미지·iframe 전용 갤러리 페이지 — 본문 텍스트가 전혀 없다. */
const galleryPage = (i: number): string => `<html><head><title>갤러리 ${i}</title></head><body><main><img src="/img/${i}.png"/><iframe src="/embed/${i}"></iframe></main></body></html>`;

const docOf = (h: Harness, sourceId: string, path: string) => h.prisma.kbDocument.findUniqueOrThrow({ where: { sourceId_urlHash: { sourceId, urlHash: urlHash(`${HOST}${path}`) } } });

async function addDoc(h: Harness, sourceId: string, path: string, over: Record<string, unknown> = {}) {
  const url = `${HOST}${path}`;
  const kind = (over.kind as string | undefined) ?? 'HTML';
  return h.prisma.kbDocument.create({
    data: { sourceId, url, urlHash: urlHash(url), kind, externalFileName: buildExternalFileName(sourceId, url, kind === 'HTML' ? 'html' : 'pdf'), seenRunId: 'old-run', visitState: 'VISITED', ...over },
  });
}

async function ingestedFields(body: string) {
  const ex = await new InProcessExtractor().extract({ kind: 'HTML', html: body, noisePatterns: [], piiMask: true, piiMaskMode: 'PARTIAL' });
  const contentHash = sha256Hex(ex.normalizedText);
  const ingestFingerprint = computeIngestFingerprint({ contentHash, format: 'DOCX', piiMask: true, piiMaskMode: 'PARTIAL' });
  return { contentHash, ingestFingerprint, textLength: ex.normalizedText.length, lastIngestedAt: new Date(Date.now() - 3_600_000) };
}

describe('KB pass 9', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await createHarness('pass9');
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

  /* ───────────────────────── H-1 ───────────────────────── */
  describe('H-1 — 정상 소스를 AUTH_WALL로 강등하지 않는다', () => {
    const rootBody = (links: string[]): string => page('목록', links);
    const docBody = (i: number): string => page(`문서 ${i}`, [], `문서 ${i}번의 서로 다른 본문입니다. `.repeat(12));

    /** 이미 적재된 정상 문서 `count`건(304를 돌려줄 것) + 루트. */
    async function seedHealthy(count: number, extraLinks: string[]): Promise<{ id: string; fetcher: FakeFetcher }> {
      const { id } = await h.createSource();
      const paths = Array.from({ length: count }, (_, i) => `/docs/d${i + 1}`);
      const links = [...paths, ...extraLinks];
      await addDoc(h, id, '/docs/', { etag: '"root"', ...(await ingestedFields(rootBody(links))), discoveredSeq: 1 });
      for (const [i, p] of paths.entries()) await addDoc(h, id, p, { etag: `"e${i}"`, discoveredFromId: null, discoveredSeq: i + 2, ...(await ingestedFields(docBody(i + 1))) });
      const fetcher = okRobots(new FakeFetcher()).route(DOCS, html(rootBody(links)));
      for (const p of paths) fetcher.route(`${HOST}${p}`, notModified());
      return { id, fetcher };
    }

    it('★ 재현 — 정상 문서 30건이 304 · 빈 본문 갤러리 12건 · 루트 200이어도 강등되지 않는다(SYNC)', async () => {
      const gallery = Array.from({ length: 12 }, (_, i) => `/docs/g${i + 1}`);
      const { id, fetcher } = await seedHealthy(30, gallery);
      gallery.forEach((p, i) => fetcher.route(`${HOST}${p}`, html(galleryPage(i + 1))));
      const run = await h.drive(h.makeRunner({ fetcher }).runner, await h.startRun(id, 'SYNC'));
      expect(run.status).not.toBe('FAILED');
      expect(run.demotedReason).toBeNull();
      const source = await h.prisma.kbSource.findUniqueOrThrow({ where: { id } });
      expect(source.approvedConfigVersion).toBe(1);
      expect(source.reviewRequiredReason).toBeNull();
      // 갤러리는 본문이 없어 적재하지 않고(NO_BODY 제외) 304 문서는 그대로다 — 강등이 없으니 실행은 정상 종결한다.
      expect(fetcher.hitsOf(`${HOST}/docs/g1`)).toBe(1);
    });

    it('★ 분모 — 짧은 공통 문구뿐인 페이지 12건(같은 해시가 남는다) + 304 정상 문서 30건이면 분포가 희석돼 강등되지 않는다', async () => {
      const gallery = Array.from({ length: 12 }, (_, i) => `/docs/g${i + 1}`);
      const { id, fetcher } = await seedHealthy(30, gallery);
      const captionOnly = '<html><head><title>사진</title></head><body><main><h1>사진 갤러리</h1><img src="/a.png"/></main></body></html>';
      gallery.forEach((p) => fetcher.route(`${HOST}${p}`, html(captionOnly)));
      const run = await h.drive(h.makeRunner({ fetcher }).runner, await h.startRun(id, 'SYNC'));
      expect(run.demotedReason).toBeNull();
      // 짧은 문구 페이지는 본문 없음으로 제외되지만 해시는 남는다(짧은 로그인 폼 탐지용) — 12건이 같은 해시로 쌓였는데도 304 30건이 분모에 들어가 강등되지 않는다.
      const rows = await h.prisma.kbDocument.findMany({ where: { sourceId: id, url: { in: gallery.map((p) => `${HOST}${p}`) } } });
      expect(new Set(rows.map((r) => r.observedHash)).size).toBe(1);
      expect(rows[0].observedHash).not.toBeNull();
    });

    it('★ 빈 본문 페이지만 분포에서 빠진다 — 분모 편향이 없어도(304 0건) 빈 본문 갤러리 12건 + 루트는 강등되지 않는다', async () => {
      const { id } = await h.createSource();
      const gallery = Array.from({ length: 12 }, (_, i) => `/docs/g${i + 1}`);
      const fetcher = okRobots(new FakeFetcher()).route(DOCS, html(rootBody(gallery)));
      gallery.forEach((p, i) => fetcher.route(`${HOST}${p}`, html(galleryPage(i + 1))));
      const run = await h.drive(h.makeRunner({ fetcher }).runner, await h.startRun(id, 'PREVIEW'));
      expect(run.demotedReason).toBeNull();
    });

    it('★ 옛 URL 12개가 같은 호스트의 새 URL로 통합(리다이렉트)되는 정상 개편은 강등되지 않는다', async () => {
      const { id } = await h.createSource();
      const olds = Array.from({ length: 12 }, (_, i) => `/docs/v1/p${i + 1}`);
      for (const [i, p] of olds.entries()) await addDoc(h, id, p, { etag: `"e${i}"`, ...(await ingestedFields(docBody(i + 1))) });
      await addDoc(h, id, '/docs/', { ...(await ingestedFields(rootBody(olds))) });
      const fetcher = okRobots(new FakeFetcher()).route(DOCS, html(rootBody(olds))).route(`${HOST}/docs/latest/`, html(page('최신 문서')));
      olds.forEach((p) => fetcher.route(`${HOST}${p}`, redirect('/docs/latest/', 301)));
      const run = await h.drive(h.makeRunner({ fetcher }).runner, await h.startRun(id, 'SYNC'));
      expect(run.demotedReason).toBeNull();
      const source = await h.prisma.kbSource.findUniqueOrThrow({ where: { id } });
      expect(source.approvedConfigVersion).toBe(1);
    });

    it('대조 — 같은 호스트의 로그인 경로(/docs/sign-in)로 12개가 수렴하면 여전히 강등된다', async () => {
      const { id } = await h.createSource();
      const olds = Array.from({ length: 12 }, (_, i) => `/docs/p${i + 1}`);
      for (const [i, p] of olds.entries()) await addDoc(h, id, p, { ...(await ingestedFields(docBody(i + 1))) });
      await addDoc(h, id, '/docs/', { ...(await ingestedFields(rootBody(olds))) });
      const fetcher = okRobots(new FakeFetcher()).route(DOCS, html(rootBody(olds))).route(`${HOST}/docs/sign-in`, html(page('로그인이 필요합니다')));
      olds.forEach((p) => fetcher.route(`${HOST}${p}`, redirect('/docs/sign-in')));
      const run = await h.drive(h.makeRunner({ fetcher }).runner, await h.startRun(id, 'SYNC'));
      expect(run.demotedReason).toBe('AUTH_WALL');
    });

    it('대조 — 304 문서 2건이 섞여 있어도 로그인 폼 12쪽 + 루트는 여전히 강등된다(분모가 희석돼도 80%를 넘는 진짜 벽)', async () => {
      const { id } = await h.createSource();
      const paths = Array.from({ length: 12 }, (_, i) => `/docs/p${i + 1}`);
      const unchanged = ['/docs/u1', '/docs/u2'];
      for (const [i, p] of paths.entries()) await addDoc(h, id, p, { ...(await ingestedFields(docBody(i + 1))) });
      for (const p of unchanged) await addDoc(h, id, p, { etag: '"u"', ...(await ingestedFields(docBody(99))) });
      await addDoc(h, id, '/docs/', { ...(await ingestedFields(rootBody(paths))) });
      const form = page('로그인이 필요합니다', [...paths, ...unchanged]);
      const fetcher = okRobots(new FakeFetcher()).route(DOCS, html(form));
      paths.forEach((p) => fetcher.route(`${HOST}${p}`, html(form)));
      unchanged.forEach((p) => fetcher.route(`${HOST}${p}`, notModified()));
      const run = await h.drive(h.makeRunner({ fetcher }).runner, await h.startRun(id, 'SYNC'));
      expect(run.demotedReason).toBe('AUTH_WALL');
    });
  });


  /* ───────────────────────── M-3 ───────────────────────── */
  describe('M-3 — FULL_RESEND는 이번 실행에서 다시 발견되지 않은 문서를 재전송하지 않는다', () => {
    const PUBLIC = `${HOST}/docs/public/`;

    it('★ 재현 — 경로 접두를 /docs/public으로 줄이면 옛 /docs/private/secret(ACTIVE · 적재됨)은 FULL_RESEND 대상이 아니다', async () => {
      const { id } = await h.createSource({ seedUrls: [PUBLIC], pathPrefixes: ['/docs/public'] });
      await addDoc(h, id, '/docs/private/secret', { lastIngestedAt: new Date(Date.now() - 3_600_000), contentHash: 'h', ingestFingerprint: 'f' });
      const fetcher = okRobots(new FakeFetcher()).route(PUBLIC, html(page('공개 목록', ['/docs/public/a']))).route(`${HOST}/docs/public/a`, html(page('공개 A')));
      const runId = await h.startRun(id, 'FULL_RESEND');
      const run = await h.drive(h.makeRunner({ fetcher }).runner, runId);
      expect(run.status).toBe('INGESTING');
      const jobs = await h.prisma.kbIngestJob.findMany({ where: { runId } });
      const urls = (await h.prisma.kbDocument.findMany({ where: { id: { in: jobs.map((j) => j.documentId) } } })).map((d) => d.url).sort();
      expect(urls).toEqual([PUBLIC, `${HOST}/docs/public/a`].sort());
      expect(urls).not.toContain(`${HOST}/docs/private/secret`);
      expect(fetcher.hitsOf(`${HOST}/docs/private/secret`)).toBe(0);
    });

    it('대조 — 이번에 다시 발견된 304 문서(적재됨)는 계속 대상이다(seenRunId가 이번 실행)', async () => {
      const { id } = await h.createSource();
      await addDoc(h, id, '/docs/', { lastIngestedAt: new Date(Date.now() - 3_600_000), contentHash: 'h', ingestFingerprint: 'f', etag: '"r1"' });
      const fetcher = okRobots(new FakeFetcher()).route(DOCS, (r) => (r.headers['if-none-match'] === '"r1"' ? status(304) : html(page('목록'))));
      const runId = await h.startRun(id, 'FULL_RESEND');
      expect((await h.drive(h.makeRunner({ fetcher }).runner, runId)).status).toBe('INGESTING');
      expect(await h.prisma.kbIngestJob.count({ where: { runId } })).toBe(1);
    });

    it('★ L-4 — 예전에 적재된 뒤 리다이렉트 원본이 된 /docs/old는 대상이 아니고 목적지만 대상이다', async () => {
      const { id } = await h.createSource();
      await addDoc(h, id, '/docs/old', { lastIngestedAt: new Date(Date.now() - 3_600_000), contentHash: 'h', ingestFingerprint: 'f' });
      const fetcher = okRobots(new FakeFetcher())
        .route(DOCS, html(page('목록', ['/docs/old'])))
        .route(`${HOST}/docs/old`, redirect('/docs/new', 301))
        .route(`${HOST}/docs/new`, html(page('새 문서')));
      const runId = await h.startRun(id, 'FULL_RESEND');
      expect((await h.drive(h.makeRunner({ fetcher }).runner, runId)).status).toBe('INGESTING');
      const jobs = await h.prisma.kbIngestJob.findMany({ where: { runId } });
      const urls = (await h.prisma.kbDocument.findMany({ where: { id: { in: jobs.map((j) => j.documentId) } } })).map((d) => d.url).sort();
      expect(urls).toEqual([DOCS, `${HOST}/docs/new`].sort());
    });

    it('대조 — 다음 실행에서 /docs/old가 리다이렉트를 멈추고 200이면(지문이 새 실행에서 다시 정해진다) 다시 대상이다', async () => {
      const { id } = await h.createSource();
      await addDoc(h, id, '/docs/old', { lastIngestedAt: new Date(Date.now() - 3_600_000), contentHash: 'h', ingestFingerprint: 'f', observedHash: 'RL:stale' });
      const fetcher = okRobots(new FakeFetcher()).route(DOCS, html(page('목록', ['/docs/old']))).route(`${HOST}/docs/old`, html(page('옛 문서 복귀')));
      const runId = await h.startRun(id, 'FULL_RESEND');
      expect((await h.drive(h.makeRunner({ fetcher }).runner, runId)).status).toBe('INGESTING');
      const jobs = await h.prisma.kbIngestJob.findMany({ where: { runId } });
      const urls = (await h.prisma.kbDocument.findMany({ where: { id: { in: jobs.map((j) => j.documentId) } } })).map((d) => d.url);
      expect(urls).toContain(`${HOST}/docs/old`);
    });

    describe('적재 단계 방어 — 문서 URL이 현재 소스 범위 밖이면 SKIPPED(EXCLUDED_AT_INGEST)', () => {
      function makeRag() {
        return {
          isConfigured: () => true,
          status: jest.fn(async () => ({ networkError: false, httpStatus: 200, body: { vllm_ready: true } })),
          ingest: jest.fn(async () => ({ networkError: false, httpStatus: 200, body: { result: 'RAG Vector DB 추가 성공.' } })),
          taskStatus: jest.fn(),
        };
      }
      function makeIngestRunner(fetcher: FakeFetcher) {
        const rag = makeRag();
        const runner = new KbIngestRunner(h.store, h.sourcesService, h.prisma, rag as never, fetcher as never, { get: () => null } as never, makeConfig({ KB_INGEST_POLL_MS: 10 }), new InProcessExtractor(), { tryAcquire: () => true } as never);
        return { runner, rag };
      }
      async function pendingJob(path: string, sourceOver: Record<string, unknown>) {
        const { id } = await h.createSource(sourceOver);
        const runId = await h.startRun(id, 'FULL_RESEND');
        await h.prisma.kbSyncRun.update({ where: { id: runId }, data: { status: 'INGESTING' } });
        const doc = await addDoc(h, id, path, { seenRunId: runId, lastIngestedAt: new Date(Date.now() - 3_600_000), contentHash: 'h', ingestFingerprint: 'f' });
        await h.store.createIngestJobsBulk([{ runId, sourceId: id, documentId: doc.id, lane: 'INCREMENTAL', reason: 'FULL_RESEND' }]);
        return h.prisma.kbIngestJob.findFirstOrThrow({ where: { runId } });
      }

      it.each([
        ['경로 접두 밖', '/docs/private/secret', { seedUrls: [PUBLIC], pathPrefixes: ['/docs/public'] }],
        ['제외 패턴', '/docs/public/internal/x', { seedUrls: [PUBLIC], pathPrefixes: ['/docs/public'], excludePatterns: ['/docs/public/internal/*'] }],
      ])('★ %s인 문서의 작업은 재수집·외부 제출 없이 SKIPPED(EXCLUDED_AT_INGEST)', async (_l, path, sourceOver) => {
        const job = await pendingJob(path, sourceOver);
        const fetcher = new FakeFetcher().route(`${HOST}${path}`, html(page('비공개')));
        const { runner, rag } = makeIngestRunner(fetcher);
        await runner.runFragment(new Date());
        const after = await h.prisma.kbIngestJob.findUniqueOrThrow({ where: { id: job.id } });
        expect(after.status).toBe('SKIPPED');
        expect(after.resultCode).toBe('EXCLUDED_AT_INGEST');
        expect(fetcher.requests).toHaveLength(0);
        expect(rag.ingest).not.toHaveBeenCalled();
      });

      it('대조 — 범위 안 문서는 그대로 재수집·제출된다', async () => {
        const job = await pendingJob('/docs/public/a', { seedUrls: [PUBLIC], pathPrefixes: ['/docs/public'] });
        const fetcher = new FakeFetcher().route(`${HOST}/docs/public/a`, html(page('공개 A')));
        const { runner, rag } = makeIngestRunner(fetcher);
        await runner.runFragment(new Date());
        expect(rag.ingest).toHaveBeenCalledTimes(1);
        expect((await h.prisma.kbIngestJob.findUniqueOrThrow({ where: { id: job.id } })).status).not.toBe('SKIPPED');
      });
    });
  });


  /* ───────────────────────── L-1 ───────────────────────── */
  describe('L-1 — 강등된 실행은 삭제 감지 스윕을 하지 않는다', () => {
    const paths = Array.from({ length: 12 }, (_, i) => `/docs/p${i + 1}`);
    const docBody = (i: number): string => page(`문서 ${i}`, [], `문서 ${i}번의 서로 다른 본문입니다. `.repeat(12));

    async function seedIngested(): Promise<string> {
      const { id } = await h.createSource();
      for (const [i, p] of paths.entries()) await addDoc(h, id, p, { ...(await ingestedFields(docBody(i + 1))) });
      await addDoc(h, id, '/docs/', { ...(await ingestedFields(page('목록', paths))) });
      await addDoc(h, id, '/docs/orphan', { ...(await ingestedFields(docBody(77))) }); // 이번에 어디서도 다시 발견되지 않는 적재 문서
      return id;
    }

    it('★ 재현 — 로그인 벽으로 강등된 SYNC: 다시 발견되지 않은 적재 문서의 missingStreak이 오르지 않고 요약 missing이 0이다', async () => {
      const id = await seedIngested();
      const form = page('로그인이 필요합니다', paths);
      const fetcher = okRobots(new FakeFetcher()).route(DOCS, html(form));
      paths.forEach((p) => fetcher.route(`${HOST}${p}`, html(form)));
      const run = await h.drive(h.makeRunner({ fetcher }).runner, await h.startRun(id, 'SYNC'));
      expect(run.demotedReason).toBe('AUTH_WALL');
      const orphan = await h.prisma.kbDocument.findFirstOrThrow({ where: { sourceId: id, url: `${HOST}/docs/orphan` } });
      expect(orphan.missingStreak).toBe(0);
      expect(orphan.state).toBe('ACTIVE');
      const counts = JSON.parse(run.counts) as { missing: number; gone: number; needsCleanup: number };
      expect(counts.missing).toBe(0);
      expect(counts.gone).toBe(0);
      expect(counts.needsCleanup).toBe(0);
    });

    it('대조 — 강등되지 않은 정상 SYNC는 스윕이 그대로 동작한다(orphan missingStreak 1 · 요약 missing 1)', async () => {
      const id = await seedIngested();
      const fetcher = okRobots(new FakeFetcher()).route(DOCS, html(page('목록', paths)));
      paths.forEach((p, i) => fetcher.route(`${HOST}${p}`, html(docBody(i + 1))));
      const run = await h.drive(h.makeRunner({ fetcher }).runner, await h.startRun(id, 'SYNC'));
      expect(run.demotedReason).toBeNull();
      const orphan = await h.prisma.kbDocument.findFirstOrThrow({ where: { sourceId: id, url: `${HOST}/docs/orphan` } });
      expect(orphan.missingStreak).toBe(1);
      expect((JSON.parse(run.counts) as { missing: number }).missing).toBe(1);
    });
  });


  /* ───────────────────────── M-4 ───────────────────────── */
  describe('M-4 — 리다이렉트 홉의 간격 대기가 조각(tick) 예산을 넘겨 점유하지 않는다', () => {
    const SLICE_MS = 25_000;
    const A = `${HOST}/docs/a`;
    /** 조각 기한을 넘긴 시간(ms)의 허용 여유 — 1초 단위 대기 조각 1개분. */
    const SLACK_MS = 1_000;

    /** 간격 300초 소스 — 시작 주소가 곧 리다이렉트 문서(/docs/a → /docs/a/). robots는 미리 캐시해 첫 요청이 간격 대기 없이 나가게 한다. */
    async function redirectSource(intervalMs = 300_000) {
      const { id } = await h.createSource({ seedUrls: [A], minIntervalMs: intervalMs });
      const { pacer, clock } = makeClockedPacer();
      const fetcher = okRobots(new FakeFetcher()).route(A, redirect('/docs/a/', 301)).route(`${A}/`, html(page('A 폴더')));
      const made = h.makeRunner({ fetcher, pacer });
      (made.runner as unknown as { robotsCache: Map<string, unknown> }).robotsCache.set('https://a.example', { rules: 'ALLOW_ALL', fetchedAt: Date.now() });
      return { id, pacer, clock, fetcher, runner: made.runner };
    }
    const resumeMap = (runner: unknown): Map<string, unknown> => (runner as { redirectResume: Map<string, unknown> }).redirectResume;

    /** tick 흉내 — 조각마다 예산 25초, 조각 사이 10초(PollingLoop 간격). 각 조각이 기한을 얼마나 넘겼는지 모아 돌려준다. */
    async function driveTicks(runner: Parameters<Harness['fragment']>[0], runId: string, clock: { t: number }, opts: { max: number; afterFragment?: (n: number) => void | Promise<void> }): Promise<{ fragments: number; overshoots: number[] }> {
      const overshoots: number[] = [];
      let n = 0;
      for (; n < opts.max; n += 1) {
        const run = await h.store.findRun(runId);
        if (run && run.status !== 'QUEUED' && run.status !== 'CRAWLING') break;
        const deadline = clock.t + SLICE_MS;
        await h.fragment(runner, runId, { deadlineAt: deadline });
        overshoots.push(clock.t - deadline);
        await opts.afterFragment?.(n);
        clock.t += 10_000;
      }
      return { fragments: n, overshoots };
    }

    it('★ (a) 간격 300초 리다이렉트 문서가 있어도 어느 조각도 예산(+작은 여유)을 넘지 않고, 실행은 종결된다', async () => {
      const { id, clock, fetcher, runner } = await redirectSource();
      const runId = await h.startRun(id, 'PREVIEW');
      const { fragments, overshoots } = await driveTicks(runner, runId, clock, { max: 60 });
      expect(Math.max(...overshoots)).toBeLessThanOrEqual(SLACK_MS);
      expect(fragments).toBeGreaterThan(5); // 300초 대기가 여러 조각에 걸쳐 나뉘었다.
      expect((await h.store.findRun(runId))?.status).toBe('SUCCEEDED');
      expect(fetcher.hitsOf(A)).toBe(1);
      expect(fetcher.hitsOf(`${A}/`)).toBe(1);
    });

    it('★ (b) 홉 0의 응답 뒤 미룬 상태를 저장하고, 다음 조각은 홉 0을 다시 요청하지 않고 목적지를 받아 실행이 종결된다', async () => {
      const { id, clock, fetcher, runner } = await redirectSource();
      const runId = await h.startRun(id, 'PREVIEW');
      await h.fragment(runner, runId, { deadlineAt: clock.t + SLICE_MS });
      expect(fetcher.hitsOf(A)).toBe(1);
      expect(fetcher.hitsOf(`${A}/`)).toBe(0); // 홉 1은 간격(300초)을 기다려야 해 미뤘다.
      expect(resumeMap(runner).size).toBe(1); // 재개 상태 저장
      clock.t += 10_000;
      await driveTicks(runner, runId, clock, { max: 60 });
      expect(fetcher.hitsOf(A)).toBe(1); // 홉 0을 다시 요청하지 않았다.
      expect(fetcher.hitsOf(`${A}/`)).toBe(1);
      expect((await docOf(h, id, '/docs/a/')).title).toBe('A 폴더');
      expect((await h.store.findRun(runId))?.status).toBe('SUCCEEDED');
      expect(resumeMap(runner).size).toBe(0); // 종결 뒤 상태는 비워진다.
    });

    it('★ (b2) 다중 홉(3회) 도중에 미뤄도 저장된 홉에서 이어간다 — 홉 0~2를 다시 요청하지 않는다', async () => {
      const { id } = await h.createSource({ seedUrls: [`${HOST}/docs/h0`], minIntervalMs: 60_000 });
      const { pacer, clock } = makeClockedPacer();
      const fetcher = okRobots(new FakeFetcher())
        .route(`${HOST}/docs/h0`, redirect('/docs/h1'))
        .route(`${HOST}/docs/h1`, redirect('/docs/h2'))
        .route(`${HOST}/docs/h2`, redirect('/docs/h3'))
        .route(`${HOST}/docs/h3`, html(page('최종')));
      const { runner } = h.makeRunner({ fetcher, pacer });
      (runner as unknown as { robotsCache: Map<string, unknown> }).robotsCache.set('https://a.example', { rules: 'ALLOW_ALL', fetchedAt: Date.now() });
      const runId = await h.startRun(id, 'PREVIEW');
      const { overshoots } = await driveTicks(runner, runId, clock, { max: 60 });
      expect(Math.max(...overshoots)).toBeLessThanOrEqual(SLACK_MS);
      expect((await h.store.findRun(runId))?.status).toBe('SUCCEEDED');
      for (const p of ['h0', 'h1', 'h2', 'h3']) expect(fetcher.hitsOf(`${HOST}/docs/${p}`)).toBe(1);
      expect((await docOf(h, id, '/docs/h3')).title).toBe('최종');
    });

    it('★ (c) 저장 상태가 폐기되면(인스턴스 재시작 등) 홉 0부터 다시 요청해도 실행이 종결된다(요청 1회 중복)', async () => {
      const { id, clock, fetcher, runner } = await redirectSource();
      const runId = await h.startRun(id, 'PREVIEW');
      const { fragments } = await driveTicks(runner, runId, clock, {
        max: 80,
        afterFragment: (n) => {
          if (n === 0) resumeMap(runner).clear(); // 첫 조각이 끝난 직후 상태를 잃는다.
        },
      });
      expect(fragments).toBeLessThan(80);
      expect((await h.store.findRun(runId))?.status).toBe('SUCCEEDED');
      expect(fetcher.hitsOf(A)).toBe(2); // 홉 0을 한 번 더 요청했다.
      expect(fetcher.hitsOf(`${A}/`)).toBe(1);
    });

    it('★ (c2) 저장 상태가 오래되면(만료 30분) 버리고 홉 0부터 다시 한다', async () => {
      const { id, clock, fetcher, runner } = await redirectSource();
      const runId = await h.startRun(id, 'PREVIEW');
      await h.fragment(runner, runId, { deadlineAt: clock.t + SLICE_MS });
      expect(resumeMap(runner).size).toBe(1);
      clock.t += 3 * 3_600_000; // 3시간 뒤 — 저장 상태는 오래됐다.
      await driveTicks(runner, runId, clock, { max: 60 });
      expect(fetcher.hitsOf(A)).toBe(2);
      expect((await h.store.findRun(runId))?.status).toBe('SUCCEEDED');
    });

    it('★ (d) 같은 tick의 다른 실행이 굶지 않는다 — 간격 300초 리다이렉트 실행 A가 있어도 B가 같은 tick 안에 끝난다', async () => {
      const a = await redirectSource();
      const { id: bId } = await h.createSource({ seedUrls: ['https://b.example/docs/'], pathPrefixes: ['/docs'], minIntervalMs: 500 });
      const bFetcher = new FakeFetcher().route('https://b.example/robots.txt', html('User-agent: *\nAllow: /\n')).route('https://b.example/docs/', html(page('B 목록')));
      const b = h.makeRunner({ fetcher: bFetcher, pacer: a.pacer });
      const aRun = await h.startRun(a.id, 'PREVIEW');
      const bRun = await h.startRun(bId, 'PREVIEW');

      // KbSyncJob.tick과 같은 예산 분배 — 크롤 예산(30초 − 적재 몫 5초)을 실행 수로 나눠 조각 기한을 주고, 크롤 예산이 끝나면 남은 실행은 다음 tick으로 넘어간다.
      const tickStart = a.clock.t;
      const crawlEnd = tickStart + 25_000;
      const order = [
        { runner: a.runner, runId: aRun },
        { runner: b.runner, runId: bRun },
      ];
      for (const [index, item] of order.entries()) {
        if (a.clock.t >= crawlEnd) break;
        const divisor = Math.max(1, Math.min(2, order.length - index));
        const runDeadline = a.clock.t + (crawlEnd - a.clock.t) / divisor;
        await h.fragment(item.runner, item.runId, { deadlineAt: runDeadline });
      }
      expect(a.clock.t).toBeLessThanOrEqual(crawlEnd + SLACK_MS);
      expect((await h.store.findRun(bRun))?.status).toBe('SUCCEEDED'); // B가 굶지 않았다.
      expect((await h.store.findRun(aRun))?.status).toBe('CRAWLING'); // A는 간격을 기다리며 다음 tick에 이어간다.
    });
  });

  /* ───────────────────────── L-3 ───────────────────────── */
  describe('L-3 — 요청 직전 임대 갱신은 항상 한다(중지 직후 요청이 나가지 않는다)', () => {
    it('★ 마지막 갱신 직후(2초 안) 중지해도 다음 요청은 나가지 않는다', async () => {
      const { id } = await h.createSource();
      const fetcher = okRobots(new FakeFetcher()).route(DOCS, html(page('목록')));
      const { runner } = h.makeRunner({ fetcher });
      const runId = await h.startRun(id, 'PREVIEW');
      // robots.txt 요청이 나간 직후(그 요청 직전 갱신은 방금 끝났다) 사용자가 중지한다 — 다음 요청(목록)은 나가면 안 된다.
      fetcher.onRequest = async (r) => {
        if (r.url.endsWith('/robots.txt')) await h.store.cancelRun(runId, new Date(), 'user-1');
      };
      await h.fragment(runner, runId, {});
      expect(fetcher.hitsOf(DOCS)).toBe(0);
      expect((await h.store.findRun(runId))?.status).toBe('CANCELLED');
    });

    it('대조 — 중지하지 않으면 같은 흐름에서 목록이 요청된다', async () => {
      const { id } = await h.createSource();
      const fetcher = okRobots(new FakeFetcher()).route(DOCS, html(page('목록')));
      const { runner } = h.makeRunner({ fetcher });
      const runId = await h.startRun(id, 'PREVIEW');
      await h.drive(runner, runId);
      expect(fetcher.hitsOf(DOCS)).toBe(1);
    });
  });

  // @@INSERT
  void makeClockedPacer;
});
