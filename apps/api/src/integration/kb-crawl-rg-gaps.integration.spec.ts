import { zipSync, strToU8 } from 'fflate';
import { InProcessExtractor } from '../kb-sync/extract/in-process.extractor';
import { WorkerEntryMissingError } from '../kb-sync/extract/kb-extractor.port';
import type { KbExtractRequest, KbExtractResult, KbExtractorPort } from '../kb-sync/extract/kb-extractor.port';
import { buildExternalFileName, urlHash } from '../kb-sync/lib/external-file-name';
import { FakeFetcher, HOST, ROBOTS_OK, createHarness, html, makeConfig, page, status } from './helpers/kb-crawl-db-harness';
import type { Harness } from './helpers/kb-crawl-db-harness';

/**
 * 지식베이스 크롤링(No.43) 백엔드 pass 5 — 설계서 §25.1 잔여 갭 RG-1·4·7·8·9·10·11·15의 재현 시험.
 * 실제 DB(SQLite 마이그레이션 적용) + 실제 저장소·서비스·크롤러, 네트워크·시간·문서 해석만 가짜.
 */
const DOCS = `${HOST}/docs/`;
const okRobots = (f: FakeFetcher): FakeFetcher => f.route(`${HOST}/robots.txt`, ROBOTS_OK);

async function addDoc(h: Harness, sourceId: string, path: string, over: Record<string, unknown> = {}) {
  const url = `${HOST}${path}`;
  const kind = (over.kind as string | undefined) ?? 'HTML';
  const ext = kind === 'PDF' ? 'pdf' : kind === 'HTML' ? 'html' : (kind.toLowerCase() as 'docx');
  return h.prisma.kbDocument.create({
    data: { sourceId, url, urlHash: urlHash(url), kind, externalFileName: buildExternalFileName(sourceId, url, ext), seenRunId: 'old-run', visitState: 'VISITED', ...over },
  });
}

describe('KB 크롤 잔여 갭(RG) — 크롤 단계', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await createHarness('rg-crawl');
  }, 60_000);

  afterAll(async () => {
    await h?.dispose();
  }, 15_000);

  /**
   * [pass 6 · RG-18] 같은 호스트를 쓰는 소스가 여럿이라 앞 시험이 남긴 진행 중 실행(QUEUED·CRAWLING)이 뒤 시험의 크롤 시작을 막는다 — 시험마다 진행 중 실행·문서·소스를 비운다.
   */
  async function resetKbState(): Promise<void> {
    await h.prisma.kbSyncRun.updateMany({ where: { status: { in: ['QUEUED', 'CRAWLING', 'INGESTING'] } }, data: { status: 'CANCELLED', finishedAt: new Date(), claimToken: null } });
    await h.prisma.kbSource.updateMany({ data: { activeRunId: null } });
    await h.prisma.kbIngestJob.deleteMany({});
    await h.prisma.kbDocument.deleteMany({});
    await h.prisma.kbSource.deleteMany({});
  }

  afterEach(async () => {
    await resetKbState();
  });

  /* ───────────────────────── RG-1 ───────────────────────── */
  describe('RG-1 — 시작 주소 전부 실패하면 삭제 감지 스윕 없이 FAILED(ALL_SEEDS_UNREACHABLE)', () => {
    async function seedOldDocs(sourceId: string) {
      const past = new Date(Date.now() - 86_400_000);
      await addDoc(h, sourceId, '/docs/old1', { lastIngestedAt: past, contentHash: 'h1', seenRunId: 'old-run' });
      await addDoc(h, sourceId, '/docs/old2', { lastIngestedAt: past, contentHash: 'h2', seenRunId: 'old-run' });
    }

    it.each([
      ['503', () => status(503)],
      ['연결 실패', () => ({ kind: 'ERROR' as const, outcome: 'NETWORK_ERROR' as const })],
    ])('★ 시작 주소가 전부 %s이고 robots만 받아지면 FAILED로 끝나고 기존 문서는 "없어짐"으로 세지 않는다', async (_label, seedResponse) => {
      const { id } = await h.createSource();
      await seedOldDocs(id);
      const { runner } = h.makeRunner({ fetcher: okRobots(new FakeFetcher()).route(DOCS, seedResponse()) });
      const runId = await h.startRun(id, 'SYNC');

      const run = await h.drive(runner, runId);

      expect(run.status).toBe('FAILED');
      expect(run.failureCode).toBe('ALL_SEEDS_UNREACHABLE');
      const docs = await h.prisma.kbDocument.findMany({ where: { sourceId: id, urlHash: { in: [urlHash(`${HOST}/docs/old1`), urlHash(`${HOST}/docs/old2`)] } } });
      expect(docs.map((d) => d.missingStreak)).toEqual([0, 0]); // 사이트 장애를 삭제로 세지 않았다(AC-KB3-4).
      expect(docs.every((d) => d.state === 'ACTIVE' && d.cleanupReason === null)).toBe(true);
      expect(await h.prisma.kbIngestJob.count({ where: { runId } })).toBe(0);
      const source = await h.prisma.kbSource.findUniqueOrThrow({ where: { id } });
      expect(source.activeRunId).toBeNull(); // 소스 선점도 풀렸다.
      expect(source.lastRunStatus).toBe('FAILED');
    });

    it('연속 두 번 시작 주소 장애여도 문서가 GONE·정리 필요가 되지 않는다(2회 규칙이 사이트 장애로 깨지지 않음)', async () => {
      const { id } = await h.createSource();
      await seedOldDocs(id);
      const { runner } = h.makeRunner({ fetcher: okRobots(new FakeFetcher()).route(DOCS, status(503)) });
      await h.drive(runner, await h.startRun(id, 'SYNC'));
      await h.drive(runner, await h.startRun(id, 'SYNC'));
      const gone = await h.prisma.kbDocument.count({ where: { sourceId: id, state: 'GONE' } });
      expect(gone).toBe(0);
      expect(await h.prisma.kbDocument.count({ where: { sourceId: id, cleanupReason: { not: null } } })).toBe(0);
    });

    it('미리보기(PREVIEW)도 시작 주소가 전부 실패하면 FAILED — 빈 결과로 "적재 승인"이 열리지 않는다', async () => {
      const { id } = await h.createSource();
      const { runner } = h.makeRunner({ fetcher: okRobots(new FakeFetcher()).route(DOCS, status(503)) });
      const run = await h.drive(runner, await h.startRun(id, 'PREVIEW'));
      expect(run.status).toBe('FAILED');
      expect(run.failureCode).toBe('ALL_SEEDS_UNREACHABLE');
    });

    it('대조 — 시작 주소가 하나라도 받아지면 정상 종결하고 다시 발견되지 않은 문서는 계속 센다', async () => {
      const { id } = await h.createSource();
      await seedOldDocs(id);
      const { runner } = h.makeRunner({ fetcher: okRobots(new FakeFetcher()).route(DOCS, html(page('목록'))) });
      const run = await h.drive(runner, await h.startRun(id, 'SYNC'));
      expect(run.status).not.toBe('FAILED');
      const old1 = await h.prisma.kbDocument.findUniqueOrThrow({ where: { sourceId_urlHash: { sourceId: id, urlHash: urlHash(`${HOST}/docs/old1`) } } });
      expect(old1.missingStreak).toBe(1);
    });

    it('★ 허용 호스트 전부의 robots가 5xx면 FAILED(ROBOTS_UNREACHABLE)', async () => {
      const { id } = await h.createSource();
      await seedOldDocs(id);
      const fetcher = new FakeFetcher().route(`${HOST}/robots.txt`, status(503)).route(DOCS, html(page('목록')));
      const { runner } = h.makeRunner({ fetcher });
      const run = await h.drive(runner, await h.startRun(id, 'SYNC'));
      expect(run.status).toBe('FAILED');
      expect(run.failureCode).toBe('ROBOTS_UNREACHABLE');
      expect(fetcher.hitsOf(DOCS)).toBe(0); // robots를 못 읽은 호스트로는 페이지 요청을 보내지 않는다.
      const old1 = await h.prisma.kbDocument.findUniqueOrThrow({ where: { sourceId_urlHash: { sourceId: id, urlHash: urlHash(`${HOST}/docs/old1`) } } });
      expect(old1.missingStreak).toBe(0);
    });

    it('★ 중지·일시중지된 실행은 실패 코드가 CANCELLED_BY_USER · SOURCE_DISABLED로 남는다', async () => {
      const { KbRunsService } = await import('../kb-sync/kb-runs.service');
      const runsService = new KbRunsService(h.prisma, h.config, h.store, h.sourcesService, { record: jest.fn() } as never, { isConfigured: () => true } as never);

      const a = await h.createSource();
      const runA = await h.startRun(a.id, 'SYNC');
      await runsService.cancelRun(a.id, runA, 'user-1');
      const rowA = await h.store.findRun(runA);
      expect(rowA?.status).toBe('CANCELLED');
      expect(rowA?.failureCode).toBe('CANCELLED_BY_USER');

      const b = await h.createSource();
      const runB = await h.startRun(b.id, 'SYNC');
      await h.sourcesService.update(b.id, { enabled: false }, 'user-1');
      const rowB = await h.store.findRun(runB);
      expect(rowB?.status).toBe('CANCELLED');
      expect(rowB?.failureCode).toBe('SOURCE_DISABLED');
      expect((await h.prisma.kbSource.findUniqueOrThrow({ where: { id: b.id } })).activeRunId).toBeNull();
    });
  });

  /* ───────────────────────── RG-4 ───────────────────────── */
  describe('RG-4 — 429·503은 URL당 1회 재시도, 호스트 연속 5회면 그 호스트 중단', () => {
    it('★ 첫 503은 그 URL을 다시 시도하고(지연 = 간격×4 또는 Retry-After), 재시도가 성공하면 정상 방문이다', async () => {
      const { id } = await h.createSource();
      const fetcher = okRobots(new FakeFetcher())
        .route(DOCS, html(page('목록', ['/docs/a'])))
        .route(`${HOST}/docs/a`, (_r, n) => (n === 1 ? status(503, { 'retry-after': '7' }) : html(page('A'))));
      const { runner, pacer } = h.makeRunner({ fetcher });
      const run = await h.drive(runner, await h.startRun(id, 'PREVIEW'));

      expect(fetcher.hitsOf(`${HOST}/docs/a`)).toBe(2);
      expect(run.status).toBe('SUCCEEDED');
      const doc = await h.prisma.kbDocument.findUniqueOrThrow({ where: { sourceId_urlHash: { sourceId: id, urlHash: urlHash(`${HOST}/docs/a`) } } });
      expect(doc.observedChange).toBe('NEW');
      expect(pacer.releases.some((r) => r.intervalMs === 7000)).toBe(true); // Retry-After 7초를 지켰다.
    });

    it('Retry-After가 없으면 소스 간격의 4배를 기다린다(상한 60초)', async () => {
      const { id } = await h.createSource({ minIntervalMs: 2000 });
      const fetcher = okRobots(new FakeFetcher())
        .route(DOCS, html(page('목록')))
        .route(DOCS, (_r, n) => (n === 1 ? status(429) : html(page('목록'))));
      const { runner, pacer } = h.makeRunner({ fetcher });
      await h.drive(runner, await h.startRun(id, 'PREVIEW'));
      expect(pacer.releases.some((r) => r.intervalMs === 8000)).toBe(true);
      const huge = new FakeFetcher();
      okRobots(huge).route(DOCS, (_r, n) => (n === 1 ? status(503, { 'retry-after': '99999' }) : html(page('목록'))));
      const second = h.makeRunner({ fetcher: huge });
      const s2 = await h.createSource();
      await h.drive(second.runner, await h.startRun(s2.id, 'PREVIEW'));
      expect(Math.max(...second.pacer.releases.map((r) => r.intervalMs))).toBe(60_000);
    });

    it('재시도도 실패하면 그 URL은 일시 오류(삭제로 세지 않음)로 기록하고 다음 URL로 간다', async () => {
      const { id } = await h.createSource();
      const fetcher = okRobots(new FakeFetcher())
        .route(DOCS, html(page('목록', ['/docs/a', '/docs/b'])))
        .route(`${HOST}/docs/a`, status(503))
        .route(`${HOST}/docs/b`, html(page('B')));
      const { runner } = h.makeRunner({ fetcher });
      await h.drive(runner, await h.startRun(id, 'PREVIEW'));
      expect(fetcher.hitsOf(`${HOST}/docs/a`)).toBe(2); // 1회 재시도까지만.
      expect(fetcher.hitsOf(`${HOST}/docs/b`)).toBe(1);
      const a = await h.prisma.kbDocument.findUniqueOrThrow({ where: { sourceId_urlHash: { sourceId: id, urlHash: urlHash(`${HOST}/docs/a`) } } });
      expect(a.visitState).toBe('VISITED');
      expect(a.missingStreak).toBe(0);
    });

    it('★ 같은 호스트에서 429·503이 연속 5회면 그 호스트를 중단한다(남은 URL 요청 0 · abortedHosts에 기록)', async () => {
      const { id } = await h.createSource();
      const kids = Array.from({ length: 8 }, (_, i) => `/docs/k${i}`);
      const fetcher = okRobots(new FakeFetcher()).route(DOCS, html(page('목록', kids)));
      for (const k of kids) fetcher.route(`${HOST}${k}`, status(503));
      const { runner } = h.makeRunner({ fetcher });
      const run = await h.drive(runner, await h.startRun(id, 'PREVIEW'));

      const childRequests = fetcher.urls().filter((u) => u.includes('/docs/k'));
      expect(childRequests).toHaveLength(5); // 503 응답 5회에서 멈췄다.
      expect(JSON.parse(run.abortedHosts)).toEqual(['a.example']);
      expect(run.status).toBe('SUCCEEDED'); // 시작 주소는 받았으므로 실행 자체는 실패가 아니다.
    });

    it('연속 5회가 아니면(중간에 성공 응답) 중단하지 않는다', async () => {
      const { id } = await h.createSource();
      const kids = Array.from({ length: 6 }, (_, i) => `/docs/m${i}`);
      const fetcher = okRobots(new FakeFetcher()).route(DOCS, html(page('목록', kids)));
      // 503은 URL당 2번(원 요청 + 재시도) 응답되므로 5회가 이어지지 않게 성공 응답을 사이에 둔다.
      kids.forEach((k, i) => fetcher.route(`${HOST}${k}`, i === 1 || i === 3 ? html(page('OK')) : status(503)));
      const { runner } = h.makeRunner({ fetcher });
      const run = await h.drive(runner, await h.startRun(id, 'PREVIEW'));
      expect(JSON.parse(run.abortedHosts)).toEqual([]);
      expect(fetcher.urls().filter((u) => u.includes('/docs/m')).length).toBe(10); // 4개 URL × 2회 + 성공 2개.
    });
  });

  describe('RG-4 — tick(조각)이 바뀌어도 재시도·연속 횟수·중단 호스트가 이어진다', () => {
    /**
     * 요청 1개마다 멈추는 페이서 — `release()` 뒤에는 시험이 `open()`으로 열어 줄 때까지 준비되지 않는다(= tick 경계).
     * [pass 6 · M-3 · RG-17] robots.txt 요청도 페이서를 거치고, 준비되지 않으면 조각 예산 안에서 기다리는 대신(남은 지연이 무한대라) 조각을 끝낸다.
     */
    class StepPacer {
      ready = true;
      now = (): number => Date.now();
      sleep = async (): Promise<void> => undefined;
      isReady(): boolean {
        return this.ready;
      }
      msUntilReady(): number {
        return this.ready ? 0 : 1_000_000_000;
      }
      acquire(): void {
        // 동시 연결 제한은 시험 관심사가 아니다.
      }
      release(): void {
        this.ready = false;
      }
      open(): void {
        this.ready = true;
      }
    }

    it('★ 호스트 연속 5회 중단은 조각을 넘어 세고, 중단 호스트는 실행 행에 남아 다른 인스턴스도 이어받는다', async () => {
      const { id } = await h.createSource();
      const kids = Array.from({ length: 6 }, (_, i) => `/docs/s${i}`);
      const fetcher = okRobots(new FakeFetcher()).route(DOCS, html(page('목록', kids)));
      for (const k of kids) fetcher.route(`${HOST}${k}`, status(503));
      const pacer = new StepPacer();
      const first = h.makeRunner({ fetcher, pacer });
      const runId = await h.startRun(id, 'PREVIEW');

      for (let i = 0; i < 12; i += 1) {
        pacer.open();
        await h.fragment(first.runner, runId);
        const row = await h.store.findRun(runId);
        if (row && JSON.parse(row.abortedHosts).length > 0) break;
      }
      const afterAbort = await h.store.findRun(runId);
      expect(JSON.parse(afterAbort!.abortedHosts)).toEqual(['a.example']); // 조각이 여러 번으로 나뉘어도 5회에서 중단됐다.
      expect(fetcher.urls().filter((u) => u.includes('/docs/s'))).toHaveLength(5);

      const run = await h.drive(first.runner, runId);
      expect(run.status).toBe('SUCCEEDED'); // 중단 호스트의 남은 URL은 요청 없이 정리되고 실행이 끝난다.
      expect(fetcher.urls().filter((u) => u.includes('/docs/s'))).toHaveLength(5);
    });

    it('★ 이어받은 인스턴스(메모리 상태 없음)는 실행 행에 남은 중단 호스트로 요청하지 않는다', async () => {
      const { id } = await h.createSource();
      const runId = await h.startRun(id, 'PREVIEW');
      // 다른 인스턴스가 robots를 못 읽어 호스트를 중단한 뒤 죽은 실행 — 임대가 만료됐다.
      await h.prisma.kbSyncRun.update({
        where: { id: runId },
        data: { status: 'CRAWLING', claimToken: 'dead-instance', claimedAt: new Date(Date.now() - 3_600_000), startedAt: new Date(Date.now() - 3_700_000), abortedHosts: JSON.stringify(['a.example']) },
      });
      const fetcher = okRobots(new FakeFetcher()).route(DOCS, html(page('목록')));
      const { runner } = h.makeRunner({ fetcher });
      const run = await h.drive(runner, runId);
      expect(fetcher.urls()).toEqual([]); // robots도 페이지도 요청하지 않았다.
      expect(run.status).toBe('FAILED');
      expect(run.failureCode).toBe('ROBOTS_UNREACHABLE');
      expect(run.resumedCount).toBe(1);
    });

    it('★ 재시도는 지연이 지난 뒤(다음 조각)에 이루어지고, 그 사이 문서는 QUEUED로 남는다', async () => {
      const { id } = await h.createSource();
      const fetcher = okRobots(new FakeFetcher())
        .route(DOCS, html(page('목록', ['/docs/a'])))
        .route(`${HOST}/docs/a`, (_r, n) => (n === 1 ? status(503) : html(page('A'))));
      const pacer = new StepPacer();
      const { runner } = h.makeRunner({ fetcher, pacer });
      const runId = await h.startRun(id, 'PREVIEW');
      const docA = () => h.prisma.kbDocument.findUniqueOrThrow({ where: { sourceId_urlHash: { sourceId: id, urlHash: urlHash(`${HOST}/docs/a`) } } });

      pacer.open();
      await h.fragment(runner, runId); // robots.txt(요청이므로 페이서를 한 번 쓴다 — pass 6 · M-3)
      pacer.open();
      await h.fragment(runner, runId); // 목록 페이지
      pacer.open();
      await h.fragment(runner, runId); // /docs/a → 503
      expect(fetcher.hitsOf(`${HOST}/docs/a`)).toBe(1);
      expect((await docA()).visitState).toBe('QUEUED');
      pacer.open();
      await h.fragment(runner, runId); // 재시도 → 성공
      expect(fetcher.hitsOf(`${HOST}/docs/a`)).toBe(2);
      expect((await docA()).observedChange).toBe('NEW');
      pacer.open();
      const run = await h.drive(runner, runId);
      expect(run.status).toBe('SUCCEEDED');
    });
  });

  /* ───────────────────────── RG-7 ───────────────────────── */
  describe('RG-7 — 원본 파일 전달이 꺼진 소스의 문서 파일은 내려받지 않고 RAW_FILE_OFF로 제외한다', () => {
    it('★ 요청 0 · 제외(RAW_FILE_OFF) · 적재 후보 아님 · 실행 요약의 제외 사유별 건수에 잡힌다', async () => {
      const { id } = await h.createSource({ allowRawFileIngest: false });
      const fetcher = okRobots(new FakeFetcher())
        .route(DOCS, html(page('목록', ['/docs/guide.pdf', '/docs/sheet.xlsx'])))
        .route(`${HOST}/docs/guide.pdf`, { kind: 'RESPONSE', status: 200, contentType: 'application/pdf', body: Buffer.from('%PDF-1.4 fake'), headers: {} });
      const { runner } = h.makeRunner({ fetcher });
      const run = await h.drive(runner, await h.startRun(id, 'PREVIEW'));

      expect(fetcher.urls().filter((u) => u.endsWith('.pdf') || u.endsWith('.xlsx'))).toEqual([]);
      const pdf = await h.prisma.kbDocument.findUniqueOrThrow({ where: { sourceId_urlHash: { sourceId: id, urlHash: urlHash(`${HOST}/docs/guide.pdf`) } } });
      expect(pdf.state).toBe('EXCLUDED');
      expect(pdf.excludeReason).toBe('RAW_FILE_OFF');
      expect(pdf.observedChange).toBeNull();
      const counts = JSON.parse(run.counts) as { excluded: Record<string, number>; added: number };
      expect(counts.excluded.RAW_FILE_OFF).toBe(2);
      expect(counts.added).toBe(1); // HTML 목록 페이지만.
    });

    it('SYNC에서도 적재 작업이 만들어지지 않고(HTML만) 파일은 제외로 남는다', async () => {
      const { id } = await h.createSource({ allowRawFileIngest: false });
      const fetcher = okRobots(new FakeFetcher())
        .route(DOCS, html(page('목록', ['/docs/guide.pdf'])))
        .route(`${HOST}/docs/guide.pdf`, { kind: 'RESPONSE', status: 200, contentType: 'application/pdf', body: Buffer.from('%PDF-1.4 fake'), headers: {} });
      const { runner } = h.makeRunner({ fetcher });
      const runId = await h.startRun(id, 'SYNC');
      await h.drive(runner, runId);
      const jobs = await h.prisma.kbIngestJob.findMany({ where: { runId } });
      expect(jobs).toHaveLength(1); // 목록 HTML 1건뿐.
      const docs = await h.prisma.kbDocument.findMany({ where: { id: { in: jobs.map((j) => j.documentId) } } });
      expect(docs.every((d) => d.kind === 'HTML')).toBe(true);
    });
  });

  /* ───────────────────────── RG-8 ───────────────────────── */
  describe('RG-8 — 원본 파일 전달이 켜진 소스는 전송 전에 사전 검사(추출기)를 거친다', () => {
    class ScriptedExtractor implements KbExtractorPort {
      readonly seen: KbExtractRequest[] = [];
      constructor(private readonly byMarker: Record<string, KbExtractResult | 'THROW' | 'MISSING_ENTRY'>) {}
      async extract(req: KbExtractRequest): Promise<KbExtractResult> {
        this.seen.push(req);
        if (req.kind === 'HTML') return new InProcessExtractor().extract(req);
        if (req.kind === 'SITEMAP') return { ok: true, normalizedText: '', text: '', piiMaskedCount: 0, flags: [] };
        const marker = new TextDecoder().decode(req.bytes);
        const r = this.byMarker[marker];
        if (r === 'THROW') throw new Error('FILE_UNSAFE_TIMEOUT');
        if (r === 'MISSING_ENTRY') throw new WorkerEntryMissingError('없음');
        return r ?? { ok: true, normalizedText: 'x', text: 'x', piiMaskedCount: 0, flags: [] };
      }
    }
    const okFile = (piiMaskedCount = 0): KbExtractResult => ({ ok: true, normalizedText: '본문', text: '본문', piiMaskedCount, flags: [] });

    const pdfRoute = (marker: string) => ({ kind: 'RESPONSE' as const, status: 200, contentType: 'application/pdf', body: Buffer.from(marker), headers: {} });

    async function crawlOne(extractor: KbExtractorPort, marker: string, cfg: Record<string, unknown> = {}) {
      const { id } = await h.createSource({ allowRawFileIngest: true });
      const fetcher = okRobots(new FakeFetcher()).route(DOCS, html(page('목록', ['/docs/f.pdf']))).route(`${HOST}/docs/f.pdf`, pdfRoute(marker));
      const { runner } = h.makeRunner({ fetcher, extractor, config: makeConfig(cfg) });
      await h.drive(runner, await h.startRun(id, 'PREVIEW'));
      return h.prisma.kbDocument.findUniqueOrThrow({ where: { sourceId_urlHash: { sourceId: id, urlHash: urlHash(`${HOST}/docs/f.pdf`) } } });
    }

    it('★ 크롤이 PDF를 추출기(작업 스레드)에 넘긴다 — 바이트 복사본으로(전송 시 공유 풀 분리 방지)', async () => {
      const ex = new ScriptedExtractor({ 'PDF-OK': okFile(0) });
      const doc = await crawlOne(ex, 'PDF-OK');
      const req = ex.seen.find((r) => r.kind === 'PDF');
      expect(req).toBeDefined();
      if (req?.kind !== 'PDF') throw new Error('PDF 요청이어야 한다');
      expect(req.bytes.constructor).toBe(Uint8Array);
      expect(doc.state).toBe('ACTIVE');
      expect(doc.observedChange).toBe('NEW');
    });

    it('★ 추출 결과 ok=false(압축 폭탄·매크로 등)면 FILE_UNSAFE로 제외한다', async () => {
      const doc = await crawlOne(new ScriptedExtractor({ BAD: { ok: false, normalizedText: '', text: '', piiMaskedCount: 0, flags: ['FILE_UNSAFE'] } }), 'BAD');
      expect(doc.state).toBe('EXCLUDED');
      expect(doc.excludeReason).toBe('FILE_UNSAFE');
      expect(doc.observedChange).toBeNull();
    });

    it('★ 암호화 파일은 FILE_ENCRYPTED로 제외한다(외부로 보내 실패시키지 않는다)', async () => {
      const doc = await crawlOne(new ScriptedExtractor({ ENC: { ok: true, normalizedText: '', text: '', piiMaskedCount: 0, encrypted: true, flags: ['FILE_ENCRYPTED'] } }), 'ENC');
      expect(doc.state).toBe('EXCLUDED');
      expect(doc.excludeReason).toBe('FILE_ENCRYPTED');
    });

    it('추출 예외(작업 스레드 시간 초과)는 그 파일만 FILE_UNSAFE로 제외한다', async () => {
      const doc = await crawlOne(new ScriptedExtractor({ SLOW: 'THROW' }), 'SLOW');
      expect(doc.state).toBe('EXCLUDED');
      expect(doc.excludeReason).toBe('FILE_UNSAFE');
    });

    it('워커 진입점 부재(전역 설정 오류)는 문서 탓으로 위장하지 않는다 — 파일은 QUEUED로 남는다', async () => {
      const { id } = await h.createSource({ allowRawFileIngest: true });
      const fetcher = okRobots(new FakeFetcher()).route(DOCS, html(page('목록', ['/docs/f.pdf']))).route(`${HOST}/docs/f.pdf`, pdfRoute('MISSING'));
      const { runner } = h.makeRunner({ fetcher, extractor: new ScriptedExtractor({ MISSING: 'MISSING_ENTRY' }) });
      const runId = await h.startRun(id, 'PREVIEW');
      await h.fragment(runner, runId);
      const doc = await h.prisma.kbDocument.findUniqueOrThrow({ where: { sourceId_urlHash: { sourceId: id, urlHash: urlHash(`${HOST}/docs/f.pdf`) } } });
      expect(doc.state).not.toBe('EXCLUDED');
      expect(doc.visitState).toBe('QUEUED');
    });

    it('★ 개인정보 건수는 방문 기록(observedPiiMasked)에 남고, 거버넌스 OFF면 그대로 적재 대상이다', async () => {
      const doc = await crawlOne(new ScriptedExtractor({ PII: okFile(3) }), 'PII', { DATA_GOVERNANCE_MODE: 'OFF' });
      expect(doc.state).toBe('ACTIVE');
      expect(doc.observedPiiMasked).toBe(3);
      expect(doc.observedChange).toBe('NEW');
    });

    it('★ 거버넌스 ON이면 개인정보가 1건 이상인 파일은 PII_IN_RAW_FILE로 제외한다(R-17)', async () => {
      const doc = await crawlOne(new ScriptedExtractor({ PII: okFile(2) }), 'PII', { DATA_GOVERNANCE_MODE: 'ON' });
      expect(doc.state).toBe('EXCLUDED');
      expect(doc.excludeReason).toBe('PII_IN_RAW_FILE');
      expect(doc.observedChange).toBeNull();
    });

    it('거버넌스 ON이어도 개인정보가 0건이면 적재 대상이다', async () => {
      const doc = await crawlOne(new ScriptedExtractor({ CLEAN: okFile(0) }), 'CLEAN', { DATA_GOVERNANCE_MODE: 'ON' });
      expect(doc.state).toBe('ACTIVE');
      expect(doc.observedChange).toBe('NEW');
    });

    it('★ 실제 추출기: 매크로(vbaProject.bin)가 든 DOCX는 FILE_UNSAFE로 제외된다', async () => {
      const macroDocx = Buffer.from(zipSync({ '[Content_Types].xml': strToU8('<Types/>'), 'word/document.xml': strToU8('<w:document xmlns:w="w"><w:body><w:p><w:r><w:t>본문</w:t></w:r></w:p></w:body></w:document>'), 'word/vbaProject.bin': strToU8('macro') }));
      const { id } = await h.createSource({ allowRawFileIngest: true });
      const fetcher = okRobots(new FakeFetcher())
        .route(DOCS, html(page('목록', ['/docs/m.docx'])))
        .route(`${HOST}/docs/m.docx`, { kind: 'RESPONSE', status: 200, contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', body: macroDocx, headers: {} });
      const { runner } = h.makeRunner({ fetcher });
      await h.drive(runner, await h.startRun(id, 'PREVIEW'));
      const doc = await h.prisma.kbDocument.findUniqueOrThrow({ where: { sourceId_urlHash: { sourceId: id, urlHash: urlHash(`${HOST}/docs/m.docx`) } } });
      expect(doc.state).toBe('EXCLUDED');
      expect(doc.excludeReason).toBe('FILE_UNSAFE');
    });

    it('실제 추출기: 암호화된 구형(OLE2 서명) 컨테이너는 FILE_ENCRYPTED로 제외된다', async () => {
      const ole2 = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(64)]);
      const { id } = await h.createSource({ allowRawFileIngest: true });
      const fetcher = okRobots(new FakeFetcher())
        .route(DOCS, html(page('목록', ['/docs/e.docx'])))
        .route(`${HOST}/docs/e.docx`, { kind: 'RESPONSE', status: 200, contentType: 'application/octet-stream', body: ole2, headers: {} });
      const { runner } = h.makeRunner({ fetcher });
      await h.drive(runner, await h.startRun(id, 'PREVIEW'));
      const doc = await h.prisma.kbDocument.findUniqueOrThrow({ where: { sourceId_urlHash: { sourceId: id, urlHash: urlHash(`${HOST}/docs/e.docx`) } } });
      expect(doc.excludeReason).toBe('FILE_ENCRYPTED');
    });
  });

  /* ───────────────────────── RG-9 · RG-15 ───────────────────────── */
  describe('RG-9·RG-15 — 크롤 임대는 자기 토큰으로만 갱신하고, 잃으면(중지 포함) 즉시 멈춘다', () => {
    it('★ 다른 인스턴스가 임대를 쥔 실행은 처리하지 않는다(같은 URL을 두 번 치지 않는다)', async () => {
      const { id } = await h.createSource();
      const shared = okRobots(new FakeFetcher()).route(DOCS, html(page('목록', ['/docs/a', '/docs/b']))).route(`${HOST}/docs/a`, html(page('A'))).route(`${HOST}/docs/b`, html(page('B')));
      const A = h.makeRunner({ fetcher: shared });
      const B = h.makeRunner({ fetcher: shared });
      const runId = await h.startRun(id, 'PREVIEW');

      let gate!: () => void;
      const blocked = new Promise<void>((resolve) => (gate = resolve));
      // [pass 6 · 시험 품질] A가 요청 지점에 도달했다는 **신호**를 기다린다(고정 시간 대기 `setTimeout`은 부하가 큰 실행에서 간헐 실패한다).
      let reachedRequest!: () => void;
      const aReached = new Promise<void>((resolve) => (reachedRequest = resolve));
      shared.onRequest = async (req) => {
        if (req.url === DOCS && shared.hitsOf(DOCS) === 1) {
          reachedRequest();
          await blocked; // A가 첫 페이지를 받는 동안 붙잡는다.
        }
      };
      const aRun = h.fragment(A.runner, runId);
      await aReached;
      await h.fragment(B.runner, runId); // B는 A의 임대를 보고 물러나야 한다.
      const requestsWhileHeld = shared.urls().slice();
      gate();
      await aRun;
      await h.drive(A.runner, runId);

      expect(requestsWhileHeld.filter((u) => u !== `${HOST}/robots.txt`)).toEqual([DOCS]); // B는 아무 것도 요청하지 않았다.
      for (const u of [DOCS, `${HOST}/docs/a`, `${HOST}/docs/b`]) expect(shared.hitsOf(u)).toBe(1);
      expect(shared.hitsOf(`${HOST}/robots.txt`)).toBe(1);
      const run = await h.store.findRun(runId);
      expect(run?.resumedCount).toBe(0);
    });

    it('★ 임대를 잃으면(다른 토큰으로 넘어감) 진행 중인 요청 1개 뒤 즉시 멈추고 종결하지 않는다', async () => {
      const { id } = await h.createSource();
      const fetcher = okRobots(new FakeFetcher()).route(DOCS, html(page('목록', ['/docs/a', '/docs/b']))).route(`${HOST}/docs/a`, html(page('A'))).route(`${HOST}/docs/b`, html(page('B')));
      fetcher.onRequest = async (req) => {
        if (req.url === DOCS) await h.prisma.kbSyncRun.updateMany({ where: { sourceId: id, status: 'CRAWLING' }, data: { claimToken: 'stolen-by-other-instance' } });
      };
      const { runner } = h.makeRunner({ fetcher });
      const runId = await h.startRun(id, 'PREVIEW');
      await h.fragment(runner, runId);
      expect(fetcher.urls().filter((u) => u.includes('/docs/a') || u.includes('/docs/b'))).toEqual([]);
      const run = await h.store.findRun(runId);
      expect(run?.status).toBe('CRAWLING');
      expect(run?.claimToken).toBe('stolen-by-other-instance'); // 남의 토큰을 덮어쓰지 않았다.
    });

    it('★ 중지된 CRAWLING 실행은 진행 중인 요청 1개 뒤 새 요청을 보내지 않는다(AC-KB5-4)', async () => {
      const { id } = await h.createSource();
      const kids = ['/docs/a', '/docs/b', '/docs/c'];
      const fetcher = okRobots(new FakeFetcher()).route(DOCS, html(page('목록', kids)));
      for (const k of kids) fetcher.route(`${HOST}${k}`, html(page(k)));
      const runId = await h.startRun(id, 'PREVIEW');
      fetcher.onRequest = async (req) => {
        if (req.url === DOCS) {
          await h.store.cancelRun(runId, new Date(), 'user-1');
          await h.sourcesService.releaseActiveRun(id, runId, 'CANCELLED', new Date());
        }
      };
      const { runner } = h.makeRunner({ fetcher });
      await h.fragment(runner, runId);

      expect(fetcher.urls().filter((u) => kids.some((k) => u.endsWith(k)))).toEqual([]);
      expect((await h.store.findRun(runId))?.status).toBe('CANCELLED');
      // 중지 시점에 응답 중이던 시작 주소 1개만 처리됐고(방문 1), 그 링크로 발견된 3개는 방문되지 않은 채 QUEUED로 남았다.
      const frontier = await h.store.countFrontier(id, runId);
      expect(frontier.visited).toBe(1);
      expect(frontier.queued).toBe(3);
    });

    it('URL마다 임대를 갱신한다(claimedAt이 조각 안에서 전진)', async () => {
      const { id } = await h.createSource();
      const fetcher = okRobots(new FakeFetcher()).route(DOCS, html(page('목록', ['/docs/a']))).route(`${HOST}/docs/a`, html(page('A')));
      const seen: number[] = [];
      fetcher.onRequest = async () => {
        const r = await h.prisma.kbSyncRun.findFirst({ where: { sourceId: id, status: 'CRAWLING' } });
        if (r?.claimedAt) seen.push(r.claimedAt.getTime());
        await new Promise((res) => setTimeout(res, 30));
      };
      const { runner } = h.makeRunner({ fetcher });
      await h.drive(runner, await h.startRun(id, 'PREVIEW'));
      expect(new Set(seen).size).toBeGreaterThanOrEqual(2);
    });
  });

  /* ───────────────────────── RG-10 ───────────────────────── */
  describe('RG-10 — 사라졌던 페이지가 돌아오면 GONE 정리 표시를 푼다', () => {
    it.each([
      ['200', () => html(page('복귀'))],
      ['304', () => status(304)],
    ])('★ %s로 복귀하면 ACTIVE · missingStreak 0 · cleanupReason 해제', async (_label, res) => {
      const { id } = await h.createSource();
      const doc = await addDoc(h, id, '/docs/', { state: 'GONE', cleanupReason: 'GONE', missingStreak: 2, lastIngestedAt: new Date(), contentHash: 'old', etag: '"e1"' });
      const { runner } = h.makeRunner({ fetcher: okRobots(new FakeFetcher()).route(DOCS, res()) });
      await h.drive(runner, await h.startRun(id, 'SYNC'));
      const after = await h.prisma.kbDocument.findUniqueOrThrow({ where: { id: doc.id } });
      expect(after.state).toBe('ACTIVE');
      expect(after.missingStreak).toBe(0);
      expect(after.cleanupReason).toBeNull();
    });

    it('GONE 외의 정리 사유(SCOPE_CHANGED 등)는 복귀해도 남긴다', async () => {
      const { id } = await h.createSource();
      const doc = await addDoc(h, id, '/docs/', { cleanupReason: 'SCOPE_CHANGED', lastIngestedAt: new Date(), contentHash: 'old' });
      const { runner } = h.makeRunner({ fetcher: okRobots(new FakeFetcher()).route(DOCS, html(page('복귀'))) });
      await h.drive(runner, await h.startRun(id, 'SYNC'));
      expect((await h.prisma.kbDocument.findUniqueOrThrow({ where: { id: doc.id } })).cleanupReason).toBe('SCOPE_CHANGED');
    });
  });

  /* ───────────────────────── RG-11 ───────────────────────── */
  describe('RG-11 — HTML 2MB 상한 · NO_BODY · X-Robots-Tag', () => {
    const excludeOf = async (id: string, path: string) => h.prisma.kbDocument.findUniqueOrThrow({ where: { sourceId_urlHash: { sourceId: id, urlHash: urlHash(`${HOST}${path}`) } } });

    it('★ HTML은 2MB로 받고(소스 파일 상한 20MB가 아님) 파일은 소스 상한으로 받는다', async () => {
      const { id } = await h.createSource({ allowRawFileIngest: true });
      const fetcher = okRobots(new FakeFetcher()).route(DOCS, html(page('목록', ['/docs/f.pdf']))).route(`${HOST}/docs/f.pdf`, { kind: 'RESPONSE', status: 200, contentType: 'application/pdf', body: Buffer.from('x'), headers: {} });
      const { runner } = h.makeRunner({ fetcher });
      await h.drive(runner, await h.startRun(id, 'PREVIEW'));
      expect(fetcher.requests.find((r) => r.url === DOCS)?.maxBytes).toBe(2 * 1024 * 1024);
      expect(fetcher.requests.find((r) => r.url.endsWith('.pdf'))?.maxBytes).toBe(20971520);
    });

    it('★ 응답이 상한을 넘으면(RESPONSE_TOO_LARGE) SIZE로 제외한다 — 일시 오류로 다시 시도하지 않는다', async () => {
      const { id } = await h.createSource();
      const fetcher = okRobots(new FakeFetcher())
        .route(DOCS, html(page('목록', ['/docs/big'])))
        .route(`${HOST}/docs/big`, { kind: 'ERROR', outcome: 'RESPONSE_TOO_LARGE' });
      const { runner } = h.makeRunner({ fetcher });
      await h.drive(runner, await h.startRun(id, 'PREVIEW'));
      const doc = await excludeOf(id, '/docs/big');
      expect(doc.state).toBe('EXCLUDED');
      expect(doc.excludeReason).toBe('SIZE');
      expect(fetcher.hitsOf(`${HOST}/docs/big`)).toBe(1);
    });

    it('★ 추출 텍스트가 200자 미만이면 NO_BODY로 제외하되 링크는 계속 따라간다(목차 페이지)', async () => {
      const { id } = await h.createSource();
      const fetcher = okRobots(new FakeFetcher())
        .route(DOCS, html('<html><body><main><h1>목차</h1><a href="/docs/a">A</a></main></body></html>'))
        .route(`${HOST}/docs/a`, html(page('A')));
      const { runner } = h.makeRunner({ fetcher });
      const run = await h.drive(runner, await h.startRun(id, 'PREVIEW'));
      const root = await excludeOf(id, '/docs/');
      expect(root.state).toBe('EXCLUDED');
      expect(root.excludeReason).toBe('NO_BODY');
      expect(root.observedChange).toBeNull();
      expect(fetcher.hitsOf(`${HOST}/docs/a`)).toBe(1);
      expect((JSON.parse(run.counts) as { excluded: Record<string, number> }).excluded.NO_BODY).toBe(1);
    });

    it.each([
      ['noindex', true],
      ['NoIndex, nofollow', true],
      ['none', true],
      ['ChatBotKBCrawler: noindex', true],
      ['googlebot: noindex', false],
      ['nofollow', false],
      ['index, follow', false],
    ])('★ X-Robots-Tag "%s" → 제외 %s', async (value, excluded) => {
      const { id } = await h.createSource();
      const fetcher = okRobots(new FakeFetcher()).route(DOCS, html(page('목록', ['/docs/a']), { 'x-robots-tag': value })).route(`${HOST}/docs/a`, html(page('A')));
      const { runner } = h.makeRunner({ fetcher });
      await h.drive(runner, await h.startRun(id, 'PREVIEW'));
      const root = await excludeOf(id, '/docs/');
      if (excluded) {
        expect(root.state).toBe('EXCLUDED');
        expect(root.excludeReason).toBe('NOINDEX');
      } else {
        expect(root.state).toBe('ACTIVE');
      }
    });

    it('X-Robots-Tag nofollow는 링크를 따라가지 않는다', async () => {
      const { id } = await h.createSource();
      const fetcher = okRobots(new FakeFetcher()).route(DOCS, html(page('목록', ['/docs/a']), { 'x-robots-tag': 'nofollow' })).route(`${HOST}/docs/a`, html(page('A')));
      const { runner } = h.makeRunner({ fetcher });
      await h.drive(runner, await h.startRun(id, 'PREVIEW'));
      expect(fetcher.hitsOf(`${HOST}/docs/a`)).toBe(0);
    });
  });
});
