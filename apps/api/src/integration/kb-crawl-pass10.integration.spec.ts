import { KbIngestRunner } from '../kb-sync/engine/kb-ingest.runner';
import { KbRunsService } from '../kb-sync/kb-runs.service';
import { InProcessExtractor } from '../kb-sync/extract/in-process.extractor';
import { computeIngestFingerprint, sha256Hex } from '../kb-sync/lib/content-fingerprint';
import { buildExternalFileName, urlHash } from '../kb-sync/lib/external-file-name';
import { FakeFetcher, HOST, createHarness, html, makeConfig, page } from './helpers/kb-crawl-db-harness';
import type { Harness } from './helpers/kb-crawl-db-harness';

/**
 * 지식베이스 크롤링(No.43) 백엔드 pass 10 — RG-25(제목 마스킹) · RG-23(승인 뒤 새 비율 강등) · U-3(적재 차단 감사) · RG-24 ①③(리다이렉트 포트·홉별 타임아웃)의 재현 시험.
 * 실제 DB(SQLite 마이그레이션 적용) + 실제 저장소·서비스·러너, 네트워크·시간·문서 해석·외부 RAG만 가짜.
 */
const DOCS = `${HOST}/docs/`;
const okRobots = (f: FakeFetcher): FakeFetcher => f.route(`${HOST}/robots.txt`, html('User-agent: *\nAllow: /\n'));

const docBody = (i: number): string => page(`문서 ${i}`, [], `문서 ${i}번의 서로 다른 본문입니다. `.repeat(12));

async function addDoc(h: Harness, sourceId: string, path: string, over: Record<string, unknown> = {}) {
  const url = `${HOST}${path}`;
  return h.prisma.kbDocument.create({
    data: { sourceId, url, urlHash: urlHash(url), kind: 'HTML', externalFileName: buildExternalFileName(sourceId, url, 'html'), seenRunId: 'old-run', visitState: 'VISITED', ...over },
  });
}

/** 이미 적재된 문서의 해시·지문 — 같은 본문이 다시 오면 UNCHANGED로 판정된다. */
async function ingestedFields(body: string) {
  const ex = await new InProcessExtractor().extract({ kind: 'HTML', html: body, noisePatterns: [], piiMask: true, piiMaskMode: 'PARTIAL' });
  const contentHash = sha256Hex(ex.normalizedText);
  const ingestFingerprint = computeIngestFingerprint({ contentHash, format: 'DOCX', piiMask: true, piiMaskMode: 'PARTIAL' });
  return { contentHash, ingestFingerprint, textLength: ex.normalizedText.length, lastIngestedAt: new Date(Date.now() - 3_600_000) };
}

function makeRag() {
  return {
    isConfigured: () => true,
    status: jest.fn(async () => ({ networkError: false, httpStatus: 200, body: { vllm_ready: true } })),
    ingest: jest.fn(async (_req: { file: { name: string; bytes: Uint8Array; contentType: string } }) => ({ networkError: false, httpStatus: 200, body: { result: 'RAG Vector DB 추가 성공.' } })),
    taskStatus: jest.fn(),
  };
}

describe('KB pass 10', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await createHarness('pass10');
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

  /* ───────────────────────── RG-25 ───────────────────────── */
  describe('RG-25 — 제목 마스킹', () => {
    const PII_TITLE = '문의 010-1234-5678 담당 hong@example.com';
    const decode = (bytes: Uint8Array): string => Buffer.from(bytes).toString('utf8');

    /** 크롤(SYNC) → 적재까지 끝까지 돌리고 외부 RAG로 간 파일 본문을 돌려준다. */
    async function crawlAndIngest(sourceOver: Record<string, unknown>, title: string, format: 'TXT' | 'HTML') {
      const { id } = await h.createSource(sourceOver);
      const fetcher = okRobots(new FakeFetcher()).route(DOCS, html(page(title)));
      const run = await h.drive(h.makeRunner({ fetcher }).runner, await h.startRun(id, 'SYNC'));
      expect(run.status).toBe('INGESTING');
      const rag = makeRag();
      const ingestRunner = new KbIngestRunner(h.store, h.sourcesService, h.prisma, rag as never, fetcher as never, { get: () => null } as never, makeConfig({ KB_INGEST_POLL_MS: 10, KB_HTML_INGEST_FORMAT: format }), new InProcessExtractor(), { tryAcquire: () => true } as never);
      await ingestRunner.runFragment(new Date());
      expect(rag.ingest).toHaveBeenCalledTimes(1);
      const sent = decode(rag.ingest.mock.calls[0][0].file.bytes);
      const doc = await h.prisma.kbDocument.findFirstOrThrow({ where: { sourceId: id, url: DOCS } });
      return { id, doc, sent };
    }

    it.each(['TXT', 'HTML'] as const)('★ 재현 — 제목에 전화번호·이메일이 있는 페이지: DB 제목 · 적재 파일 머리 줄 · 외부로 간 본문(%s) · 문서 목록 응답 모두 원문 0', async (format) => {
      const { id, doc, sent } = await crawlAndIngest({}, PII_TITLE, format);
      for (const leak of ['1234', 'hong@example.com']) {
        expect(doc.title ?? '').not.toContain(leak);
        expect(sent).not.toContain(leak);
      }
      expect(doc.title).toContain('010-****-5678');
      expect(sent).toContain('제목: 문의 010-****-5678');
      if (format === 'HTML') expect(sent).toContain('<title>문의 010-****-5678');
      // 문서 목록 API 응답(관리자 콘솔 노출 경로)도 저장값 그대로라 마스킹된 값이다.
      const runsService = new KbRunsService(h.prisma, h.config, h.store, h.sourcesService, { record: jest.fn() } as never, { isConfigured: () => true } as never);
      const list = await runsService.listDocuments(id, { page: 1, pageSize: 50 } as never);
      expect(JSON.stringify(list)).not.toMatch(/1234|hong@example\.com/);
      expect(list.items[0].title).toBe(doc.title);
    });

    it('★ 200자를 넘는 제목은 200자로 저장·전송되고, 자른 조각에 전화번호 앞자리가 남지 않는다', async () => {
      const long = `${'가'.repeat(195)}010-1234-5678 뒷부분`;
      const { doc, sent } = await crawlAndIngest({}, long, 'TXT');
      expect(Array.from(doc.title ?? '').length).toBeLessThanOrEqual(200);
      expect(doc.title).not.toMatch(/010-\d/);
      expect(sent).not.toMatch(/010-\d|1234/);
      const headerLine = sent.split('\n').find((l) => l.startsWith('제목: '))!;
      expect(Array.from(headerLine.slice('제목: '.length)).length).toBeLessThanOrEqual(200);
    });

    it('대조 — piiMask = false 소스(거버넌스 OFF)는 기존 규칙대로 제목을 마스킹하지 않는다(200자 절단만)', async () => {
      const { doc, sent } = await crawlAndIngest({ piiMask: false }, PII_TITLE, 'TXT');
      expect(doc.title).toBe(PII_TITLE);
      expect(sent).toContain(`제목: ${PII_TITLE}`);
    });
  });

  /* ───────────────────────── RG-23 ───────────────────────── */
  describe('RG-23 — 새 비율(NEW_RATIO) 강등은 승인으로 풀린다', () => {
    const existing = (n: number): string[] => Array.from({ length: n }, (_, i) => `/docs/d${i + 1}`);
    const fresh = (n: number): string[] => Array.from({ length: n }, (_, i) => `/docs/n${i + 1}`);
    const makeRuns = () => new KbRunsService(h.prisma, h.config, h.store, h.sourcesService, { record: jest.fn().mockResolvedValue(undefined) } as never, { isConfigured: () => true } as never);

    /** 적재된 ACTIVE 문서 `kept`건(다시 방문해도 UNCHANGED) + 옛 GONE 적재 문서 `gone`건이 있는 소스. 크롤은 새 문서 `added`건을 더 발견한다. */
    async function seed(opts: { kept: number; gone?: number; added: number }) {
      const { id } = await h.createSource();
      const keptPaths = existing(opts.kept);
      const newPaths = fresh(opts.added);
      for (const [i, p] of keptPaths.entries()) await addDoc(h, id, p, { ...(await ingestedFields(docBody(i + 1))) });
      for (let i = 0; i < (opts.gone ?? 0); i += 1) await addDoc(h, id, `/docs/gone${i}`, { state: 'GONE', ...(await ingestedFields(docBody(500 + i))) });
      const allLinks = [...keptPaths, ...newPaths];
      const fetcher = okRobots(new FakeFetcher()).route(DOCS, html(page('목록', allLinks)));
      keptPaths.forEach((p, i) => fetcher.route(`${HOST}${p}`, html(docBody(i + 1))));
      newPaths.forEach((p, i) => fetcher.route(`${HOST}${p}`, html(docBody(100 + i))));
      return { id, fetcher };
    }
    const jobCount = (runId: string) => h.prisma.kbIngestJob.count({ where: { runId } });

    it('★ (a) 재현 — 새 문서가 많아 미리보기가 강등돼도 승인하면 SYNC가 강등되지 않고 적재 작업이 생성된다', async () => {
      const { id, fetcher } = await seed({ kept: 20, added: 30 });
      const { runner } = h.makeRunner({ fetcher });
      const preview = await h.drive(runner, await h.startRun(id, 'PREVIEW'));
      expect(preview.demotedReason).toBe('NEW_RATIO');
      expect((await h.prisma.kbSource.findUniqueOrThrow({ where: { id } })).approvedConfigVersion).toBeNull();

      const { runId } = await makeRuns().approveIngest(id, { previewRunId: preview.id } as never, 'admin-1');
      expect((await h.store.findRun(runId))?.trigger).toBe('APPROVAL');
      const sync = await h.drive(runner, runId);
      expect(sync.demotedReason).toBeNull();
      expect(sync.status).toBe('INGESTING');
      expect(await jobCount(runId)).toBe(30);
      expect((await h.prisma.kbSource.findUniqueOrThrow({ where: { id } })).approvedConfigVersion).not.toBeNull();
    });

    it('(b) 승인 없이 시작된 SYNC(예약·수동)는 새 비율이 크면 여전히 강등된다', async () => {
      const scheduled = await seed({ kept: 20, added: 30 });
      const src = await h.prisma.kbSource.findUniqueOrThrow({ where: { id: scheduled.id } });
      const claimed = await h.sourcesService.claimAndCreateRun({ sourceId: scheduled.id, sourceName: src.name, kind: 'SYNC', trigger: 'SCHEDULED', configVersion: src.configVersion, nextRunAt: null });
      const run = await h.drive(h.makeRunner({ fetcher: scheduled.fetcher }).runner, claimed!.id);
      expect(run.demotedReason).toBe('NEW_RATIO');
      expect(await jobCount(run.id)).toBe(0);

      const manual = await seed({ kept: 20, added: 30 });
      const manualRun = await h.drive(h.makeRunner({ fetcher: manual.fetcher }).runner, await h.startRun(manual.id, 'SYNC'));
      expect(manualRun.demotedReason).toBe('NEW_RATIO');
    });

    it('(c) 승인으로 시작된 SYNC도 인증 벽(AUTH_WALL)이면 강등된다 — 면제는 새 비율만', async () => {
      const { id, fetcher } = await seed({ kept: 20, added: 30 });
      const { runner } = h.makeRunner({ fetcher });
      const preview = await h.drive(runner, await h.startRun(id, 'PREVIEW'));
      expect(preview.demotedReason).toBe('NEW_RATIO');
      // 사이트가 그 사이 로그인 벽으로 바뀌었다 — 모든 페이지가 같은 로그인 폼.
      const allLinks = [...existing(20), ...fresh(30)];
      const form = page('로그인이 필요합니다', allLinks);
      fetcher.route(DOCS, html(form));
      for (const p of allLinks) fetcher.route(`${HOST}${p}`, html(form));
      const { runId } = await makeRuns().approveIngest(id, { previewRunId: preview.id } as never, 'admin-1');
      const sync = await h.drive(runner, runId);
      expect(sync.demotedReason).toBe('AUTH_WALL');
      expect(await jobCount(runId)).toBe(0);
      expect((await h.prisma.kbSource.findUniqueOrThrow({ where: { id } })).approvedConfigVersion).toBeNull();
    });

    it('★ (d-1) GONE 문서가 분모를 부풀리지 않는다 — ACTIVE 12 + GONE 20이면 k < 20이라 새 문서 18건이어도 강등하지 않는다', async () => {
      const { id, fetcher } = await seed({ kept: 12, gone: 20, added: 18 });
      const run = await h.drive(h.makeRunner({ fetcher }).runner, await h.startRun(id, 'SYNC'));
      expect(run.demotedReason).toBeNull();
    });

    it('★ (d-2) GONE 문서가 있어도 ACTIVE 기준으로 판정한다 — ACTIVE 20 + GONE 40, 새 문서 15건(75%)은 강등', async () => {
      const { id, fetcher } = await seed({ kept: 20, gone: 40, added: 15 });
      const run = await h.drive(h.makeRunner({ fetcher }).runner, await h.startRun(id, 'SYNC'));
      expect(run.demotedReason).toBe('NEW_RATIO');
    });

    it('회귀 — 모든 문서가 GONE이라도 적재 이력이 있으면 "첫 적재"(대량 레인)로 취급하지 않는다', async () => {
      const { id, fetcher } = await seed({ kept: 0, gone: 3, added: 2 });
      const run = await h.drive(h.makeRunner({ fetcher }).runner, await h.startRun(id, 'SYNC'));
      expect(run.status).toBe('INGESTING');
      const jobs = await h.prisma.kbIngestJob.findMany({ where: { runId: run.id } });
      expect(jobs.length).toBeGreaterThan(0);
      expect(jobs.every((j) => j.lane === 'INCREMENTAL')).toBe(true);
    });
  });

  /* ───────────────────────── U-3 ───────────────────────── */
  describe('U-3 — 적재 게이트 종결에 감사 기록', () => {
    const auditRecord = (): jest.Mock => (h.sourcesService as unknown as { auditLogService: { record: jest.Mock } }).auditLogService.record;
    const auditsOf = (sourceId: string) => auditRecord().mock.calls.map((c) => c[0] as { targetId: string; summary: string; action: string; targetName?: string }).filter((a) => a.targetId === sourceId);

    function makeIngestRunner(cfg: Record<string, unknown>) {
      const rag = makeRag();
      const fetcher = new FakeFetcher().route(`${HOST}/docs/secret-page`, html(page('비공개 본문')));
      const runner = new KbIngestRunner(h.store, h.sourcesService, h.prisma, rag as never, fetcher as never, { get: () => null } as never, makeConfig({ KB_INGEST_POLL_MS: 10, ...cfg }), new InProcessExtractor(), { tryAcquire: () => true } as never);
      return { runner, rag };
    }

    /** OFF 시절 저장된 소스 · INGESTING 실행 · 제출 전 PENDING 작업 2건. */
    async function scenario(sourceOver: Record<string, unknown>) {
      const { id } = await h.createSource(sourceOver);
      const runId = await h.startRun(id, 'SYNC');
      await h.prisma.kbSyncRun.update({ where: { id: runId }, data: { status: 'INGESTING' } });
      const a = await addDoc(h, id, '/docs/secret-page', { seenRunId: runId });
      const b = await addDoc(h, id, '/docs/other-page', { seenRunId: runId });
      await h.store.createIngestJobsBulk([
        { runId, sourceId: id, documentId: a.id, lane: 'INCREMENTAL', reason: 'NEW' },
        { runId, sourceId: id, documentId: b.id, lane: 'INCREMENTAL', reason: 'NEW' },
      ]);
      auditRecord().mockClear();
      return { sourceId: id, runId };
    }

    it('★ 재현 — 적재 차단 종결 시 감사 STATUS_CHANGE `[적재 차단] …` 1건이 남고, 문구에 URL·본문·비밀이 없다', async () => {
      const { sourceId, runId } = await scenario({ piiMask: false });
      const { runner, rag } = makeIngestRunner({ DATA_GOVERNANCE_MODE: 'ON' });
      await runner.runFragment(new Date());
      expect((await h.store.findRun(runId))?.failureCode).toBe('GOVERNANCE_MASK_REQUIRED');
      expect(rag.ingest).not.toHaveBeenCalled();
      const audits = auditsOf(sourceId);
      expect(audits).toHaveLength(1);
      expect(audits[0].action).toBe('STATUS_CHANGE');
      expect(audits[0].summary).toBe('[적재 차단] 거버넌스 모드에서는 개인정보 마스킹을 끌 수 없습니다. 소스를 수정해 마스킹을 켜 주세요.');
      const serialized = JSON.stringify(audits[0]);
      expect(serialized).not.toMatch(/a\.example|secret-page|other-page|비공개 본문|http/);
    });

    it('원본 파일 전달 위반도 사유별 고정 문구로 1건', async () => {
      const { sourceId } = await scenario({ allowRawFileIngest: true, fileTypes: ['PDF'] });
      const { runner } = makeIngestRunner({ DATA_GOVERNANCE_MODE: 'ON' });
      await runner.runFragment(new Date());
      const audits = auditsOf(sourceId);
      expect(audits).toHaveLength(1);
      expect(audits[0].summary).toMatch(/^\[적재 차단\] 거버넌스 모드에서는 서버 설정\(KB_ALLOW_RAW_FILE_INGEST\)/);
    });

    it('★ 중복 없음 — 같은 실행을 tick마다 다시 종결하지 않는다(5회 반복해도 1건)', async () => {
      const { sourceId } = await scenario({ piiMask: false });
      const { runner } = makeIngestRunner({ DATA_GOVERNANCE_MODE: 'ON' });
      for (let i = 0; i < 5; i += 1) await runner.runFragment(new Date());
      expect(auditsOf(sourceId)).toHaveLength(1);
    });

    it('★ 중복 없음 — 두 인스턴스가 동시에 봐도 CAS 승자만 기록한다', async () => {
      const { sourceId } = await scenario({ piiMask: false });
      const one = makeIngestRunner({ DATA_GOVERNANCE_MODE: 'ON' });
      const two = makeIngestRunner({ DATA_GOVERNANCE_MODE: 'ON' });
      await Promise.all([one.runner.runFragment(new Date()), two.runner.runFragment(new Date())]);
      expect(auditsOf(sourceId)).toHaveLength(1);
    });

    it('대조 — 거버넌스 OFF에서는 감사도 종결도 없다', async () => {
      const { sourceId, runId } = await scenario({ piiMask: false });
      const { runner, rag } = makeIngestRunner({});
      await runner.runFragment(new Date());
      expect(rag.ingest).toHaveBeenCalledTimes(1);
      expect(auditsOf(sourceId)).toHaveLength(0);
      expect((await h.store.findRun(runId))?.status).not.toBe('CANCELLED');
    });

    it('대조 — 거버넌스 ON이어도 마스킹을 켠 소스는 감사가 없다', async () => {
      const { sourceId } = await scenario({ piiMask: true });
      const { runner } = makeIngestRunner({ DATA_GOVERNANCE_MODE: 'ON' });
      await runner.runFragment(new Date());
      expect(auditsOf(sourceId)).toHaveLength(0);
    });
  });

  /* ───────────────────────── RG-24 ①③ ───────────────────────── */
  describe('RG-24 ① — 같은 호스트의 다른 포트로 가는 리다이렉트에는 인증 헤더를 싣지 않는다', () => {
    const AUTH = { kind: 'STATIC_HEADER' as const, headerName: 'X-Api-Key', secretRef: 'KB_TEST' };
    const redirect = (location: string, code = 302) => ({ kind: 'REDIRECT' as const, status: code, location, headers: {} });
    // [pass 12 · RG-26] 다른 포트(8443)로 가는 홉은 그 포트가 시작 주소에 명시된 소스에서만 요청이 나간다(명시하지 않으면 범위 밖 — kb-crawl-pass12 시험). 명시된 출처여도 리다이렉트 홉에는 헤더를 싣지 않는다.
    const SEEDS_WITH_8443 = [DOCS, 'https://a.example:8443/docs/'];

    it('★ 크롤 — 다른 포트 홉은 인증 헤더가 없고(요청은 나간다), 같은 호스트(기본 포트 정규화 후) 홉은 유지된다', async () => {
      const { id } = await h.createSource({ auth: AUTH, seedUrls: SEEDS_WITH_8443 });
      const fetcher = okRobots(new FakeFetcher())
        .route(DOCS, html(page('목록', ['/docs/r1', '/docs/r2'])))
        .route(`${HOST}/docs/r1`, redirect('https://a.example:8443/docs/x1'))
        .route('https://a.example:8443/docs/x1', html(page('다른 포트')))
        .route(`${HOST}/docs/r2`, redirect('https://a.example:443/docs/x2')) // 명시된 기본 포트 = 같은 출처
        .route(`${HOST}/docs/x2`, html(page('같은 출처')));
      const { runner } = h.makeRunner({ fetcher, secretResolver: { get: () => 'top-secret' } });
      await h.drive(runner, await h.startRun(id, 'PREVIEW'));
      const req = (url: string) => fetcher.requests.find((r) => r.url === url);
      expect(req(`${HOST}/docs/r1`)?.headers['x-api-key']).toBe('top-secret');
      expect(req('https://a.example:8443/docs/x1')).toBeDefined();
      expect(req('https://a.example:8443/docs/x1')?.headers['x-api-key']).toBeUndefined();
      expect(req(`${HOST}/docs/x2`)?.headers['x-api-key']).toBe('top-secret');
    });

    it('★ 적재 재수집 — 다른 포트 홉은 인증 헤더가 없다', async () => {
      const { id } = await h.createSource({ auth: AUTH, seedUrls: SEEDS_WITH_8443 });
      const runId = await h.startRun(id, 'SYNC');
      await h.prisma.kbSyncRun.update({ where: { id: runId }, data: { status: 'INGESTING' } });
      const doc = await addDoc(h, id, '/docs/r1', { seenRunId: runId });
      await h.store.createIngestJobsBulk([{ runId, sourceId: id, documentId: doc.id, lane: 'INCREMENTAL', reason: 'NEW' }]);
      const fetcher = new FakeFetcher().route(`${HOST}/docs/r1`, redirect('https://a.example:8443/docs/x1')).route('https://a.example:8443/docs/x1', html(page('다른 포트')));
      const rag = makeRag();
      const runner = new KbIngestRunner(h.store, h.sourcesService, h.prisma, rag as never, fetcher as never, { get: () => 'top-secret' } as never, makeConfig({ KB_INGEST_POLL_MS: 10 }), new InProcessExtractor(), { tryAcquire: () => true } as never);
      await runner.runFragment(new Date());
      expect(fetcher.requests[0].headers['x-api-key']).toBe('top-secret');
      expect(fetcher.requests[1].url).toBe('https://a.example:8443/docs/x1');
      expect(fetcher.requests[1].headers['x-api-key']).toBeUndefined();
    });

    it('대조 — 적재 재수집에서 같은 출처(기본 포트) 홉은 헤더를 유지한다', async () => {
      const { id } = await h.createSource({ auth: AUTH });
      const runId = await h.startRun(id, 'SYNC');
      await h.prisma.kbSyncRun.update({ where: { id: runId }, data: { status: 'INGESTING' } });
      const doc = await addDoc(h, id, '/docs/r1', { seenRunId: runId });
      await h.store.createIngestJobsBulk([{ runId, sourceId: id, documentId: doc.id, lane: 'INCREMENTAL', reason: 'NEW' }]);
      const fetcher = new FakeFetcher().route(`${HOST}/docs/r1`, redirect('/docs/x1/')).route(`${HOST}/docs/x1/`, html(page('같은 출처')));
      const runner = new KbIngestRunner(h.store, h.sourcesService, h.prisma, makeRag() as never, fetcher as never, { get: () => 'top-secret' } as never, makeConfig({ KB_INGEST_POLL_MS: 10 }), new InProcessExtractor(), { tryAcquire: () => true } as never);
      await runner.runFragment(new Date());
      expect(fetcher.requests[1].headers['x-api-key']).toBe('top-secret');
    });
  });

  describe('RG-24 ③ — 적재 재수집 타임아웃은 홉 URL마다 정한다(파일이면 ×4)', () => {
    const redirect = (location: string) => ({ kind: 'REDIRECT' as const, status: 302, location, headers: {} });

    async function refetchTimeouts(docPath: string, docKind: 'HTML' | 'PDF', routes: Array<[string, ReturnType<typeof redirect> | ReturnType<typeof html>]>, cfg: Record<string, unknown> = {}): Promise<Array<number | undefined>> {
      const { id } = await h.createSource({ fileTypes: ['PDF'], allowRawFileIngest: true });
      const runId = await h.startRun(id, 'SYNC');
      await h.prisma.kbSyncRun.update({ where: { id: runId }, data: { status: 'INGESTING' } });
      const doc = await addDoc(h, id, docPath, { seenRunId: runId, kind: docKind });
      await h.store.createIngestJobsBulk([{ runId, sourceId: id, documentId: doc.id, lane: 'INCREMENTAL', reason: 'NEW' }]);
      const fetcher = new FakeFetcher();
      for (const [url, r] of routes) fetcher.route(url, r);
      const runner = new KbIngestRunner(h.store, h.sourcesService, h.prisma, makeRag() as never, fetcher as never, { get: () => null } as never, makeConfig({ KB_INGEST_POLL_MS: 10, KB_CRAWL_TIMEOUT_MS: 10_000, ...cfg }), new InProcessExtractor(), { tryAcquire: () => true } as never);
      await runner.runFragment(new Date());
      return fetcher.requests.map((r) => r.timeoutMs);
    }

    it('★ HTML 문서가 PDF로 리다이렉트되면 첫 홉은 ×1, PDF 홉은 ×4', async () => {
      const t = await refetchTimeouts('/docs/a', 'HTML', [
        [`${HOST}/docs/a`, redirect('/docs/file.pdf')],
        [`${HOST}/docs/file.pdf`, html('%PDF-1.4')],
      ]);
      expect(t).toEqual([10_000, 40_000]);
    });

    it('★ PDF 문서가 HTML로 리다이렉트되면 첫 홉은 ×4, HTML 홉은 ×1', async () => {
      const t = await refetchTimeouts('/docs/file.pdf', 'PDF', [
        [`${HOST}/docs/file.pdf`, redirect('/docs/page')],
        [`${HOST}/docs/page`, html(page('페이지'))],
      ]);
      expect(t).toEqual([40_000, 10_000]);
    });

    it('회귀 — 리다이렉트 없는 HTML은 ×1, PDF는 ×4', async () => {
      expect(await refetchTimeouts('/docs/a', 'HTML', [[`${HOST}/docs/a`, html(page('A'))]])).toEqual([10_000]);
      expect(await refetchTimeouts('/docs/f.pdf', 'PDF', [[`${HOST}/docs/f.pdf`, html('%PDF-1.4')]])).toEqual([40_000]);
    });
  });
});
