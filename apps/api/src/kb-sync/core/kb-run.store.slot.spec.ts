import { randomUUID } from 'node:crypto';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaService } from '../../prisma/prisma.service';
import { KbRunStore } from './kb-run.store';

/**
 * [pass 4 · 위반 1] 적재 슬롯 수명 — 슬롯은 작업이 **종단 상태가 되거나 백오프로 PENDING에 돌아갈 때까지**
 * 유지된다(제출 직후 해제되지 않는다). 죽은 인스턴스가 쥐던 슬롯을 다른 인스턴스가 이어받으면 그 슬롯의
 * SUBMITTED 작업도 함께 이어받는다(같은 `taskId`를 계속 조회 — 재전송 아님). 문서 표식·연속 실패 수 규칙도 함께 본다.
 */
const API_ROOT = join(__dirname, '..', '..', '..');
const LEASE_MS = 600_000;

async function safeCleanupTmpDir(dir: string): Promise<void> {
  await new Promise((r) => setTimeout(r, 200));
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {
    // Windows 파일 핸들 지연 해제 — 판정에 영향 없음.
  }
}

describe('KbRunStore — 적재 슬롯 수명 · 작업 종결 시 슬롯 해제 · 문서 표식(pass 4)', () => {
  let tmpDir: string;
  let prisma: PrismaService;
  let store: KbRunStore;
  let sourceId: string;
  let runId: string;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'chatbot-kb-run-store-slot-test-'));
    const testDatabaseUrl = `file:${join(tmpDir, 'test.db').replace(/\\/g, '/')}`;
    process.env.DATABASE_URL = testDatabaseUrl;
    try {
      execSync('pnpm exec prisma migrate deploy', { cwd: API_ROOT, env: { ...process.env, DATABASE_URL: testDatabaseUrl }, stdio: 'pipe' });
    } catch (e) {
      const err = e as { stdout?: Buffer; stderr?: Buffer };
      throw new Error(`prisma migrate deploy 실패:\n${err.stdout?.toString()}\n${err.stderr?.toString()}`);
    }
    prisma = new PrismaService();
    await prisma.$connect();
    store = new KbRunStore(prisma);

    const source = await prisma.kbSource.create({
      data: {
        name: `슬롯-소스-${randomUUID().slice(0, 8)}`,
        nameNormalized: `slot-${randomUUID().slice(0, 8)}`,
        scopeCompany: '예시공사',
        scopeCategory: '테스트',
        scopeSubcategory: '슬롯',
        rightsConfirmedById: 'tester',
        rightsConfirmedAt: new Date(),
      },
    });
    sourceId = source.id;
    const run = await prisma.kbSyncRun.create({ data: { id: randomUUID(), sourceId, sourceName: source.name, kind: 'SYNC', trigger: 'MANUAL', status: 'INGESTING', configVersion: 1, counts: '{}' } });
    runId = run.id;
  }, 30_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    await safeCleanupTmpDir(tmpDir);
  }, 15_000);

  /** 슬롯을 실제로 선점한 뒤, 그 슬롯을 쥔 SUBMITTED(또는 지정 상태) 작업 1건을 만든다. */
  async function makeJobHoldingSlot(slotName: string, status: 'SUBMITTING' | 'SUBMITTED' | 'PENDING' = 'SUBMITTED', now = new Date()) {
    await store.ensureLeaseRow(slotName);
    const slotKey = (await store.claimAnySlot([slotName], LEASE_MS, now, 'test'))!;
    expect(slotKey).toMatch(new RegExp(`^${slotName}:`));
    const doc = await prisma.kbDocument.create({
      data: { sourceId, url: `https://203.0.113.10/${randomUUID()}`, urlHash: randomUUID().replace(/-/g, '').slice(0, 16), kind: 'HTML', externalFileName: 'placeholder.docx', activeIngestJobId: null },
    });
    const job = await prisma.kbIngestJob.create({
      data: {
        runId,
        sourceId,
        documentId: doc.id,
        lane: 'INCREMENTAL',
        reason: 'NEW',
        status,
        attemptCount: 1,
        slotToken: status === 'PENDING' ? null : slotKey,
        taskId: status === 'SUBMITTED' ? '11111111-1111-4111-8111-111111111111' : null,
        submittedAt: status === 'SUBMITTED' ? now : null,
        lastPolledAt: status === 'SUBMITTED' ? now : null,
      },
    });
    await prisma.kbDocument.update({ where: { id: doc.id }, data: { activeIngestJobId: job.id } });
    return { slotKey, jobId: job.id, documentId: doc.id };
  }

  const lease = (name: string) => prisma.kbJobLease.findUnique({ where: { name } });

  describe('SUBMITTED 작업이 슬롯을 쥔 동안 다른 제출은 그 슬롯을 얻지 못한다(직렬)', () => {
    it('슬롯 1개 · SUBMITTED 작업 보유 중 → claimAnySlot이 null이다', async () => {
      const { slotKey } = await makeJobHoldingSlot('SLOT_SERIAL_1');
      expect(await store.claimAnySlot(['SLOT_SERIAL_1'], LEASE_MS, new Date(), 'other')).toBeNull();
      expect((await lease('SLOT_SERIAL_1'))?.claimToken).toBe(slotKey.split(':')[1]);
    });

    it('작업이 성공으로 끝나면 슬롯이 놓이고 다음 제출이 그 슬롯을 얻는다', async () => {
      const { jobId } = await makeJobHoldingSlot('SLOT_SERIAL_2');
      expect(await store.succeedJob(jobId, 'SUBMITTED')).toBe(true);
      expect((await lease('SLOT_SERIAL_2'))?.claimToken).toBeNull();
      expect(await store.claimAnySlot(['SLOT_SERIAL_2'], LEASE_MS, new Date(), 'next')).toMatch(/^SLOT_SERIAL_2:/);
    });

    it.each([
      ['failJob(FAILED)', (id: string) => store.failJob(id, 'SUBMITTED', 'TASK_FAILED')],
      ['timeoutJob(TIMEOUT)', (id: string) => store.timeoutJob(id)],
      ['retryJob(백오프로 PENDING 복귀)', (id: string) => store.retryJob(id, 'SUBMITTED', new Date(Date.now() + 60_000), 'TASK_FAILED')],
      ['resubmitNotFound(재전송 대기)', (id: string) => store.resubmitNotFound(id)],
    ])('%s → 슬롯을 놓는다', async (_label, finish) => {
      const name = `SLOT_END_${randomUUID().slice(0, 6)}`;
      const { jobId } = await makeJobHoldingSlot(name);
      expect(await finish(jobId)).toBe(true);
      expect((await lease(name))?.claimToken).toBeNull();
    });

    it('SUBMITTING 작업의 markSkipped·revertSubmissionClaim도 슬롯을 놓는다', async () => {
      const a = `SLOT_SK_${randomUUID().slice(0, 6)}`;
      const skipped = await makeJobHoldingSlot(a, 'SUBMITTING');
      await store.markSkipped(skipped.jobId, 'UNCHANGED_AT_INGEST');
      expect((await lease(a))?.claimToken).toBeNull();

      const b = `SLOT_RV_${randomUUID().slice(0, 6)}`;
      const reverted = await makeJobHoldingSlot(b, 'SUBMITTING');
      expect(await store.revertSubmissionClaim(reverted.jobId, 'SUBMITTING')).toBe(true);
      expect((await lease(b))?.claimToken).toBeNull();
    });

    it('조회(markPolled)는 슬롯 임대를 연장한다 — 3시간짜리 작업이 임대 만료(기본 10분)로 슬롯을 잃지 않는다', async () => {
      const name = 'SLOT_RENEW';
      const t0 = new Date(Date.now() - 9 * 60_000); // 9분 전에 선점 — 곧 만료될 임대.
      const { jobId } = await makeJobHoldingSlot(name, 'SUBMITTED', t0);
      const now = new Date();
      await store.markPolled(jobId, now);
      const row = await lease(name);
      expect(row?.claimedAt?.getTime()).toBe(now.getTime());
      // 11분이 더 지나도(임대 기준 20분 경과지만 9분 전 갱신 기준으로는 살아 있다) 다른 제출이 뺏지 못한다.
      expect(await store.claimAnySlot([name], LEASE_MS, new Date(now.getTime() + 9 * 60_000), 'other')).toBeNull();
    });
  });

  describe('죽은 인스턴스의 슬롯을 이어받으면 그 슬롯의 SUBMITTED 작업도 함께 이어받는다(재전송 아님)', () => {
    it('임대가 만료된 슬롯 + SUBMITTED 작업 → 새 보유자가 작업의 slotToken을 자기 것으로 바꾸고 슬롯을 쥔다(새 제출에는 쓰지 않는다)', async () => {
      const name = 'SLOT_ADOPT';
      const longAgo = new Date(Date.now() - (LEASE_MS + 60_000));
      const { jobId, slotKey: oldKey } = await makeJobHoldingSlot(name, 'SUBMITTED', longAgo);

      const claimed = await store.claimAnySlot([name], LEASE_MS, new Date(), 'survivor');
      expect(claimed).toBeNull(); // 이어받은 슬롯은 그 작업이 끝날 때까지 쥐므로 새 제출에 내주지 않는다.

      const job = await prisma.kbIngestJob.findUnique({ where: { id: jobId } });
      expect(job?.status).toBe('SUBMITTED'); // 재전송 아님 — PENDING으로 되돌리지 않았다.
      expect(job?.slotToken).not.toBe(oldKey);
      expect(job?.slotToken?.startsWith(`${name}:`)).toBe(true);
      const row = await lease(name);
      expect(job?.slotToken).toBe(`${name}:${row?.claimToken}`); // 새 보유자의 토큰.

      // 이어받은 뒤에도 작업이 끝나면 슬롯이 놓인다.
      expect(await store.succeedJob(jobId, 'SUBMITTED')).toBe(true);
      expect((await lease(name))?.claimToken).toBeNull();
    });

    it('임대가 만료됐고 소속 작업이 없으면 그냥 새 제출이 슬롯을 얻는다', async () => {
      const name = 'SLOT_STALE_EMPTY';
      await store.ensureLeaseRow(name);
      await prisma.kbJobLease.update({ where: { name }, data: { claimToken: 'dead', claimedAt: new Date(Date.now() - (LEASE_MS + 60_000)) } });
      expect(await store.claimAnySlot([name], LEASE_MS, new Date(), 'x')).toMatch(/^SLOT_STALE_EMPTY:/);
    });

    it('슬롯 2개 중 하나를 이어받아 묶여도 남은 슬롯은 새 제출에 쓴다', async () => {
      const dead = 'SLOT_MULTI_A';
      const free = 'SLOT_MULTI_B';
      await makeJobHoldingSlot(dead, 'SUBMITTED', new Date(Date.now() - (LEASE_MS + 60_000)));
      await store.ensureLeaseRow(free);
      const claimed = await store.claimAnySlot([dead, free], LEASE_MS, new Date(), 'x');
      expect(claimed).toMatch(/^SLOT_MULTI_B:/);
    });
  });

  describe('중지(cancelRun) — 슬롯과 문서 표식을 함께 풀되 실패로 세지 않는다', () => {
    it('PENDING은 CANCELLED · SUBMITTED는 UNKNOWN(슬롯 해제) · 문서의 activeIngestJobId 해제 · 연속 실패 수 불변', async () => {
      const source = await prisma.kbSource.create({
        data: { name: `중지-${randomUUID().slice(0, 6)}`, nameNormalized: `cancel-${randomUUID().slice(0, 6)}`, scopeCompany: 'c', scopeCategory: 'c', scopeSubcategory: 'c', rightsConfirmedById: 't', rightsConfirmedAt: new Date() },
      });
      const run = await prisma.kbSyncRun.create({ data: { id: randomUUID(), sourceId: source.id, sourceName: source.name, kind: 'SYNC', trigger: 'MANUAL', status: 'INGESTING', configVersion: 1, counts: '{}' } });
      const submitted = await (async () => {
        await store.ensureLeaseRow('SLOT_CANCEL');
        const slotKey = (await store.claimAnySlot(['SLOT_CANCEL'], LEASE_MS, new Date(), 't'))!;
        const doc = await prisma.kbDocument.create({ data: { sourceId: source.id, url: `https://203.0.113.10/${randomUUID()}`, urlHash: randomUUID().slice(0, 16), kind: 'HTML', externalFileName: 'a.docx' } });
        const job = await prisma.kbIngestJob.create({ data: { runId: run.id, sourceId: source.id, documentId: doc.id, lane: 'INCREMENTAL', reason: 'NEW', status: 'SUBMITTED', slotToken: slotKey, taskId: '11111111-1111-4111-8111-111111111111' } });
        await prisma.kbDocument.update({ where: { id: doc.id }, data: { activeIngestJobId: job.id } });
        return { job, doc };
      })();
      const pending = await (async () => {
        const doc = await prisma.kbDocument.create({ data: { sourceId: source.id, url: `https://203.0.113.10/${randomUUID()}`, urlHash: randomUUID().slice(0, 16), kind: 'HTML', externalFileName: 'b.docx' } });
        const job = await prisma.kbIngestJob.create({ data: { runId: run.id, sourceId: source.id, documentId: doc.id, lane: 'INCREMENTAL', reason: 'NEW', status: 'PENDING' } });
        await prisma.kbDocument.update({ where: { id: doc.id }, data: { activeIngestJobId: job.id } });
        return { job, doc };
      })();

      expect(await store.cancelRun(run.id, new Date(), 'admin')).toBe(true);

      expect((await prisma.kbIngestJob.findUnique({ where: { id: submitted.job.id } }))?.status).toBe('UNKNOWN');
      expect((await prisma.kbIngestJob.findUnique({ where: { id: pending.job.id } }))?.status).toBe('CANCELLED');
      expect((await lease('SLOT_CANCEL'))?.claimToken).toBeNull();
      for (const d of [submitted.doc, pending.doc]) {
        const doc = await prisma.kbDocument.findUnique({ where: { id: d.id } });
        expect(doc?.activeIngestJobId).toBeNull(); // 다음 실행이 이 문서를 다시 적재 대상으로 삼을 수 있다.
        expect(doc?.consecutiveIngestFailures).toBe(0); // 중지는 실패가 아니다.
      }
    });
  });

  describe('문서의 연속 실패 수(EX-KB-3 "반복 실패" 배지)는 진짜 실패에만 오른다', () => {
    async function docAfter(finish: (jobId: string) => Promise<unknown>, status: 'SUBMITTED' | 'PENDING' | 'SUBMITTING' = 'SUBMITTED') {
      const name = `SLOT_CF_${randomUUID().slice(0, 6)}`;
      const made = await makeJobHoldingSlot(name, status);
      await finish(made.jobId);
      return prisma.kbDocument.findUnique({ where: { id: made.documentId } });
    }

    it('FAILED·TIMEOUT은 +1, 표식은 해제', async () => {
      const failed = await docAfter((id) => store.failJob(id, 'SUBMITTED', 'TASK_FAILED'));
      expect(failed?.consecutiveIngestFailures).toBe(1);
      expect(failed?.activeIngestJobId).toBeNull();
      const timedOut = await docAfter((id) => store.timeoutJob(id));
      expect(timedOut?.consecutiveIngestFailures).toBe(1);
    });

    it('★ SKIPPED(변경 없음·사라짐·제외)는 실패가 아니다 — 0 유지 · 표식만 해제', async () => {
      const skipped = await docAfter((id) => store.markSkipped(id, 'UNCHANGED_AT_INGEST'), 'SUBMITTING');
      expect(skipped?.consecutiveIngestFailures).toBe(0);
      expect(skipped?.activeIngestJobId).toBeNull();
    });

    it('★ 설정 변경으로 취소(CONFIG_CHANGED)도 실패가 아니다', async () => {
      const cancelled = await docAfter((id) => store.cancelJobConfigChanged(id), 'PENDING');
      expect(cancelled?.consecutiveIngestFailures).toBe(0);
      expect(cancelled?.activeIngestJobId).toBeNull();
    });

    it('성공하면 0으로 되돌린다', async () => {
      const name = `SLOT_CF_OK_${randomUUID().slice(0, 6)}`;
      const made = await makeJobHoldingSlot(name);
      await prisma.kbDocument.update({ where: { id: made.documentId }, data: { consecutiveIngestFailures: 2 } });
      await store.succeedJob(made.jobId, 'SUBMITTED');
      expect((await prisma.kbDocument.findUnique({ where: { id: made.documentId } }))?.consecutiveIngestFailures).toBe(0);
    });
  });

  describe('작업 선택 — BULK 레인은 시간창 밖이면 고르지 않는다(INCREMENTAL은 항상)', () => {
    it('bulkAllowed=false면 BULK만 대기 중일 때 null · INCREMENTAL이 있으면 그것을 고른다', async () => {
      const source = await prisma.kbSource.create({
        data: { name: `레인-${randomUUID().slice(0, 6)}`, nameNormalized: `lane-${randomUUID().slice(0, 6)}`, scopeCompany: 'c', scopeCategory: 'c', scopeSubcategory: 'c', rightsConfirmedById: 't', rightsConfirmedAt: new Date() },
      });
      const run = await prisma.kbSyncRun.create({ data: { id: randomUUID(), sourceId: source.id, sourceName: source.name, kind: 'SYNC', trigger: 'MANUAL', status: 'INGESTING', configVersion: 1, counts: '{}' } });
      const mk = async (lane: 'BULK' | 'INCREMENTAL') => {
        const doc = await prisma.kbDocument.create({ data: { sourceId: source.id, url: `https://203.0.113.10/${randomUUID()}`, urlHash: randomUUID().slice(0, 16), kind: 'HTML', externalFileName: 'x.docx' } });
        return prisma.kbIngestJob.create({ data: { runId: run.id, sourceId: source.id, documentId: doc.id, lane, reason: 'NEW', status: 'PENDING' } });
      };
      // 이 DB에는 앞선 시험이 남긴 PENDING 작업이 있을 수 있어 이 시험 소스의 작업만 본다.
      const only = <T extends { sourceId: string }>(j: T | null): T | null => (j && j.sourceId === source.id ? j : null);
      await prisma.kbIngestJob.updateMany({ where: { status: 'PENDING', sourceId: { not: source.id } }, data: { status: 'CANCELLED' } });

      const bulk = await mk('BULK');
      expect(only(await store.pickNextPendingJob(new Date(), false))).toBeNull();
      expect(only(await store.pickNextPendingJob(new Date(), true))?.id).toBe(bulk.id);
      const incremental = await mk('INCREMENTAL');
      expect(only(await store.pickNextPendingJob(new Date(), false))?.id).toBe(incremental.id);
      expect(only(await store.pickNextPendingJob(new Date(), true))?.id).toBe(incremental.id); // INCREMENTAL 먼저.
    });
  });

  describe('크롤 집계 · 스코프 변경 표시 · 관측 초기화', () => {
    it('countRunOutcomes — 이번 실행에서 본 행에서 discovered·visited·missing·gone·needsCleanup·piiMasked·excluded를 센다', async () => {
      const source = await prisma.kbSource.create({
        data: { name: `집계-${randomUUID().slice(0, 6)}`, nameNormalized: `outc-${randomUUID().slice(0, 6)}`, scopeCompany: 'c', scopeCategory: 'c', scopeSubcategory: 'c', rightsConfirmedById: 't', rightsConfirmedAt: new Date() },
      });
      const rid = randomUUID();
      const mk = (over: Record<string, unknown>) =>
        prisma.kbDocument.create({ data: { sourceId: source.id, url: `https://203.0.113.10/${randomUUID()}`, urlHash: randomUUID().slice(0, 16), kind: 'HTML', externalFileName: 'x.docx', seenRunId: rid, visitState: 'VISITED', ...over } });
      await mk({ state: 'ACTIVE', observedPiiMasked: 2 });
      await mk({ state: 'ACTIVE', observedPiiMasked: 3, missingStreak: 1 });
      await mk({ state: 'GONE', cleanupReason: 'GONE', missingStreak: 2 });
      await mk({ state: 'EXCLUDED', excludeReason: 'ROBOTS' });
      await mk({ state: 'EXCLUDED', excludeReason: 'ROBOTS' });
      await mk({ state: 'EXCLUDED', excludeReason: 'TYPE' });
      await mk({ state: 'ACTIVE', visitState: 'QUEUED' });
      await prisma.kbDocument.create({ data: { sourceId: source.id, url: `https://203.0.113.10/${randomUUID()}`, urlHash: randomUUID().slice(0, 16), kind: 'HTML', externalFileName: 'y.docx', seenRunId: randomUUID(), state: 'GONE' } }); // 다른 실행 — 세지 않는다.

      const out = await store.countRunOutcomes(source.id, rid);
      expect(out).toEqual({ discovered: 7, visited: 6, missing: 1, gone: 1, needsCleanup: 1, piiMasked: 5, excluded: { ROBOTS: 2, TYPE: 1 } });
    });

    it('addOutOfScopeLinks — 실행 행의 counts JSON에 누적한다(진행 중 CRAWLING일 때만)', async () => {
      const source = await prisma.kbSource.create({
        data: { name: `범위밖-${randomUUID().slice(0, 6)}`, nameNormalized: `oos-${randomUUID().slice(0, 6)}`, scopeCompany: 'c', scopeCategory: 'c', scopeSubcategory: 'c', rightsConfirmedById: 't', rightsConfirmedAt: new Date() },
      });
      const run = await prisma.kbSyncRun.create({ data: { id: randomUUID(), sourceId: source.id, sourceName: source.name, kind: 'SYNC', trigger: 'MANUAL', status: 'CRAWLING', configVersion: 1, counts: '{}' } });
      await store.addOutOfScopeLinks(run.id, 3);
      await store.addOutOfScopeLinks(run.id, 0);
      await store.addOutOfScopeLinks(run.id, 2);
      expect(JSON.parse((await prisma.kbSyncRun.findUnique({ where: { id: run.id } }))!.counts)).toEqual({ outOfScopeLinks: 5 });
    });

    it('markScopeChanged — 적재된 적 있는 ACTIVE 문서에만 SCOPE_CHANGED를 달고 다른 정리 사유는 덮지 않는다', async () => {
      const source = await prisma.kbSource.create({
        data: { name: `스코프-${randomUUID().slice(0, 6)}`, nameNormalized: `scope-${randomUUID().slice(0, 6)}`, scopeCompany: 'c', scopeCategory: 'c', scopeSubcategory: 'c', rightsConfirmedById: 't', rightsConfirmedAt: new Date() },
      });
      const mk = (over: Record<string, unknown>) =>
        prisma.kbDocument.create({ data: { sourceId: source.id, url: `https://203.0.113.10/${randomUUID()}`, urlHash: randomUUID().slice(0, 16), kind: 'HTML', externalFileName: 'x.docx', ...over } });
      const ingested = await mk({ lastIngestedAt: new Date() });
      const neverIngested = await mk({});
      const alreadyMarked = await mk({ lastIngestedAt: new Date(), cleanupReason: 'SHRUNK' });
      const gone = await mk({ lastIngestedAt: new Date(), state: 'GONE' });

      expect(await store.markScopeChanged(source.id)).toBe(1);
      const reason = async (id: string) => (await prisma.kbDocument.findUnique({ where: { id } }))?.cleanupReason;
      expect(await reason(ingested.id)).toBe('SCOPE_CHANGED');
      expect(await reason(neverIngested.id)).toBeNull();
      expect(await reason(alreadyMarked.id)).toBe('SHRUNK');
      expect(await reason(gone.id)).toBeNull();
    });
  });
});
