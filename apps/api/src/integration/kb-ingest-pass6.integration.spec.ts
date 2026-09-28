import { KbIngestRunner } from '../kb-sync/engine/kb-ingest.runner';
import { KbRunsService } from '../kb-sync/kb-runs.service';
import { InProcessExtractor } from '../kb-sync/extract/in-process.extractor';
import type { KbExtractorPort } from '../kb-sync/extract/kb-extractor.port';
import type { KbFetchResult } from '../kb-sync/crawl/kb-crawl-http.fetcher';
import { computeIngestFingerprint, sha256Hex } from '../kb-sync/lib/content-fingerprint';
import { buildExternalFileName, urlHash } from '../kb-sync/lib/external-file-name';
import { FakeFetcher, HOST, createHarness, html, makeConfig, page } from './helpers/kb-crawl-db-harness';
import type { Harness } from './helpers/kb-crawl-db-harness';

/**
 * 지식베이스 크롤링(No.43) 백엔드 pass 6 — 적재 단계 시험(H-3 · RG-16 적재 재수집 · RG-19 · RG-20③⑥ · Low-3).
 */
const DOCS = `${HOST}/docs/`;
const redirect = (location: string, code = 301): KbFetchResult => ({ kind: 'REDIRECT', status: code, location, headers: {} });

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

/** 이 본문이 이미 적재된 것처럼 문서 행의 해시·지문을 채울 값(HTML · 마스킹 켬 · 변환 DOCX 기본값). */
async function ingestedFields(body: string) {
  const ex = await new InProcessExtractor().extract({ kind: 'HTML', html: body, noisePatterns: [], piiMask: true, piiMaskMode: 'PARTIAL' });
  const contentHash = sha256Hex(ex.normalizedText);
  return { contentHash, ingestFingerprint: computeIngestFingerprint({ contentHash, format: 'DOCX', piiMask: true, piiMaskMode: 'PARTIAL' }), textLength: ex.normalizedText.length, lastIngestedAt: new Date(Date.now() - 3_600_000) };
}

/** 파일 사전 검사를 통과시키는 추출기(진짜 PDF 해석은 jest에서 동적 import가 안 돼 쓰지 않는다 — 이 시험의 관심사는 재전송 판정이다). */
const passingFileExtractor: KbExtractorPort = {
  async extract(req) {
    if (req.kind === 'HTML') return new InProcessExtractor().extract(req);
    return { ok: true, normalizedText: '본문', text: '본문', piiMaskedCount: 0, flags: [] };
  },
};

describe('KB pass 6 — 적재 단계', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await createHarness('pass6-ingest');
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
  async function pendingJob(docOver: Record<string, unknown>, path: string, sourceOver: Record<string, unknown> = {}, opts: { runStatus?: string; reason?: 'NEW' | 'CHANGED' | 'FULL_RESEND' } = {}) {
    const { id } = await h.createSource(sourceOver);
    const runId = await h.startRun(id, opts.reason === 'FULL_RESEND' ? 'FULL_RESEND' : 'SYNC');
    await h.prisma.kbSyncRun.update({ where: { id: runId }, data: { status: opts.runStatus ?? 'INGESTING' } });
    const doc = await addDoc(h, id, path, { seenRunId: runId, ...docOver });
    await h.store.createIngestJobsBulk([{ runId, sourceId: id, documentId: doc.id, lane: 'INCREMENTAL', reason: opts.reason ?? 'CHANGED' }]);
    const job = await h.prisma.kbIngestJob.findFirstOrThrow({ where: { runId } });
    return { sourceId: id, runId, doc, job };
  }

  /* ───────────────────────── H-3 ───────────────────────── */
  describe('H-3 — FULL_RESEND는 해시가 같아도 무시하고 재전송한다(설계 §9.8)', () => {
    it('★ HTML: FULL_RESEND 작업은 문서 해시·지문이 같아도 외부 RAG로 보낸다', async () => {
      const body = page('동일 문서');
      const { job, doc } = await pendingJob(await ingestedFields(body), '/docs/same', {}, { reason: 'FULL_RESEND' });
      const fetcher = new FakeFetcher().route(`${HOST}/docs/same`, html(body));
      const { runner, rag } = makeIngestRunner({ fetcher });
      await runner.runFragment(new Date());

      expect(rag.ingest).toHaveBeenCalledTimes(1);
      const after = await h.prisma.kbIngestJob.findUniqueOrThrow({ where: { id: job.id } });
      expect(after.status).toBe('SUCCEEDED');
      expect((await h.prisma.kbDocument.findUniqueOrThrow({ where: { id: doc.id } })).lastIngestJobId).toBe(job.id);
    });

    it('대조: 같은 상황이라도 NEW·CHANGED 작업(SYNC)은 UNCHANGED_AT_INGEST로 건너뛴다(다른 실행이 이미 반영)', async () => {
      const body = page('동일 문서');
      const { job } = await pendingJob(await ingestedFields(body), '/docs/same2', {}, { reason: 'CHANGED' });
      const { runner, rag } = makeIngestRunner({ fetcher: new FakeFetcher().route(`${HOST}/docs/same2`, html(body)) });
      await runner.runFragment(new Date());
      expect(rag.ingest).not.toHaveBeenCalled();
      const after = await h.prisma.kbIngestJob.findUniqueOrThrow({ where: { id: job.id } });
      expect(after.status).toBe('SKIPPED');
      expect(after.resultCode).toBe('UNCHANGED_AT_INGEST');
    });

    it('★ 파일(PDF · 원본 전달 켜짐): FULL_RESEND는 바이트 해시가 같아도 재전송한다', async () => {
      const bytes = Buffer.from('%PDF-1.4 same');
      const { job } = await pendingJob({ kind: 'PDF', contentHash: sha256Hex(bytes), ingestFingerprint: sha256Hex(bytes), lastIngestedAt: new Date() }, '/docs/f.pdf', { allowRawFileIngest: true }, { reason: 'FULL_RESEND' });
      const fetcher = new FakeFetcher().route(`${HOST}/docs/f.pdf`, { kind: 'RESPONSE', status: 200, contentType: 'application/pdf', body: bytes, headers: {} });
      const { runner, rag } = makeIngestRunner({ fetcher, extractor: passingFileExtractor });
      await runner.runFragment(new Date());
      expect(rag.ingest).toHaveBeenCalledTimes(1);
      expect((await h.prisma.kbIngestJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe('SUCCEEDED');
    });

    it('대조: 파일도 SYNC(CHANGED)에서는 해시가 같으면 건너뛴다', async () => {
      const bytes = Buffer.from('%PDF-1.4 same');
      const { job } = await pendingJob({ kind: 'PDF', contentHash: sha256Hex(bytes), ingestFingerprint: sha256Hex(bytes), lastIngestedAt: new Date() }, '/docs/f2.pdf', { allowRawFileIngest: true }, { reason: 'CHANGED' });
      const fetcher = new FakeFetcher().route(`${HOST}/docs/f2.pdf`, { kind: 'RESPONSE', status: 200, contentType: 'application/pdf', body: bytes, headers: {} });
      const { runner, rag } = makeIngestRunner({ fetcher, extractor: passingFileExtractor });
      await runner.runFragment(new Date());
      expect(rag.ingest).not.toHaveBeenCalled();
      expect((await h.prisma.kbIngestJob.findUniqueOrThrow({ where: { id: job.id } })).resultCode).toBe('UNCHANGED_AT_INGEST');
    });

    it('★ 끝에서 끝까지 — 변경 없는 문서에 FULL_RESEND 실행을 하면 크롤 → 적재까지 실제로 외부 RAG를 호출하고 SUCCEEDED로 끝난다', async () => {
      const { id } = await h.createSource();
      const body = page('동일 문서');
      await addDoc(h, id, '/docs/', await ingestedFields(body));
      const fetcher = new FakeFetcher().route(`${HOST}/robots.txt`, html('User-agent: *\nAllow: /\n')).route(DOCS, html(body));
      const { runner: crawler } = h.makeRunner({ fetcher });
      const runId = await h.startRun(id, 'FULL_RESEND');
      const run = await h.drive(crawler, runId);
      expect(run.status).toBe('INGESTING');

      const { runner: ingest, rag } = makeIngestRunner({ fetcher });
      for (let i = 0; i < 5; i += 1) await ingest.runFragment(new Date());
      expect(rag.ingest).toHaveBeenCalledTimes(1);
      expect((await h.store.findRun(runId))?.status).toBe('SUCCEEDED');
    });
  });

  /* ───────────────────────── RG-19 ───────────────────────── */
  describe('RG-19 — 종결 직전 중지 경합의 고아 작업은 제출하지 않는다', () => {
    it('★ 실행이 이미 종단(CANCELLED)이면 PENDING 작업을 제출하지 않고 CANCELLED로 정리한다(외부 호출 0 · 문서 표식 해제)', async () => {
      const { job, doc } = await pendingJob({}, '/docs/orphan', {}, { runStatus: 'CANCELLED' });
      expect((await h.prisma.kbDocument.findUniqueOrThrow({ where: { id: doc.id } })).activeIngestJobId).toBe(job.id);
      const fetcher = new FakeFetcher().route(`${HOST}/docs/orphan`, html(page('고아')));
      const { runner, rag } = makeIngestRunner({ fetcher });
      await runner.runFragment(new Date());

      expect(rag.ingest).not.toHaveBeenCalled();
      expect(fetcher.requests).toHaveLength(0); // 재수집도 하지 않는다.
      const after = await h.prisma.kbIngestJob.findUniqueOrThrow({ where: { id: job.id } });
      expect(after.status).toBe('CANCELLED');
      expect(after.resultCode).toBe('CANCELLED_BY_USER');
      expect((await h.prisma.kbDocument.findUniqueOrThrow({ where: { id: doc.id } })).activeIngestJobId).toBeNull();
      expect((await h.prisma.kbDocument.findUniqueOrThrow({ where: { id: doc.id } })).consecutiveIngestFailures).toBe(0); // 실패가 아니다.
    });

    it('★ 실행이 아직 크롤 종결 중(CRAWLING)이면 제출하지도 취소하지도 않고 기다린다(잠시 뒤 INGESTING이 된다)', async () => {
      const { job } = await pendingJob({}, '/docs/wait', {}, { runStatus: 'CRAWLING' });
      const fetcher = new FakeFetcher().route(`${HOST}/docs/wait`, html(page('대기')));
      const { runner, rag } = makeIngestRunner({ fetcher });
      await runner.runFragment(new Date());
      expect(rag.ingest).not.toHaveBeenCalled();
      expect((await h.prisma.kbIngestJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe('PENDING');
    });

    it('★ 리뷰어 재현 — 후보 조회 직후 중지되면 외부 RAG 호출 0 · activeIngestJobId 잔존 0', async () => {
      const { id } = await h.createSource();
      const fetcher = new FakeFetcher().route(`${HOST}/robots.txt`, html('User-agent: *\nAllow: /\n')).route(DOCS, html(page('목록', ['/docs/a']))).route(`${HOST}/docs/a`, html(page('A')));
      const { runner: crawler } = h.makeRunner({ fetcher });
      const runId = await h.startRun(id, 'SYNC');
      const real = h.store.findIngestCandidates.bind(h.store);
      jest.spyOn(h.store, 'findIngestCandidates').mockImplementation(async (...args) => {
        const cands = await real(...args);
        await h.sourcesService.cancelRunAndRelease(id, runId, new Date(), 'user-1', 'CANCELLED_BY_USER');
        return cands;
      });
      await h.drive(crawler, runId);
      const { runner: ingest, rag } = makeIngestRunner({ fetcher });
      for (let i = 0; i < 5; i += 1) await ingest.runFragment(new Date());

      expect(rag.ingest).not.toHaveBeenCalled();
      expect(await h.prisma.kbDocument.count({ where: { sourceId: id, activeIngestJobId: { not: null } } })).toBe(0);
    });
  });

  /* ───────────────────────── RG-16 (적재 단계 재수집) ───────────────────────── */
  describe('RG-16 — 적재 단계 재수집도 리다이렉트를 따른다', () => {
    it('★ /docs/a → /docs/a/ 로 리다이렉트되는 문서도 적재된다(예전에는 3회 재시도 뒤 FAILED)', async () => {
      const { job } = await pendingJob({}, '/docs/a');
      const fetcher = new FakeFetcher().route(`${HOST}/docs/a`, redirect('/docs/a/')).route(`${HOST}/docs/a/`, html(page('A 폴더')));
      const { runner, rag } = makeIngestRunner({ fetcher });
      await runner.runFragment(new Date());
      expect(rag.ingest).toHaveBeenCalledTimes(1);
      const after = await h.prisma.kbIngestJob.findUniqueOrThrow({ where: { id: job.id } });
      expect(after.status).toBe('SUCCEEDED');
      expect(after.externalFileName).toBe(buildExternalFileName(job.sourceId, `${HOST}/docs/a`, 'docx')); // 문서 식별은 원래 URL 그대로.
    });

    it.each([
      ['범위 밖 호스트', () => redirect('https://out.example/x')],
      ['경로 접두 밖', () => redirect('/other/x')],
      ['https → http 하향', () => redirect('http://a.example/docs/x')],
    ])('★ 리다이렉트 대상이 %s이면 SKIPPED(EXCLUDED_AT_INGEST) — 외부로 보내지 않는다', async (_l, res) => {
      const { job } = await pendingJob({}, '/docs/r');
      const fetcher = new FakeFetcher().route(`${HOST}/docs/r`, res());
      const { runner, rag } = makeIngestRunner({ fetcher });
      await runner.runFragment(new Date());
      expect(rag.ingest).not.toHaveBeenCalled();
      const after = await h.prisma.kbIngestJob.findUniqueOrThrow({ where: { id: job.id } });
      expect(after.status).toBe('SKIPPED');
      expect(after.resultCode).toBe('EXCLUDED_AT_INGEST');
      expect(fetcher.urls().some((u) => u.includes('out.example') || u.includes('http://'))).toBe(false);
    });

    it('4번째 hop·순환도 SKIPPED(EXCLUDED_AT_INGEST)', async () => {
      const { job } = await pendingJob({}, '/docs/c0');
      const fetcher = new FakeFetcher()
        .route(`${HOST}/docs/c0`, redirect('/docs/c1'))
        .route(`${HOST}/docs/c1`, redirect('/docs/c0'));
      const { runner, rag } = makeIngestRunner({ fetcher });
      await runner.runFragment(new Date());
      expect(rag.ingest).not.toHaveBeenCalled();
      expect((await h.prisma.kbIngestJob.findUniqueOrThrow({ where: { id: job.id } })).resultCode).toBe('EXCLUDED_AT_INGEST');
    });
  });

  /* ───────────────────────── RG-20 ⑥ · Low-3 ───────────────────────── */
  describe('RG-20⑥ / Low-3', () => {
    it('⑥ 적재 재수집의 HTML 응답 상한은 소스 파일 상한(20MB)이 아니라 2MB, 파일은 소스 상한이다', async () => {
      const html1 = await pendingJob({}, '/docs/h');
      const fetcher = new FakeFetcher().route(`${HOST}/docs/h`, html(page('H')));
      await makeIngestRunner({ fetcher }).runner.runFragment(new Date());
      expect(fetcher.requests.find((r) => r.url.endsWith('/docs/h'))?.maxBytes).toBe(2 * 1024 * 1024);
      expect(html1.job.id).toBeTruthy();

      const pdf = await pendingJob({ kind: 'PDF' }, '/docs/p.pdf', { allowRawFileIngest: true });
      const f2 = new FakeFetcher().route(`${HOST}/docs/p.pdf`, { kind: 'RESPONSE', status: 200, contentType: 'application/pdf', body: Buffer.from('%PDF-1.4'), headers: {} });
      await makeIngestRunner({ fetcher: f2, extractor: passingFileExtractor }).runner.runFragment(new Date());
      expect(f2.requests.find((r) => r.url.endsWith('.pdf'))?.maxBytes).toBe(20971520);
      expect(pdf.job.id).toBeTruthy();
    });

    it('Low-3 — 제출 도중 슬롯 임대를 갱신한다(재수집 뒤 · 외부 전송 직전) — 최소 임대 시간보다 긴 구간에서 만료되지 않게', async () => {
      await pendingJob({}, '/docs/lease');
      const fetcher = new FakeFetcher().route(`${HOST}/docs/lease`, html(page('임대')));
      const spy = jest.spyOn(h.store, 'renewSlot');
      const { runner, rag } = makeIngestRunner({ fetcher });
      await runner.runFragment(new Date());
      expect(rag.ingest).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    it('③ 소스 일시중지로 멈춘 실행의 PENDING 작업은 CONFIG_CHANGED · 관리자 중지는 CANCELLED_BY_USER', async () => {
      const runsService = new KbRunsService(h.prisma, h.config, h.store, h.sourcesService, { record: jest.fn() } as never, { isConfigured: () => true } as never);
      const a = await pendingJob({}, '/docs/d1');
      await h.sourcesService.update(a.sourceId, { enabled: false }, 'user-1');
      const b = await pendingJob({}, '/docs/d2');
      await runsService.cancelRun(b.sourceId, b.runId, 'user-1');

      const ja = await h.prisma.kbIngestJob.findUniqueOrThrow({ where: { id: a.job.id } });
      const jb = await h.prisma.kbIngestJob.findUniqueOrThrow({ where: { id: b.job.id } });
      expect(ja.status).toBe('CANCELLED');
      expect(ja.resultCode).toBe('CONFIG_CHANGED');
      expect(jb.status).toBe('CANCELLED');
      expect(jb.resultCode).toBe('CANCELLED_BY_USER');
    });
  });
});
