import { execSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import * as http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VersioningType } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { toKstDayBucket } from '@chat-bot/shared-types';
import { AllExceptionsFilter } from '../common/all-exceptions.filter';
import type { PrismaService } from '../prisma/prisma.service';
import { WorkflowDispatchJob } from '../workflow/dispatch/workflow-dispatch.job';

/**
 * 업무 자동화 워크플로우(No.41) — `DECRYPT_FAILED` 경로 통합 시험(코드 리뷰 R1 시험 공백 (d)).
 * `data-governance-decrypt-failure.integration.spec.ts` 선례와 같은 기법 — 키링에 없는 키 id로
 * 봉인된 `payload`를 직접 심어(`sealField` 우회) 개봉 실패를 재현한다(§10.1·§26 I-1).
 */

const API_ROOT = join(__dirname, '..', '..');

async function safeCleanupTmpDir(dir: string): Promise<void> {
  await new Promise((r) => setTimeout(r, 300));
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {
    // 정리 실패는 판정에 영향 없음(Windows 파일 핸들 지연 해제).
  }
}

describe('업무 자동화 워크플로우(No.41) 통합 시험 — DECRYPT_FAILED 경로', () => {
  let app: NestExpressApplication | undefined;
  let tmpDir: string;
  let prisma: PrismaService;
  let dispatchJob: WorkflowDispatchJob;
  const writeKey = randomBytes(32).toString('base64');

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'workflow-decrypt-fail-test-'));
    const dbPath = join(tmpDir, 'test.db').replace(/\\/g, '/');
    const testDatabaseUrl = `file:${dbPath}`;

    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.DEPLOY_SCHEDULE_ENABLED = 'false';
    process.env.HANDOFF_SWEEPER_ENABLED = 'false';
    process.env.WIDGET_BASE_URL = process.env.WIDGET_BASE_URL ?? 'http://localhost:5174';
    process.env.PUBLIC_API_BASE_URL = process.env.PUBLIC_API_BASE_URL ?? 'http://localhost:3000/api/v1';
    process.env.EMBEDDING_BASE_URL = '';
    process.env.RAG_BASE_URL = '';

    process.env.DATA_GOVERNANCE_MODE = 'ON';
    process.env.DATA_ENCRYPTION_ENABLED = 'true';
    process.env.DATA_ENCRYPTION_KEYS = `k1:${writeKey}`;
    process.env.DATA_EGRESS_ALLOWED_HOSTS = '';
    process.env.DATA_RETENTION_JOB_ENABLED = 'false';
    process.env.DATA_REENCRYPT_JOB_ENABLED = 'false';

    process.env.WORKFLOW_ENABLED = 'true';
    process.env.WORKFLOW_DISPATCH_ENABLED = 'false'; // 시험은 tick()을 직접 호출한다.

    try {
      execSync('pnpm exec prisma migrate deploy', { cwd: API_ROOT, env: { ...process.env, DATABASE_URL: testDatabaseUrl }, stdio: 'pipe' });
    } catch (e) {
      const err = e as { stdout?: Buffer; stderr?: Buffer };
      throw new Error(`prisma migrate deploy 실패:\n${err.stdout?.toString()}\n${err.stderr?.toString()}`);
    }

    const { AppModule } = await import('../app.module');
    const { PrismaService: PrismaServiceClass } = await import('../prisma/prisma.service');

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    app.enableCors();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalFilters(new AllExceptionsFilter());
    prisma = moduleRef.get(PrismaServiceClass);
    dispatchJob = moduleRef.get(WorkflowDispatchJob);

    await app.listen(0);
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await safeCleanupTmpDir(tmpDir);
  }, 15_000);

  it('키링에 없는 키(zz)로 봉인된 발송함 본문은 송신 0으로 FAILED(DECRYPT_FAILED)로 종결하고 본문을 보관한다(§26 I-1)', async () => {
    const { buildEnvelope, encryptWithKey } = await import('../common/crypto/field-envelope');
    const { buildFieldAad } = await import('../common/crypto/encrypted-fields');

    const runId = randomUUID();
    const now = new Date();
    const bogusKeyBytes = randomBytes(32); // 키링에 없는 임의의 32바이트 — keyId 'zz'는 키링에 없다.
    const corrupted = buildEnvelope('zz', encryptWithKey(bogusKeyBytes, buildFieldAad('WORKFLOW_PAYLOAD', runId), '{"eventType":"NODE_ACTION"}'));

    // 선점 계획(§7.2 step④)이 CLAIM으로 분류하려면 대상이 사용 중이어야 한다(개봉 실패는 claim 이후 —
    // dispatchOne의 첫 분기 — 발생하므로 대상 자체는 정상 상태로 둔다).
    const target = await prisma.workflowTarget.create({
      data: { name: `복호화실패대상-${randomUUID().slice(0, 8)}`, nameNormalized: `decrypt-fail-${randomUUID()}`, baseUrl: 'https://wf-decrypt-fail.example.invalid/hook' },
    });

    await prisma.workflowRun.create({
      data: {
        id: runId,
        targetId: target.id,
        targetName: target.name,
        chatbotId: null,
        triggerKind: 'NODE',
        eventType: 'NODE_ACTION',
        status: 'PENDING',
        nextAttemptAt: now,
        attemptCount: 0,
        personalDataMasked: false,
        fieldNames: '[]',
        payload: corrupted,
        payloadBytes: Buffer.byteLength(corrupted, 'utf8'),
        dayBucket: toKstDayBucket(now),
        createdAt: now,
      },
    });

    await dispatchJob.tick();

    const row = await prisma.workflowRun.findUnique({ where: { id: runId } });
    expect(row?.status).toBe('FAILED');
    expect(row?.statusReason).toBe('DECRYPT_FAILED');
    // 송신 자체가 없었다 — lastOutcome·firstSentAt이 비어 있다(I-1).
    expect(row?.lastOutcome).toBeNull();
    expect(row?.firstSentAt).toBeNull();
    // 본문은 그대로 보관된다(옛 키 복구 후 수동 재발송 가능 — §10.1 불변).
    expect(row?.payload).not.toBeNull();
    expect(row?.payloadPurgedAt).toBeNull();
  });
});
