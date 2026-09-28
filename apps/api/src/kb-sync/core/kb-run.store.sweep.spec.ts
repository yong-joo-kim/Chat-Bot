import { randomUUID } from 'node:crypto';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaService } from '../../prisma/prisma.service';
import { KbRunStore } from './kb-run.store';

/**
 * [R2 리뷰 신규 Medium — 항목②] `sweepExpiredSubmittingJobs()` 화이트박스 시험 — 슬롯 임대가
 * 만료됐는데 SUBMITTING에 멈춰 있는 작업을 되돌리는 방어선. 판단 근거(코드 주석에도 있음):
 * `recordSubmissionMeta`(→ `externalFileName` 기록)는 외부 RAG 호출 **바로 직전**에만 실행되므로
 * 그 필드가 비어 있으면 전송 시도 자체보다 먼저 멈춘 것이 확실해 PENDING(attempt 미소모)으로,
 * 이미 채워져 있으면 전송을 시도했을 수 있어(응답 처리 전 크래시) UNKNOWN으로 안전하게 종결한다.
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

describe('KbRunStore.sweepExpiredSubmittingJobs — R2 리뷰 신규 Medium 항목②', () => {
  let tmpDir: string;
  let prisma: PrismaService;
  let store: KbRunStore;
  let sourceId: string;
  let runId: string;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'chatbot-kb-run-store-sweep-test-'));
    const dbPath = join(tmpDir, 'test.db').replace(/\\/g, '/');
    const testDatabaseUrl = `file:${dbPath}`;
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

    const now = new Date();
    const source = await prisma.kbSource.create({
      data: {
        name: `스윕-소스-${randomUUID().slice(0, 8)}`,
        nameNormalized: `sweep-${randomUUID().slice(0, 8)}`,
        scopeCompany: '예시공사',
        scopeCategory: '테스트',
        scopeSubcategory: '스윕',
        rightsConfirmedById: 'tester',
        rightsConfirmedAt: now,
      },
    });
    sourceId = source.id;
    const run = await prisma.kbSyncRun.create({
      data: { id: randomUUID(), sourceId, sourceName: source.name, kind: 'SYNC', trigger: 'MANUAL', status: 'INGESTING', configVersion: 1, counts: '{}' },
    });
    runId = run.id;
  }, 30_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    await safeCleanupTmpDir(tmpDir);
  }, 15_000);

  async function makeSubmittingJob(opts: { slotName: string | null; externalFileName: string | null; token?: string }): Promise<string> {
    const doc = await prisma.kbDocument.create({
      data: { sourceId, url: `https://203.0.113.10/${randomUUID()}`, urlHash: randomUUID().replace(/-/g, '').slice(0, 16), kind: 'HTML', externalFileName: 'placeholder.docx' },
    });
    const job = await prisma.kbIngestJob.create({
      data: {
        runId,
        sourceId,
        documentId: doc.id,
        lane: 'INCREMENTAL',
        reason: 'NEW',
        status: 'SUBMITTING',
        attemptCount: 1,
        slotToken: opts.slotName ? `${opts.slotName}:${opts.token ?? randomUUID()}` : null,
        externalFileName: opts.externalFileName,
      },
    });
    return job.id;
  }

  it('슬롯 임대가 만료됐고 externalFileName이 비어 있으면(전송 전) PENDING으로 되돌리고 attempt를 소모하지 않는다', async () => {
    const slotName = `SLOT_EXPIRED_${randomUUID().slice(0, 8)}`;
    const staleClaimedAt = new Date(Date.now() - (LEASE_MS + 60_000));
    await prisma.kbJobLease.create({ data: { name: slotName, claimToken: 'stale-token', claimedAt: staleClaimedAt, holderJobId: 'someone' } });
    const jobId = await makeSubmittingJob({ slotName, externalFileName: null });

    const result = await store.sweepExpiredSubmittingJobs(LEASE_MS, new Date());
    expect(result.revertedToPending).toBeGreaterThanOrEqual(1);

    const job = await prisma.kbIngestJob.findUnique({ where: { id: jobId } });
    expect(job?.status).toBe('PENDING');
    expect(job?.slotToken).toBeNull();
    expect(job?.attemptCount).toBe(0); // 클레임(+1)과 되돌리기(-1)가 상쇄됐다.
  });

  it('★ 슬롯 임대가 만료됐지만 externalFileName이 채워져 있으면(전송 시도했을 가능성) UNKNOWN으로 종결한다', async () => {
    const slotName = `SLOT_EXPIRED_SENT_${randomUUID().slice(0, 8)}`;
    const staleClaimedAt = new Date(Date.now() - (LEASE_MS + 60_000));
    await prisma.kbJobLease.create({ data: { name: slotName, claimToken: 'stale-token-2', claimedAt: staleClaimedAt, holderJobId: 'someone' } });
    const jobId = await makeSubmittingJob({ slotName, externalFileName: 'kb_abcd1234_ffff0000aaaa1111.docx' });

    const result = await store.sweepExpiredSubmittingJobs(LEASE_MS, new Date());
    expect(result.markedUnknown).toBeGreaterThanOrEqual(1);

    const job = await prisma.kbIngestJob.findUnique({ where: { id: jobId } });
    expect(job?.status).toBe('UNKNOWN'); // 재시도(중복 적재 위험)하지 않고 종결했다.
  });

  it('슬롯 임대가 아직 살아 있으면(만료 전) 손대지 않는다', async () => {
    const slotName = `SLOT_ALIVE_${randomUUID().slice(0, 8)}`;
    await prisma.kbJobLease.create({ data: { name: slotName, claimToken: 'live-token', claimedAt: new Date(), holderJobId: 'someone' } });
    const jobId = await makeSubmittingJob({ slotName, externalFileName: null, token: 'live-token' });

    await store.sweepExpiredSubmittingJobs(LEASE_MS, new Date());

    const job = await prisma.kbIngestJob.findUnique({ where: { id: jobId } });
    expect(job?.status).toBe('SUBMITTING'); // 아직 만료 전이라 스윕이 손대지 않는다.
  });

  it('★ 임대는 살아 있어도 다른 토큰이 슬롯을 쥐고 있으면(이 작업의 보유자는 이미 슬롯을 잃었다) 멈춘 작업으로 보고 되돌린다', async () => {
    const slotName = `SLOT_TAKEN_OVER_${randomUUID().slice(0, 8)}`;
    await prisma.kbJobLease.create({ data: { name: slotName, claimToken: 'someone-elses-token', claimedAt: new Date(), holderJobId: 'someone' } });
    const jobId = await makeSubmittingJob({ slotName, externalFileName: null, token: 'my-old-token' });

    await store.sweepExpiredSubmittingJobs(LEASE_MS, new Date());

    const job = await prisma.kbIngestJob.findUnique({ where: { id: jobId } });
    expect(job?.status).toBe('PENDING');
  });

  it('slotToken 자체가 없는(비정상) SUBMITTING 작업도 멈춘 것으로 보고 되돌린다', async () => {
    const jobId = await makeSubmittingJob({ slotName: null, externalFileName: null });

    await store.sweepExpiredSubmittingJobs(LEASE_MS, new Date());

    const job = await prisma.kbIngestJob.findUnique({ where: { id: jobId } });
    expect(job?.status).toBe('PENDING');
  });
});
