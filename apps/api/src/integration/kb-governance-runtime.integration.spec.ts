import { ApiException } from '../common/api.exception';
import { KbIngestRunner } from '../kb-sync/engine/kb-ingest.runner';
import { KbRunsService } from '../kb-sync/kb-runs.service';
import { InProcessExtractor } from '../kb-sync/extract/in-process.extractor';
import { computeIngestFingerprint, sha256Hex } from '../kb-sync/lib/content-fingerprint';
import { buildExternalFileName, urlHash } from '../kb-sync/lib/external-file-name';
import { FakeFetcher, HOST, createHarness, html, makeConfig, page } from './helpers/kb-crawl-db-harness';
import type { Harness } from './helpers/kb-crawl-db-harness';

/**
 * 지식베이스 크롤링(No.43) 백엔드 pass 8 — PM 결정(2026-09-28): 거버넌스 모드를 켜기 **전에** 마스킹을 끄거나 원본 파일 전달을 켜 저장한 소스는 모드를 켠 뒤에도 원문을 비마스킹으로 적재한다.
 * 저장 시점 검증만으로는 못 막으므로 (1) 실행 시작(`claimAndCreateRun` — 스케줄러·수동 실행·적재 승인 세 경로 공용)과 (2) 적재 제출 직전에 저장된 값을 다시 본다.
 */
const DOCS = `${HOST}/docs/`;
const MASK_OFF_MESSAGE = '거버넌스 모드에서는 개인정보 마스킹을 끌 수 없습니다. 소스를 수정해 마스킹을 켜 주세요.';

async function addDoc(h: Harness, sourceId: string, path: string, over: Record<string, unknown> = {}) {
  const url = `${HOST}${path}`;
  return h.prisma.kbDocument.create({
    data: { sourceId, url, urlHash: urlHash(url), kind: 'HTML', externalFileName: buildExternalFileName(sourceId, url, 'html'), seenRunId: 'old-run', visitState: 'VISITED', ...over },
  });
}

async function ingestedFields(body: string) {
  const ex = await new InProcessExtractor().extract({ kind: 'HTML', html: body, noisePatterns: [], piiMask: true, piiMaskMode: 'PARTIAL' });
  const contentHash = sha256Hex(ex.normalizedText);
  return { contentHash, ingestFingerprint: computeIngestFingerprint({ contentHash, format: 'DOCX', piiMask: true, piiMaskMode: 'PARTIAL' }), textLength: ex.normalizedText.length, lastIngestedAt: new Date(Date.now() - 3_600_000) };
}

function makeRag() {
  return {
    isConfigured: () => true,
    status: jest.fn(async () => ({ networkError: false, httpStatus: 200, body: { vllm_ready: true } })),
    ingest: jest.fn(async () => ({ networkError: false, httpStatus: 200, body: { result: 'RAG Vector DB 추가 성공.' } })),
    taskStatus: jest.fn(),
  };
}

describe('KB pass 8 — 거버넌스 모드와 piiMask·원본 파일 전달 실행·적재 시점 차단', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await createHarness('pass8-governance');
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
    await h.prisma.kbSyncRun.deleteMany({});
    await h.prisma.kbSource.deleteMany({});
  });

  /** 실행·저장 서비스가 읽는 설정만 "거버넌스 ON"으로 바꾼다(소스는 OFF 시절에 저장된 상태 그대로). */
  function governanceOn(extra: Record<string, unknown> = {}): void {
    const real = h.config.get.bind(h.config) as (key: string) => unknown;
    jest.spyOn(h.config, 'get').mockImplementation(((key: string) => (key === 'DATA_GOVERNANCE_MODE' ? 'ON' : key in extra ? extra[key] : real(key))) as never);
  }

  const ragClient = { isConfigured: () => true };
  const makeRuns = () => new KbRunsService(h.prisma, h.config, h.store, h.sourcesService, { record: jest.fn().mockResolvedValue(undefined) } as never, ragClient as never);
  const runCount = (sourceId: string) => h.prisma.kbSyncRun.count({ where: { sourceId } });
  const sourceOf = (id: string) => h.prisma.kbSource.findUniqueOrThrow({ where: { id } });

  async function expectRejectedWithoutTrace(sourceId: string, action: () => Promise<unknown>, field = 'piiMask', message = 'GOVERNANCE_MASK_REQUIRED'): Promise<void> {
    const before = await sourceOf(sourceId);
    const runsBefore = await runCount(sourceId);
    const err = await action().then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ApiException);
    const body = (err as ApiException).getResponse() as { code: string; message: string; details?: Array<{ field: string; message: string }> };
    expect((err as ApiException).getStatus()).toBe(409);
    expect(body.details).toEqual([{ field, message }]);
    expect(await runCount(sourceId)).toBe(runsBefore); // 실행 행이 만들어지지 않았다.
    const after = await sourceOf(sourceId);
    expect(after.activeRunId).toBeNull(); // 소스 선점도 남지 않았다.
    expect(after.approvedConfigVersion).toBe(before.approvedConfigVersion); // 적재 승인 기록도 남지 않았다(같은 트랜잭션 롤백).
    expect(after.nextRunAt?.getTime() ?? null).toBe(before.nextRunAt?.getTime() ?? null);
  }

  describe('1. 실행 시작 시(claimAndCreateRun) — 수동 실행·적재 승인·예약 세 경로', () => {
    it('★ (a) 수동 실행(PREVIEW·SYNC·FULL_RESEND) — 실행도 소스 선점도 남기지 않고 원인+해결 방법을 알린다', async () => {
      const { id } = await h.createSource({ piiMask: false }); // 거버넌스 OFF 시절 저장
      governanceOn();
      const runs = makeRuns();
      for (const kind of ['PREVIEW', 'SYNC', 'FULL_RESEND'] as const) {
        await expectRejectedWithoutTrace(id, () => runs.createRun(id, { kind, acknowledgeCleanup: false } as never, 'tester'));
      }
      const err = await runs.createRun(id, { kind: 'PREVIEW' } as never, 'tester').catch((e: unknown) => e);
      expect(((err as ApiException).getResponse() as { message: string }).message).toBe(MASK_OFF_MESSAGE);
    });

    it('★ (a) 적재 승인(approve-ingest) — 승인 기록도 실행도 남지 않는다', async () => {
      const { id } = await h.createSource({ piiMask: false });
      const fetcher = new FakeFetcher().route(`${HOST}/robots.txt`, html('User-agent: *\nAllow: /\n')).route(DOCS, html(page('목록')));
      const previewRunId = await h.startRun(id, 'PREVIEW');
      const preview = await h.drive(h.makeRunner({ fetcher }).runner, previewRunId);
      expect(preview.status).toBe('SUCCEEDED');
      await h.prisma.kbSource.update({ where: { id }, data: { approvedConfigVersion: null } }); // 아직 승인 전
      governanceOn();
      await expectRejectedWithoutTrace(id, () => makeRuns().approveIngest(id, { previewRunId } as never, 'tester'));
      expect((await sourceOf(id)).approvedConfigVersion).toBeNull();
    });

    it('★ (a) 원본 파일 전달 켬 + 서버 허용 없음도 같다(GOVERNANCE_RAW_FILE_NOT_ALLOWED)', async () => {
      const { id } = await h.createSource({ allowRawFileIngest: true, fileTypes: ['PDF'] });
      governanceOn({ KB_ALLOW_RAW_FILE_INGEST: false });
      await expectRejectedWithoutTrace(id, () => makeRuns().createRun(id, { kind: 'PREVIEW' } as never, 'tester'), 'allowRawFileIngest', 'GOVERNANCE_RAW_FILE_NOT_ALLOWED');
    });

    it('(e) 회귀 없음 — 거버넌스 OFF에서는 마스킹을 꺼 둔 소스도 그대로 실행된다', async () => {
      const { id } = await h.createSource({ piiMask: false });
      const { runId } = await makeRuns().createRun(id, { kind: 'PREVIEW' } as never, 'tester');
      expect(runId).toBeTruthy();
      expect((await sourceOf(id)).activeRunId).toBe(runId);
    });

    it('(e) 회귀 없음 — 거버넌스 ON이어도 마스킹을 켠 소스(또는 서버가 원본 파일 전달을 허용한 소스)는 그대로 실행된다', async () => {
      const masked = await h.createSource({ piiMask: true });
      governanceOn({ KB_ALLOW_RAW_FILE_INGEST: true });
      const raw = await h.createSource({ piiMask: true, allowRawFileIngest: true, fileTypes: ['PDF'], seedUrls: ['https://b.example/docs/'] });
      const runs = makeRuns();
      expect((await runs.createRun(masked.id, { kind: 'PREVIEW' } as never, 'tester')).runId).toBeTruthy();
      expect((await runs.createRun(raw.id, { kind: 'PREVIEW' } as never, 'tester')).runId).toBeTruthy();
    });

    it('★ (d) 소스를 수정해 마스킹을 켜 저장하면 다시 실행된다(저장 시점 검증은 그대로)', async () => {
      const { id } = await h.createSource({ piiMask: false });
      governanceOn();
      const runs = makeRuns();
      await expectRejectedWithoutTrace(id, () => runs.createRun(id, { kind: 'PREVIEW' } as never, 'tester'));
      // 저장 시점 검증은 그대로 — 마스킹을 끈 채 저장하려는 시도는 거부된다.
      await expect(h.sourcesService.update(id, { piiMask: false } as never, 'tester')).rejects.toBeInstanceOf(ApiException);
      await h.sourcesService.update(id, { piiMask: true } as never, 'tester');
      const { runId } = await runs.createRun(id, { kind: 'PREVIEW' } as never, 'tester');
      expect((await sourceOf(id)).activeRunId).toBe(runId);
    });

    describe('예약 실행 — tick을 죽이지 않고 소스 단위로 격리하며 같은 사유를 tick마다 되풀이하지 않는다', () => {
      async function dueSource(over: Record<string, unknown>): Promise<string> {
        const { id } = await h.createSource({ schedule: { kind: 'DAILY', time: '03:00' }, ...over });
        await h.prisma.kbSource.update({ where: { id }, data: { nextRunAt: new Date(Date.now() - 60_000) } });
        return id;
      }

      it('★ (a) 막힌 소스는 실행을 만들지 않고, 같은 tick의 다른 소스는 정상 예약된다', async () => {
        const blocked = await dueSource({ piiMask: false });
        const fine = await dueSource({ piiMask: true, seedUrls: ['https://b.example/docs/'] });
        governanceOn();
        const created = await h.scheduler.scheduleDueSources(new Date(), 10);
        expect(created).toHaveLength(1);
        expect(await runCount(blocked)).toBe(0);
        expect((await sourceOf(blocked)).activeRunId).toBeNull();
        expect(await runCount(fine)).toBe(1);
      });

      it('★ (f) 같은 사유로 tick마다 로그·감사를 되풀이해 쌓지 않는다 — 예약 시각당 1건, 다음 예약 시각으로 넘어간다', async () => {
        const id = await dueSource({ piiMask: false });
        governanceOn();
        const warn = jest.spyOn(h.scheduler['logger'], 'warn').mockImplementation(() => undefined);
        const error = jest.spyOn(h.scheduler['logger'], 'error').mockImplementation(() => undefined);
        const audit = (h.sourcesService as unknown as { auditLogService: { record: jest.Mock } }).auditLogService.record;
        audit.mockClear();
        for (let i = 0; i < 5; i += 1) await h.scheduler.scheduleDueSources(new Date(), 10);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(error).not.toHaveBeenCalled();
        expect(audit.mock.calls.filter((c) => (c[0] as { targetId: string }).targetId === id)).toHaveLength(1);
        expect((await sourceOf(id)).nextRunAt!.getTime()).toBeGreaterThan(Date.now()); // 더는 "이미 지난 예약"이 아니다 — 다음 tick의 후보가 아니다.
        expect(await runCount(id)).toBe(0);
      });

      it('(e) 회귀 없음 — 거버넌스 OFF에서는 같은 소스가 정상 예약된다', async () => {
        const id = await dueSource({ piiMask: false });
        const created = await h.scheduler.scheduleDueSources(new Date(), 10);
        expect(created).toHaveLength(1);
        expect(await runCount(id)).toBe(1);
      });

      it('(d) 마스킹을 켜 저장하면 다음 예약 시각에 다시 실행된다', async () => {
        const id = await dueSource({ piiMask: false });
        governanceOn();
        await h.scheduler.scheduleDueSources(new Date(), 10);
        expect(await runCount(id)).toBe(0);
        await h.sourcesService.update(id, { piiMask: true } as never, 'tester');
        await h.prisma.kbSource.update({ where: { id }, data: { nextRunAt: new Date(Date.now() - 1_000) } });
        const created = await h.scheduler.scheduleDueSources(new Date(), 10);
        expect(created).toHaveLength(1);
      });
    });
  });

  describe('2. 적재 제출 직전 — 이미 진행 중이던 실행도 외부 RAG로 원문이 나가기 전에 종결한다', () => {
    function makeIngestRunner(cfg: Record<string, unknown>) {
      const rag = makeRag();
      const runner = new KbIngestRunner(
        h.store,
        h.sourcesService,
        h.prisma,
        rag as never,
        new FakeFetcher().route(`${HOST}/docs/a`, html(page('A'))).route(`${HOST}/docs/b`, html(page('B'))) as never,
        { get: () => null } as never,
        makeConfig({ KB_INGEST_POLL_MS: 10, ...cfg }),
        new InProcessExtractor(),
        { tryAcquire: () => true } as never,
      );
      return { runner, rag };
    }

    /** 소스(OFF 시절 저장) · INGESTING 실행 · 이미 적재된 문서(SUCCEEDED 작업) · 아직 제출 전인 문서(PENDING 작업). */
    async function scenario(sourceOver: Record<string, unknown>) {
      const { id } = await h.createSource(sourceOver);
      const runId = await h.startRun(id, 'SYNC');
      await h.prisma.kbSyncRun.update({ where: { id: runId }, data: { status: 'INGESTING' } });
      const doneBody = page('이미 적재됨');
      const done = await addDoc(h, id, '/docs/done', { seenRunId: runId, ...(await ingestedFields(doneBody)) });
      const pending = await addDoc(h, id, '/docs/a', { seenRunId: runId });
      await h.store.createIngestJobsBulk([
        { runId, sourceId: id, documentId: done.id, lane: 'INCREMENTAL', reason: 'CHANGED' },
        { runId, sourceId: id, documentId: pending.id, lane: 'INCREMENTAL', reason: 'NEW' },
      ]);
      await h.prisma.kbIngestJob.updateMany({ where: { runId, documentId: done.id }, data: { status: 'SUCCEEDED', resultCode: 'OK' } });
      await h.prisma.kbDocument.update({ where: { id: done.id }, data: { activeIngestJobId: null } });
      return { sourceId: id, runId, done, pending };
    }

    it('★ (b)(c) 거버넌스 ON으로 바뀐 뒤 PENDING 작업 — 외부 RAG 호출 0(상태 조회 포함)으로 실행을 끝내고, 이미 적재된 문서는 그대로다', async () => {
      const { sourceId, runId, done, pending } = await scenario({ piiMask: false });
      const doneBefore = await h.prisma.kbDocument.findUniqueOrThrow({ where: { id: done.id } });
      const { runner, rag } = makeIngestRunner({ DATA_GOVERNANCE_MODE: 'ON' });
      await runner.runFragment(new Date());

      expect(rag.ingest).not.toHaveBeenCalled();
      expect(rag.status).not.toHaveBeenCalled();
      expect(rag.taskStatus).not.toHaveBeenCalled();
      const run = await h.store.findRun(runId);
      expect(run?.status).toBe('CANCELLED');
      expect(run?.failureCode).toBe('GOVERNANCE_MASK_REQUIRED');
      const job = await h.prisma.kbIngestJob.findFirstOrThrow({ where: { runId, documentId: pending.id } });
      expect(job.status).toBe('CANCELLED');
      expect(job.resultCode).toBe('CONFIG_CHANGED');
      expect((await h.prisma.kbDocument.findUniqueOrThrow({ where: { id: pending.id } })).activeIngestJobId).toBeNull(); // 진행 중 표식 정리
      expect((await sourceOf(sourceId)).activeRunId).toBeNull(); // 소스 선점 해제
      // 이미 적재된 문서 행·외부 파일 이름은 건드리지 않는다.
      const doneAfter = await h.prisma.kbDocument.findUniqueOrThrow({ where: { id: done.id } });
      expect(doneAfter.externalFileName).toBe(doneBefore.externalFileName);
      expect(doneAfter.contentHash).toBe(doneBefore.contentHash);
      expect(doneAfter.lastIngestedAt?.getTime()).toBe(doneBefore.lastIngestedAt?.getTime());
      expect(doneAfter.state).toBe('ACTIVE');
      expect((await h.prisma.kbIngestJob.findFirstOrThrow({ where: { runId, documentId: done.id } })).status).toBe('SUCCEEDED');
    });

    it('★ (b) 원본 파일 전달 켬 + 서버 허용 없음 — 같은 방식으로 끝낸다(GOVERNANCE_RAW_FILE_NOT_ALLOWED)', async () => {
      const { runId } = await scenario({ allowRawFileIngest: true, fileTypes: ['PDF'] });
      const { runner, rag } = makeIngestRunner({ DATA_GOVERNANCE_MODE: 'ON' });
      await runner.runFragment(new Date());
      expect(rag.ingest).not.toHaveBeenCalled();
      expect(rag.status).not.toHaveBeenCalled();
      expect((await h.store.findRun(runId))?.failureCode).toBe('GOVERNANCE_RAW_FILE_NOT_ALLOWED');
    });

    it('(e) 회귀 없음 — 거버넌스 OFF에서는 마스킹을 꺼 둔 소스의 작업도 그대로 제출된다', async () => {
      const { runId } = await scenario({ piiMask: false });
      const { runner, rag } = makeIngestRunner({});
      await runner.runFragment(new Date());
      expect(rag.ingest).toHaveBeenCalledTimes(1);
      expect((await h.store.findRun(runId))?.failureCode).toBeNull();
    });

    it('(e) 회귀 없음 — 거버넌스 ON이어도 마스킹을 켠 소스는 그대로 제출된다', async () => {
      const { runId } = await scenario({ piiMask: true });
      const { runner, rag } = makeIngestRunner({ DATA_GOVERNANCE_MODE: 'ON' });
      await runner.runFragment(new Date());
      expect(rag.ingest).toHaveBeenCalledTimes(1);
      const run = await h.store.findRun(runId);
      expect(run?.status).not.toBe('CANCELLED');
      expect(run?.failureCode).toBeNull();
    });

    it('(e) 회귀 없음 — 서버가 원본 파일 전달을 허용했으면(KB_ALLOW_RAW_FILE_INGEST) 켠 소스도 제출된다', async () => {
      await scenario({ piiMask: true, allowRawFileIngest: true, fileTypes: ['PDF'] });
      const { runner, rag } = makeIngestRunner({ DATA_GOVERNANCE_MODE: 'ON', KB_ALLOW_RAW_FILE_INGEST: true });
      await runner.runFragment(new Date());
      expect(rag.ingest).toHaveBeenCalledTimes(1);
    });

    it('★ (d) 마스킹을 켜 저장한 소스의 새 실행은 적재까지 진행된다', async () => {
      const { sourceId } = await scenario({ piiMask: false });
      const first = makeIngestRunner({ DATA_GOVERNANCE_MODE: 'ON' });
      await first.runner.runFragment(new Date()); // 막혀 끝난다
      governanceOn();
      await h.sourcesService.update(sourceId, { piiMask: true } as never, 'tester');
      const runId = await h.startRun(sourceId, 'SYNC');
      await h.prisma.kbSyncRun.update({ where: { id: runId }, data: { status: 'INGESTING' } });
      const doc = await addDoc(h, sourceId, '/docs/b', { seenRunId: runId });
      await h.store.createIngestJobsBulk([{ runId, sourceId, documentId: doc.id, lane: 'INCREMENTAL', reason: 'NEW' }]);
      const second = makeIngestRunner({ DATA_GOVERNANCE_MODE: 'ON' });
      await second.runner.runFragment(new Date());
      expect(second.rag.ingest).toHaveBeenCalledTimes(1);
    });
  });
});
