import { KbIngestRunner } from '../kb-sync/engine/kb-ingest.runner';
import { InProcessExtractor } from '../kb-sync/extract/in-process.extractor';
import type { KbExtractorPort } from '../kb-sync/extract/kb-extractor.port';
import type { KbFetchResult } from '../kb-sync/crawl/kb-crawl-http.fetcher';
import { buildExternalFileName, urlHash } from '../kb-sync/lib/external-file-name';
import { FakeFetcher, HOST, createHarness, html, makeConfig, page } from './helpers/kb-crawl-db-harness';
import type { Harness } from './helpers/kb-crawl-db-harness';

/**
 * 지식베이스 크롤링(No.43) 백엔드 pass 7 — R4 리뷰의 적재 단계 재현 시험(N-6 적재 분기 · N-8 · N-9 · N-10 슬롯 임대).
 */
const redirect = (location: string, code = 301): KbFetchResult => ({ kind: 'REDIRECT', status: code, location, headers: {} });
const pdf = (bytes: Buffer = Buffer.from('%PDF-1.4 x')): KbFetchResult => ({ kind: 'RESPONSE', status: 200, contentType: 'application/pdf', body: bytes, headers: {} });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

function fileExtractor(over: { truncated?: boolean } = {}): KbExtractorPort {
  return {
    async extract(req) {
      if (req.kind === 'HTML') return new InProcessExtractor().extract(req);
      return { ok: true, normalizedText: '본문', text: '본문', piiMaskedCount: 0, truncated: over.truncated, flags: [] };
    },
  };
}

describe('KB pass 7 — 적재 단계', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await createHarness('pass7-ingest');
  }, 60_000);

  afterAll(async () => {
    await h?.dispose();
  }, 15_000);

  afterEach(async () => {
    jest.restoreAllMocks();
    await h.prisma.kbSyncRun.updateMany({ where: { status: { in: ['QUEUED', 'CRAWLING', 'INGESTING'] } }, data: { status: 'CANCELLED', finishedAt: new Date(), claimToken: null } });
    await h.prisma.kbSource.updateMany({ data: { activeRunId: null } });
    await h.prisma.kbIngestJob.deleteMany({});
    await h.prisma.kbJobLease.updateMany({ data: { claimToken: null, claimedAt: null, holderJobId: null } }); // 비동기 접수(SUBMITTED)한 시험이 쥔 슬롯을 놓는다.
    await h.prisma.kbDocument.deleteMany({});
    await h.prisma.kbSource.deleteMany({});
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

  /** 소스·실행(지정 상태)·문서·적재 작업(PENDING)을 직접 만든다. */
  async function pendingJob(docOver: Record<string, unknown>, path: string, sourceOver: Record<string, unknown> = {}, opts: { runStatus?: string } = {}) {
    const { id } = await h.createSource(sourceOver);
    const runId = await h.startRun(id, 'SYNC');
    await h.prisma.kbSyncRun.update({ where: { id: runId }, data: { status: opts.runStatus ?? 'INGESTING' } });
    const doc = await addDoc(h, id, path, { seenRunId: runId, ...docOver });
    await h.store.createIngestJobsBulk([{ runId, sourceId: id, documentId: doc.id, lane: 'INCREMENTAL', reason: 'CHANGED' }]);
    const job = await h.prisma.kbIngestJob.findFirstOrThrow({ where: { runId } });
    return { sourceId: id, runId, doc, job };
  }

  /* ───────────────────────── N-8 ───────────────────────── */
  describe('N-8 — 크롤 종결 창의 PENDING 작업이 다른 실행의 적재를 막지 않는다', () => {
    it('★ 리뷰어 재현 — 실행 A(CRAWLING · 작업이 더 오래됨) 뒤에 실행 B(INGESTING)의 작업이 있어도 B의 작업이 제출된다', async () => {
      const a = await pendingJob({}, '/docs/a', {}, { runStatus: 'CRAWLING' });
      await sleep(5);
      const b = await pendingJob({}, '/docs/b', {}, { runStatus: 'INGESTING' });
      const fetcher = new FakeFetcher().route(`${HOST}/docs/a`, html(page('A'))).route(`${HOST}/docs/b`, html(page('B')));
      const { runner, rag } = makeIngestRunner({ fetcher });
      await runner.runFragment(new Date());

      expect(rag.ingest).toHaveBeenCalledTimes(1);
      expect((await h.prisma.kbIngestJob.findUniqueOrThrow({ where: { id: b.job.id } })).status).not.toBe('PENDING');
      expect((await h.prisma.kbIngestJob.findUniqueOrThrow({ where: { id: a.job.id } })).status).toBe('PENDING'); // A는 건드리지 않는다(취소도 제출도 아님).
      expect(fetcher.urls()).toEqual([`${HOST}/docs/b`]);
    });

    it('QUEUED 실행의 작업도 후보가 아니다(대기)', async () => {
      await pendingJob({}, '/docs/q', {}, { runStatus: 'QUEUED' });
      const b = await pendingJob({}, '/docs/b2', {}, { runStatus: 'INGESTING' });
      const fetcher = new FakeFetcher().route(`${HOST}/docs/q`, html(page('Q'))).route(`${HOST}/docs/b2`, html(page('B')));
      const { runner, rag } = makeIngestRunner({ fetcher });
      await runner.runFragment(new Date());
      expect(rag.ingest).toHaveBeenCalledTimes(1);
      expect(fetcher.urls()).toEqual([`${HOST}/docs/b2`]);
      expect(b.job.id).toBeTruthy();
    });

    it('★ 시작 순서는 지킨다 — INGESTING 실행끼리는 먼저 만든 작업이 먼저 제출되고, 슬롯은 하나라 한 번에 하나다', async () => {
      const first = await pendingJob({}, '/docs/first', {}, { runStatus: 'INGESTING' });
      await sleep(5);
      const second = await pendingJob({}, '/docs/second', {}, { runStatus: 'INGESTING' });
      const rag = makeRag();
      rag.ingest = jest.fn(async () => ({ networkError: false, httpStatus: 200, body: { status: 'async_started', task_id: '11111111-1111-4111-8111-111111111111' } })) as never;
      const fetcher = new FakeFetcher().route(`${HOST}/docs/first`, html(page('F'))).route(`${HOST}/docs/second`, html(page('S')));
      const { runner } = makeIngestRunner({ fetcher, rag });
      await runner.runFragment(new Date());
      expect(fetcher.urls()[0]).toBe(`${HOST}/docs/first`);
      expect((await h.prisma.kbIngestJob.findUniqueOrThrow({ where: { id: second.job.id } })).status).toBe('PENDING'); // 슬롯 직렬 — 첫 작업이 슬롯을 쥔다
      expect(first.job.id).toBeTruthy();
    });

    it('종단(CANCELLED) 실행의 고아 작업은 여전히 후보로 골라 정리한다(RG-19 불변)', async () => {
      const orphan = await pendingJob({}, '/docs/orphan', {}, { runStatus: 'CANCELLED' });
      const { runner, rag } = makeIngestRunner({ fetcher: new FakeFetcher() });
      await runner.runFragment(new Date());
      expect(rag.ingest).not.toHaveBeenCalled();
      expect((await h.prisma.kbIngestJob.findUniqueOrThrow({ where: { id: orphan.job.id } })).status).toBe('CANCELLED');
    });
  });

  /* ───────────────────────── N-10 ───────────────────────── */
  describe('N-10 — 재수집 리다이렉트 홉 사이에도 슬롯 임대를 갱신한다', () => {
    it('★ 3홉 리다이렉트 재수집은 홉마다(2·3번째 요청 직전) 슬롯 임대를 갱신한다 — 기본 2회(재수집 전·전송 전) + 홉 2회', async () => {
      await pendingJob({}, '/docs/a');
      const fetcher = new FakeFetcher().route(`${HOST}/docs/a`, redirect('/docs/b')).route(`${HOST}/docs/b`, redirect('/docs/c')).route(`${HOST}/docs/c`, html(page('C')));
      const spy = jest.spyOn(h.store, 'renewSlot');
      const { runner, rag } = makeIngestRunner({ fetcher });
      await runner.runFragment(new Date());
      expect(rag.ingest).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls.length).toBeGreaterThanOrEqual(4);
    });
  });

  /* ───────────────────────── N-6 (적재 분기) ───────────────────────── */
  describe('N-6 — 재수집 결과의 종류가 문서 종류와 다르면 잘못 해석해 보내지 않고 제외한다', () => {
    it('★ HTML 문서가 재수집 때 PDF로 리다이렉트되면 SKIPPED(EXCLUDED_AT_INGEST) — PDF 바이트를 HTML로 해석해 보내지 않는다', async () => {
      const { job } = await pendingJob({}, '/docs/dl', { allowRawFileIngest: true });
      const fetcher = new FakeFetcher().route(`${HOST}/docs/dl`, redirect('/docs/files/x.pdf')).route(`${HOST}/docs/files/x.pdf`, pdf());
      const { runner, rag } = makeIngestRunner({ fetcher, extractor: fileExtractor() });
      await runner.runFragment(new Date());
      expect(rag.ingest).not.toHaveBeenCalled();
      const after = await h.prisma.kbIngestJob.findUniqueOrThrow({ where: { id: job.id } });
      expect(after.status).toBe('SKIPPED');
      expect(after.resultCode).toBe('EXCLUDED_AT_INGEST');
    });

    it('★ PDF 문서가 재수집 때 HTML로 리다이렉트되면 SKIPPED(EXCLUDED_AT_INGEST) — 원본 파일 전달 설정과 무관하게 종류 불일치는 보내지 않는다', async () => {
      const { job } = await pendingJob({ kind: 'PDF' }, '/docs/a.pdf', { allowRawFileIngest: true });
      const fetcher = new FakeFetcher().route(`${HOST}/docs/a.pdf`, redirect('/docs/page')).route(`${HOST}/docs/page`, html(page('페이지')));
      const { runner, rag } = makeIngestRunner({ fetcher, extractor: fileExtractor() });
      await runner.runFragment(new Date());
      expect(rag.ingest).not.toHaveBeenCalled();
      expect((await h.prisma.kbIngestJob.findUniqueOrThrow({ where: { id: job.id } })).resultCode).toBe('EXCLUDED_AT_INGEST');
    });

    it('대조: 같은 종류로 리다이렉트되면(HTML → HTML) 정상 적재한다', async () => {
      const { job } = await pendingJob({}, '/docs/a');
      const fetcher = new FakeFetcher().route(`${HOST}/docs/a`, redirect('/docs/a/')).route(`${HOST}/docs/a/`, html(page('A 폴더')));
      const { runner, rag } = makeIngestRunner({ fetcher });
      await runner.runFragment(new Date());
      expect(rag.ingest).toHaveBeenCalledTimes(1);
      expect((await h.prisma.kbIngestJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe('SUCCEEDED');
    });
  });

  /* ───────────────────────── N-9 (적재 분기) ───────────────────────── */
  describe('N-9 — 재수집한 PDF가 잘렸으면(truncated) 거버넌스 ON에서는 전송하지 않는다', () => {
    it('★ 거버넌스 ON + truncated → SKIPPED(EXCLUDED_AT_INGEST)', async () => {
      const { job } = await pendingJob({ kind: 'PDF' }, '/docs/f.pdf', { allowRawFileIngest: true });
      const fetcher = new FakeFetcher().route(`${HOST}/docs/f.pdf`, pdf());
      const { runner, rag } = makeIngestRunner({ fetcher, extractor: fileExtractor({ truncated: true }), cfg: { DATA_GOVERNANCE_MODE: 'ON', KB_ALLOW_RAW_FILE_INGEST: true } });
      await runner.runFragment(new Date());
      expect(rag.ingest).not.toHaveBeenCalled();
      expect((await h.prisma.kbIngestJob.findUniqueOrThrow({ where: { id: job.id } })).resultCode).toBe('EXCLUDED_AT_INGEST');
    });

    it('대조: 거버넌스 OFF + truncated는 전송한다', async () => {
      await pendingJob({ kind: 'PDF' }, '/docs/f2.pdf', { allowRawFileIngest: true });
      const fetcher = new FakeFetcher().route(`${HOST}/docs/f2.pdf`, pdf());
      const { runner, rag } = makeIngestRunner({ fetcher, extractor: fileExtractor({ truncated: true }), cfg: { DATA_GOVERNANCE_MODE: 'OFF' } });
      await runner.runFragment(new Date());
      expect(rag.ingest).toHaveBeenCalledTimes(1);
    });
  });
});
