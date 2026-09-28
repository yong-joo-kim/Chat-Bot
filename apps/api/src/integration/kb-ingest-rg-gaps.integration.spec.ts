import { Logger } from '@nestjs/common';
import { KbIngestRunner } from '../kb-sync/engine/kb-ingest.runner';
import { KbRunsService } from '../kb-sync/kb-runs.service';
import { InProcessExtractor } from '../kb-sync/extract/in-process.extractor';
import type { KbExtractRequest, KbExtractResult, KbExtractorPort } from '../kb-sync/extract/kb-extractor.port';
import { buildExternalFileName, urlHash } from '../kb-sync/lib/external-file-name';
import { FakeFetcher, HOST, ROBOTS_OK, createHarness, html, makeConfig, page } from './helpers/kb-crawl-db-harness';
import type { Harness } from './helpers/kb-crawl-db-harness';

/**
 * 지식베이스 크롤링(No.43) 백엔드 pass 5 — 저장소·적재 단계·종결 원자성 잔여 갭(RG-5·6·8·12)의 재현 시험.
 */
const DOCS = `${HOST}/docs/`;

async function addDoc(h: Harness, sourceId: string, path: string, over: Record<string, unknown> = {}) {
  const url = `${HOST}${path}`;
  const kind = (over.kind as string | undefined) ?? 'HTML';
  const ext = kind === 'PDF' ? 'pdf' : kind === 'HTML' ? 'html' : (kind.toLowerCase() as 'docx');
  return h.prisma.kbDocument.create({
    data: { sourceId, url, urlHash: urlHash(url), kind, externalFileName: buildExternalFileName(sourceId, url, ext), seenRunId: 'old-run', visitState: 'VISITED', ...over },
  });
}

function makeRag() {
  return {
    isConfigured: () => true,
    status: jest.fn(async () => ({ networkError: false, httpStatus: 200, body: { vllm_ready: true } })),
    ingest: jest.fn(async () => ({ networkError: false, httpStatus: 200, body: { result: 'RAG Vector DB 추가 성공.' } })),
    taskStatus: jest.fn(),
  };
}

describe('KB 잔여 갭(RG) — 저장소·적재·종결 원자성', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await createHarness('rg-ingest');
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
    jest.restoreAllMocks();
    await resetKbState();
  });

  function makeIngestRunner(opts: { fetcher: FakeFetcher; rag?: ReturnType<typeof makeRag>; extractor?: KbExtractorPort; cfg?: Record<string, unknown> }) {
    const rag = opts.rag ?? makeRag();
    const runner = new KbIngestRunner(
      h.store,
      h.sourcesService,
      h.prisma,
      rag as never,
      opts.fetcher as never,
      { get: () => null } as never,
      makeConfig({ KB_INGEST_POLL_MS: 10, ...(opts.cfg ?? {}) }),
      opts.extractor ?? new InProcessExtractor(),
      { tryAcquire: () => true } as never,
    );
    return { runner, rag };
  }

  /** 소스·실행(INGESTING)·문서·적재 작업(PENDING)을 직접 만든다. */
  async function pendingJob(docOver: Record<string, unknown>, path: string, sourceOver: Record<string, unknown> = {}) {
    const { id } = await h.createSource(sourceOver);
    const runId = await h.startRun(id, 'SYNC');
    await h.prisma.kbSyncRun.update({ where: { id: runId }, data: { status: 'INGESTING' } });
    const doc = await addDoc(h, id, path, { seenRunId: runId, ...docOver });
    await h.store.createIngestJobsBulk([{ runId, sourceId: id, documentId: doc.id, lane: 'INCREMENTAL', reason: 'CHANGED' }]);
    const job = await h.prisma.kbIngestJob.findFirstOrThrow({ where: { runId } });
    return { sourceId: id, runId, doc, job };
  }

  /* ───────────────────────── RG-6 ───────────────────────── */
  describe('RG-6 — 축소 감지(SHRUNK)', () => {
    async function succeedWith(prev: Record<string, unknown>, jobMeta: { textLength: number; byteSize: number; fileKind: string }) {
      const { id } = await h.createSource();
      const runId = await h.startRun(id, 'SYNC');
      const doc = await addDoc(h, id, `/docs/s-${Math.random().toString(36).slice(2)}`, { ...prev });
      await h.store.createIngestJobsBulk([{ runId, sourceId: id, documentId: doc.id, lane: 'INCREMENTAL', reason: 'CHANGED' }]);
      const job = await h.prisma.kbIngestJob.findFirstOrThrow({ where: { documentId: doc.id } });
      await h.prisma.kbIngestJob.update({ where: { id: job.id }, data: { status: 'SUBMITTED', contentHash: 'new', ingestFingerprint: 'nf', externalFileName: doc.externalFileName, ...jobMeta } });
      expect(await h.store.succeedJob(job.id, 'SUBMITTED', new Date())).toBe(true);
      return h.prisma.kbDocument.findUniqueOrThrow({ where: { id: doc.id } });
    }
    const past = () => new Date(Date.now() - 86_400_000);

    it('★ 이전에 적재됐고 본문이 절반 미만으로 줄면 적재하되 cleanupReason = SHRUNK', async () => {
      const doc = await succeedWith({ lastIngestedAt: past(), textLength: 1000, contentHash: 'old' }, { textLength: 400, byteSize: 9000, fileKind: 'HTML' });
      expect(doc.cleanupReason).toBe('SHRUNK');
      expect(doc.textLength).toBe(400); // 적재는 정상 반영됐다.
      expect(doc.contentHash).toBe('new');
    });

    it('절반 이상이면 SHRUNK가 아니다(경계 — 정확히 50%는 축소 아님)', async () => {
      expect((await succeedWith({ lastIngestedAt: past(), textLength: 1000, contentHash: 'old' }, { textLength: 500, byteSize: 9000, fileKind: 'HTML' })).cleanupReason).toBeNull();
      expect((await succeedWith({ lastIngestedAt: past(), textLength: 1000, contentHash: 'old' }, { textLength: 800, byteSize: 9000, fileKind: 'HTML' })).cleanupReason).toBeNull();
    });

    it('★ 파일은 byteSize로 판정한다(HTML의 변환 문서 크기·textLength 0은 판정에 쓰지 않는다)', async () => {
      expect((await succeedWith({ lastIngestedAt: past(), byteSize: 10_000, textLength: 0, contentHash: 'old', kind: 'PDF' }, { textLength: 0, byteSize: 4000, fileKind: 'PDF' })).cleanupReason).toBe('SHRUNK');
      expect((await succeedWith({ lastIngestedAt: past(), byteSize: 10_000, textLength: 0, contentHash: 'old', kind: 'PDF' }, { textLength: 0, byteSize: 6000, fileKind: 'PDF' })).cleanupReason).toBeNull();
      // HTML은 변환 문서 바이트가 절반 밑이어도 본문 길이가 유지되면 축소가 아니다.
      expect((await succeedWith({ lastIngestedAt: past(), byteSize: 30_000, textLength: 1000, contentHash: 'old' }, { textLength: 900, byteSize: 5000, fileKind: 'HTML' })).cleanupReason).toBeNull();
    });

    it('처음 적재하는 문서(lastIngestedAt 없음)는 SHRUNK가 아니다', async () => {
      expect((await succeedWith({ textLength: 1000 }, { textLength: 10, byteSize: 100, fileKind: 'HTML' })).cleanupReason).toBeNull();
    });

    it('이미 다른 정리 사유가 있으면 보존한다', async () => {
      const doc = await succeedWith({ lastIngestedAt: past(), textLength: 1000, contentHash: 'old', cleanupReason: 'SCOPE_CHANGED' }, { textLength: 100, byteSize: 100, fileKind: 'HTML' });
      expect(doc.cleanupReason).toBe('SCOPE_CHANGED');
    });

    it('★ 끝에서 끝까지 — 짧아진 페이지를 크롤(SYNC) → 적재하면 문서가 SHRUNK가 된다(AC-KB3-5)', async () => {
      const { id } = await h.createSource();
      const doc = await addDoc(h, id, '/docs/', { lastIngestedAt: past(), textLength: 5000, contentHash: 'old', ingestFingerprint: 'old' });
      const fetcher = new FakeFetcher().route(`${HOST}/robots.txt`, ROBOTS_OK).route(DOCS, html(page('짧아진 문서')));
      const { runner: crawler } = h.makeRunner({ fetcher });
      const runId = await h.startRun(id, 'SYNC');
      const run = await h.drive(crawler, runId);
      expect(run.status).toBe('INGESTING');

      const { runner: ingest, rag } = makeIngestRunner({ fetcher });
      for (let i = 0; i < 5; i += 1) await ingest.runFragment(new Date());
      expect(rag.ingest).toHaveBeenCalledTimes(1);
      const after = await h.prisma.kbDocument.findUniqueOrThrow({ where: { id: doc.id } });
      expect(after.cleanupReason).toBe('SHRUNK');
      expect(after.lastIngestJobId).not.toBeNull();
      expect((await h.store.findRun(runId))?.status).toBe('SUCCEEDED');
    });
  });

  /* ───────────────────────── RG-8 · RG-12 (적재 단계) ───────────────────────── */
  describe('적재 단계 재수집 뒤 검사', () => {
    class FileExtractor implements KbExtractorPort {
      constructor(private readonly result: KbExtractResult | 'THROW') {}
      readonly seen: KbExtractRequest[] = [];
      async extract(req: KbExtractRequest): Promise<KbExtractResult> {
        this.seen.push(req);
        if (req.kind === 'HTML') return new InProcessExtractor().extract(req);
        if (this.result === 'THROW') throw new Error('FILE_UNSAFE_TIMEOUT');
        return this.result;
      }
    }
    const pdfFetcher = () => new FakeFetcher().route(`${HOST}/docs/f.pdf`, { kind: 'RESPONSE', status: 200, contentType: 'application/pdf', body: Buffer.from('%PDF-1.4 content'), headers: {} });
    const resultOk = (piiMaskedCount: number): KbExtractResult => ({ ok: true, normalizedText: '본문', text: '본문', piiMaskedCount, flags: [] });

    it('★ RG-8: 재수집한 파일이 검사에서 걸리면(ok=false) 외부로 보내지 않고 SKIPPED(EXCLUDED_AT_INGEST)', async () => {
      const { job } = await pendingJob({ kind: 'PDF' }, '/docs/f.pdf', { allowRawFileIngest: true });
      const { runner, rag } = makeIngestRunner({ fetcher: pdfFetcher(), extractor: new FileExtractor({ ok: false, normalizedText: '', text: '', piiMaskedCount: 0, flags: ['FILE_UNSAFE'] }) });
      await runner.runFragment(new Date());
      expect(rag.ingest).not.toHaveBeenCalled();
      const after = await h.prisma.kbIngestJob.findUniqueOrThrow({ where: { id: job.id } });
      expect(after.status).toBe('SKIPPED');
      expect(after.resultCode).toBe('EXCLUDED_AT_INGEST');
    });

    it('★ RG-8: 거버넌스 ON + 개인정보 1건 이상이면 전송하지 않는다(내용이 크롤 뒤 바뀐 경우)', async () => {
      const { job } = await pendingJob({ kind: 'PDF' }, '/docs/f.pdf', { allowRawFileIngest: true });
      const { runner, rag } = makeIngestRunner({ fetcher: pdfFetcher(), extractor: new FileExtractor(resultOk(1)), cfg: { DATA_GOVERNANCE_MODE: 'ON', KB_ALLOW_RAW_FILE_INGEST: true } });
      await runner.runFragment(new Date());
      expect(rag.ingest).not.toHaveBeenCalled();
      expect((await h.prisma.kbIngestJob.findUniqueOrThrow({ where: { id: job.id } })).resultCode).toBe('EXCLUDED_AT_INGEST');
    });

    it('RG-8: 추출 예외(시간 초과)는 그 작업만 SKIPPED(EXCLUDED_AT_INGEST)', async () => {
      const { job } = await pendingJob({ kind: 'PDF' }, '/docs/f.pdf', { allowRawFileIngest: true });
      const { runner, rag } = makeIngestRunner({ fetcher: pdfFetcher(), extractor: new FileExtractor('THROW') });
      await runner.runFragment(new Date());
      expect(rag.ingest).not.toHaveBeenCalled();
      expect((await h.prisma.kbIngestJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe('SKIPPED');
    });

    it('RG-8: 검사를 통과한 파일은 원본 바이트 그대로 보내고 개인정보 건수를 작업에 남긴다', async () => {
      const { job } = await pendingJob({ kind: 'PDF' }, '/docs/f.pdf', { allowRawFileIngest: true });
      const { runner, rag } = makeIngestRunner({ fetcher: pdfFetcher(), extractor: new FileExtractor(resultOk(2)) });
      await runner.runFragment(new Date());
      expect(rag.ingest).toHaveBeenCalledTimes(1);
      const sent = (rag.ingest.mock.calls[0] as unknown as [{ file: { bytes: Uint8Array } }])[0].file.bytes;
      expect(Buffer.from(sent).toString()).toBe('%PDF-1.4 content');
      expect((await h.prisma.kbIngestJob.findUniqueOrThrow({ where: { id: job.id } })).piiMaskedCount).toBe(2);
    });

    it.each([
      ['메타 noindex', '<html><head><meta name="robots" content="noindex"></head><body><main><h1>제목</h1><p>' + '본문 '.repeat(80) + '</p></main></body></html>', {}],
      ['X-Robots-Tag noindex', page('제목'), { 'x-robots-tag': 'noindex' }],
    ])('★ RG-12: 재수집한 HTML이 %s면 외부로 보내지 않고 SKIPPED(EXCLUDED_AT_INGEST)', async (_l, body, headers) => {
      const { job } = await pendingJob({}, '/docs/n');
      const fetcher = new FakeFetcher().route(`${HOST}/docs/n`, html(body, headers));
      const { runner, rag } = makeIngestRunner({ fetcher });
      await runner.runFragment(new Date());
      expect(rag.ingest).not.toHaveBeenCalled();
      const after = await h.prisma.kbIngestJob.findUniqueOrThrow({ where: { id: job.id } });
      expect(after.status).toBe('SKIPPED');
      expect(after.resultCode).toBe('EXCLUDED_AT_INGEST');
    });

    it('RG-12 대조: noindex가 아니면 정상 적재한다', async () => {
      await pendingJob({}, '/docs/ok');
      const fetcher = new FakeFetcher().route(`${HOST}/docs/ok`, html(page('정상')));
      const { runner, rag } = makeIngestRunner({ fetcher });
      await runner.runFragment(new Date());
      expect(rag.ingest).toHaveBeenCalledTimes(1);
    });
  });

  /* ───────────────────────── RG-5 ───────────────────────── */
  describe('RG-5 — 종결과 소스 선점 해제는 원자적이고, 어긋난 상태는 자가 치유된다', () => {
    /** 불변식: 실행이 종단 상태면 소스의 activeRunId는 그 실행을 가리키지 않는다. */
    async function assertConsistent(sourceId: string, runId: string): Promise<{ terminal: boolean }> {
      const run = await h.store.findRun(runId);
      const source = await h.prisma.kbSource.findUniqueOrThrow({ where: { id: sourceId } });
      const terminal = !!run && !['QUEUED', 'CRAWLING', 'INGESTING'].includes(run.status);
      if (terminal) expect(source.activeRunId).not.toBe(runId);
      return { terminal };
    }

    it('★ 크롤 종결 직후 소스 해제가 실패해도(크래시) 실행만 종단 상태로 남지 않는다 — 함께 롤백되고 다음 조각이 다시 끝낸다', async () => {
      jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      const { id } = await h.createSource();
      const { runner } = h.makeRunner({ fetcher: new FakeFetcher().route(`${HOST}/robots.txt`, ROBOTS_OK).route(DOCS, html(page('목록'))) });
      const runId = await h.startRun(id, 'PREVIEW');
      const spy = jest.spyOn(h.sourcesService, 'releaseActiveRun').mockRejectedValueOnce(new Error('프로세스 크래시(시뮬레이션)'));

      await h.fragment(runner, runId);
      expect(spy).toHaveBeenCalled();
      const first = await assertConsistent(id, runId);
      expect(first.terminal).toBe(false); // 롤백 — 아직 CRAWLING이다.

      await h.drive(runner, runId);
      expect((await assertConsistent(id, runId)).terminal).toBe(true);
      expect((await h.prisma.kbSource.findUniqueOrThrow({ where: { id } })).activeRunId).toBeNull();
    });

    it('★ 중지 처리 중 소스 해제가 실패해도 실행이 CANCELLED로만 남지 않는다', async () => {
      const runs = new KbRunsService(h.prisma, h.config, h.store, h.sourcesService, { record: jest.fn() } as never, { isConfigured: () => true } as never);
      const { id } = await h.createSource();
      const runId = await h.startRun(id, 'SYNC');
      jest.spyOn(h.sourcesService, 'releaseActiveRun').mockRejectedValueOnce(new Error('크래시(시뮬레이션)'));
      await expect(runs.cancelRun(id, runId, 'u1')).rejects.toThrow();
      expect((await assertConsistent(id, runId)).terminal).toBe(false);

      await runs.cancelRun(id, runId, 'u1'); // 재시도하면 정상 종결된다.
      expect((await assertConsistent(id, runId)).terminal).toBe(true);
    });

    it('★ 자가 치유 — 실행은 종단인데 activeRunId가 남았으면 스케줄러 tick이 풀어 준다', async () => {
      const { id } = await h.createSource();
      const runId = await h.startRun(id, 'SYNC');
      const finishedAt = new Date(Date.now() - 60_000);
      await h.prisma.kbSyncRun.update({ where: { id: runId }, data: { status: 'SUCCEEDED', finishedAt, claimToken: null } });
      expect((await h.prisma.kbSource.findUniqueOrThrow({ where: { id } })).activeRunId).toBe(runId); // 어긋난 상태(크래시 흔적).

      await h.scheduler.scheduleDueSources(new Date(), 10);

      const source = await h.prisma.kbSource.findUniqueOrThrow({ where: { id } });
      expect(source.activeRunId).toBeNull();
      expect(source.lastRunId).toBe(runId);
      expect(source.lastRunStatus).toBe('SUCCEEDED');
      expect(source.lastRunFinishedAt?.getTime()).toBe(finishedAt.getTime());
    });

    it('자가 치유 — 가리키는 실행이 아예 없어도(부재) 풀어 준다', async () => {
      const { id } = await h.createSource();
      await h.prisma.kbSource.update({ where: { id }, data: { activeRunId: 'no-such-run' } });
      await h.scheduler.scheduleDueSources(new Date(), 10);
      const source = await h.prisma.kbSource.findUniqueOrThrow({ where: { id } });
      expect(source.activeRunId).toBeNull();
      expect(source.lastRunStatus).toBe('FAILED');
    });

    it.each(['QUEUED', 'CRAWLING', 'INGESTING'])('자가 치유는 진행 중(%s)인 실행을 건드리지 않는다', async (st) => {
      const { id } = await h.createSource();
      const runId = await h.startRun(id, 'SYNC');
      await h.prisma.kbSyncRun.update({ where: { id: runId }, data: { status: st } });
      await h.scheduler.scheduleDueSources(new Date(), 10);
      expect((await h.prisma.kbSource.findUniqueOrThrow({ where: { id } })).activeRunId).toBe(runId);
    });

    it('★ FULL_RESEND 정리 확인(acknowledgeCleanup)은 선점에 성공했을 때만 반영된다(선점 실패 시 GONE 문서를 지우지 않는다)', async () => {
      const runs = new KbRunsService(h.prisma, h.config, h.store, h.sourcesService, { record: jest.fn() } as never, { isConfigured: () => true } as never);
      const { id } = await h.createSource();
      const gone = await addDoc(h, id, '/docs/gone', { state: 'GONE', cleanupReason: 'GONE', lastIngestedAt: new Date() });
      jest.spyOn(h.sourcesService, 'claimAndCreateRun').mockResolvedValueOnce(null); // 다른 요청이 먼저 선점(경합).
      await expect(runs.createRun(id, { kind: 'FULL_RESEND', acknowledgeCleanup: true }, 'u1')).rejects.toThrow();
      expect(await h.prisma.kbDocument.findUnique({ where: { id: gone.id } })).not.toBeNull();
    });

    it('FULL_RESEND 정리 확인이 선점과 같은 트랜잭션에서 GONE 문서를 지우고 정리 표시를 푼다', async () => {
      const runs = new KbRunsService(h.prisma, h.config, h.store, h.sourcesService, { record: jest.fn() } as never, { isConfigured: () => true } as never);
      const { id } = await h.createSource();
      const gone = await addDoc(h, id, '/docs/gone2', { state: 'GONE', cleanupReason: 'GONE', lastIngestedAt: new Date() });
      const shrunk = await addDoc(h, id, '/docs/shrunk', { cleanupReason: 'SHRUNK', lastIngestedAt: new Date() });
      await runs.createRun(id, { kind: 'FULL_RESEND', acknowledgeCleanup: true }, 'u1');
      expect(await h.prisma.kbDocument.findUnique({ where: { id: gone.id } })).toBeNull();
      expect((await h.prisma.kbDocument.findUniqueOrThrow({ where: { id: shrunk.id } })).cleanupReason).toBeNull();
    });
  });
});
