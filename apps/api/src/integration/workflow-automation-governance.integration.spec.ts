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
import { loginAs, seedTestUsers } from './helpers/auth.helper';

/**
 * [신규 No.41] 업무 자동화 워크플로우 — No.45(데이터 거버넌스) 상호작용 통합 시험(★ AC-WF5-5·AC-WF5-6).
 *
 * 근거: `docs/02-spec/workflow-automation-설계.md` §10.1(발송함 본문 = 암호화 대상 4번째) ·
 * §10.3(보존 = CALL_LOGS 편입) · `data-governance.integration.spec.ts`(No.45 선례 — 같은 기법:
 * `enc:v1:k1:` 접두 확인 · `retentionPolicy` 직접 upsert 후 `RetentionJob.tick()`).
 *
 * `workflow-automation-decrypt-failure.integration.spec.ts`는 **이미 암호화된(corrupted) 본문을
 * 직접 심어** 개봉 실패만 재현한다 — 이 파일은 그 앞 단계, 즉 **실제 적재 경로(공개 대화 → §4.7
 * enqueue → `sealField`)가 평문을 정말로 봉인해서 저장하는지**를 확인해 공백을 메운다. 보존(§10.3)은
 * `governance-data.writer.ts`의 `deleteCallLogsBatch()`가 `workflowRun`을 실제로 지우는지를
 * 확인한다(이전에는 코드만 있고 이 경로를 도는 시험이 없었다).
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

interface ApiResponse<T = unknown> {
  status: number;
  body: T;
}

function jsonRequest<T = unknown>(method: string, url: string, body?: unknown, headers: Record<string, string> = {}): Promise<ApiResponse<T>> {
  return new Promise((resolve, reject) => {
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    const { hostname, port, pathname, search } = new URL(url);
    const req = http.request(
      { method, hostname, port, path: pathname + search, headers: { ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}), ...headers } },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          let parsed: unknown;
          try {
            parsed = data ? JSON.parse(data) : undefined;
          } catch {
            parsed = data;
          }
          resolve({ status: res.statusCode ?? 0, body: parsed as T });
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

describe('업무 자동화 워크플로우(No.41) 통합 시험 — 데이터 거버넌스(No.45) 상호작용(★ AC-WF5-5 · AC-WF5-6)', () => {
  let app: NestExpressApplication | undefined;
  let tmpDir: string;
  let prisma: PrismaService;
  let baseUrl: string;
  let adminCookie = '';
  const writeKey = randomBytes(32).toString('base64');
  const TARGET_HOST = 'wf-gov-enc-test.example.invalid';

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'workflow-governance-test-'));
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
    process.env.DATA_EGRESS_ALLOWED_HOSTS = TARGET_HOST;
    process.env.DATA_RETENTION_JOB_ENABLED = 'false'; // tick()을 직접 호출한다.
    process.env.DATA_REENCRYPT_JOB_ENABLED = 'false';
    process.env.RETENTION_MIN_DAYS_CONVERSATION = '1';
    process.env.DATA_RETENTION_WINDOW = '00:00-00:00'; // No.45 선례 — 항상 창 안으로 취급된다.

    process.env.WORKFLOW_ENABLED = 'true';
    process.env.WORKFLOW_DISPATCH_ENABLED = 'false'; // 이 시험은 적재·보존만 본다 — 발송 루프 불필요.

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

    await app.listen(0);
    const server = app.getHttpServer() as http.Server;
    const address = server.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;
    baseUrl = `http://127.0.0.1:${port}/api/v1`;

    await seedTestUsers(prisma);
    adminCookie = await loginAs(baseUrl, 'ADMIN');

    (globalThis as Record<string, unknown>).__wfGovModuleRef = moduleRef;
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await safeCleanupTmpDir(tmpDir);
  }, 30_000);

  function admin<T = unknown>(method: string, path: string, body?: unknown): Promise<ApiResponse<T>> {
    return jsonRequest(method, `${baseUrl}${path}`, body, { Cookie: adminCookie });
  }

  it('★ AC-WF5-5 — 거버넌스 암호화 ON에서 실제 적재 경로(공개 대화 → §4.7)가 발송함 본문을 enc:v1:k1: 봉투로 저장한다', async () => {
    const targetRes = await admin<{ id: string }>('POST', '/workflow-targets', {
      name: `대상-${randomUUID().slice(0, 8)}`,
      baseUrl: `https://${TARGET_HOST}/hook`,
      signingEnabled: false,
    });
    expect(targetRes.status).toBe(201);
    const targetId = targetRes.body.id;

    const groupRes = await admin<{ id: string }>('POST', '/chatbot-groups', { name: `그룹-${randomUUID().slice(0, 8)}` });
    const slug = `wf-gov-enc-${randomUUID().slice(0, 8)}`;
    const botRes = await admin<{ id: string }>('POST', '/chatbots', { groupId: groupRes.body.id, name: '거버넌스암호화시험봇', slug });
    const chatbotId = botRes.body.id;
    const kwRes = await admin<{ id: string }>('POST', `/chatbots/${chatbotId}/keywords`, { name: '테스트키워드', synonyms: ['테스트키워드'] });
    await admin('POST', `/chatbots/${chatbotId}/dialog-nodes`, {
      name: '워크플로우노드',
      keywordIds: [kwRes.body.id],
      outputs: [
        { type: 'TEXT', payload: { text: '접수했어요.' } },
        { type: 'WORKFLOW', payload: { version: 1, targetId, actionKey: 'test.action', fields: [{ name: 'phone', value: { kind: 'CONST', value: '010-1234-5678' } }] } },
      ],
    });
    await admin('PATCH', `/chatbots/${chatbotId}/status`, { status: 'ACTIVE' });
    await admin('PATCH', `/chatbots/${chatbotId}/channels/WEB`, { enabled: true, config: { allowedOrigins: [], greetingMessage: '안녕' } });

    const msgRes = await jsonRequest('POST', `${baseUrl}/public/chatbots/${slug}/messages`, { sessionId: randomUUID(), message: '테스트키워드' });
    expect(msgRes.status).toBe(200);

    const row = await prisma.workflowRun.findFirst({ where: { targetId } });
    expect(row).not.toBeNull();
    expect(row!.status).toBe('PENDING');
    expect(row!.payload).not.toBeNull();
    // DB 원시 값은 평문이 아니라 암호화 봉투다(§10.1) — 대화 본문 소거 시험(AC-DG3-1)과 같은 접두 검사.
    expect(row!.payload!.startsWith('enc:v1:k1:')).toBe(true);
    expect(row!.payload!.includes('010-1234-5678')).toBe(false);

    // 개봉하면 원래 값(마스킹 여부와 무관하게 저장 전 평문 JSON)이 그대로 나온다.
    const { openField } = await import('../common/crypto/field-crypto');
    const opened = openField('WORKFLOW_PAYLOAD', row!.id, row!.payload!);
    expect(opened).not.toBeNull();
    expect(opened!.includes('010-1234-5678')).toBe(true); // CONST 필드는 마스킹 대상이 아니다(§11.1).
  });

  it('★ AC-WF5-6 — CALL_LOGS 보존 정책이 종단 상태(SUCCEEDED)의 오래된 실행 이력을 지우고, PENDING·최근 행은 남긴다', async () => {
    const { RetentionJob } = await import('../governance/jobs/retention.job');
    const moduleRef = (globalThis as Record<string, unknown>).__wfGovModuleRef as import('@nestjs/testing').TestingModule;
    const retentionJob = moduleRef.get(RetentionJob);

    const oldDate = new Date(Date.now() - 30 * 86_400_000);
    const now = new Date();

    const oldSucceeded = await prisma.workflowRun.create({
      data: {
        id: randomUUID(),
        targetId: 'target-purge-old',
        targetName: '보존시험대상',
        chatbotId: null,
        triggerKind: 'TEST',
        eventType: 'NODE_ACTION',
        status: 'SUCCEEDED',
        attemptCount: 1,
        personalDataMasked: false,
        fieldNames: '[]',
        payload: null,
        payloadPurgedAt: oldDate,
        completedAt: oldDate,
        dayBucket: toKstDayBucket(oldDate),
        createdAt: oldDate,
      },
    });
    const oldPending = await prisma.workflowRun.create({
      data: {
        id: randomUUID(),
        targetId: 'target-purge-old',
        targetName: '보존시험대상',
        chatbotId: null,
        triggerKind: 'TEST',
        eventType: 'NODE_ACTION',
        status: 'PENDING',
        attemptCount: 0,
        personalDataMasked: false,
        fieldNames: '[]',
        payload: null,
        dayBucket: toKstDayBucket(oldDate),
        createdAt: oldDate,
      },
    });
    const recentSucceeded = await prisma.workflowRun.create({
      data: {
        id: randomUUID(),
        targetId: 'target-purge-recent',
        targetName: '보존시험대상',
        chatbotId: null,
        triggerKind: 'TEST',
        eventType: 'NODE_ACTION',
        status: 'SUCCEEDED',
        attemptCount: 1,
        personalDataMasked: false,
        fieldNames: '[]',
        payload: null,
        payloadPurgedAt: now,
        completedAt: now,
        dayBucket: toKstDayBucket(now),
        createdAt: now,
      },
    });

    // 전역 보존 정책: CALL_LOGS 1일(유예 없이 즉시 반영 — No.45 AC-DG5-1 선례).
    await prisma.retentionPolicy.upsert({
      where: { scopeKey: 'GLOBAL' },
      create: { scopeKey: 'GLOBAL', days: JSON.stringify({ CALL_LOGS: 1 }), pending: '{}' },
      update: { days: JSON.stringify({ CALL_LOGS: 1 }), pending: '{}' },
    });

    await retentionJob.tick();

    expect(await prisma.workflowRun.findUnique({ where: { id: oldSucceeded.id } })).toBeNull();
    expect(await prisma.workflowRun.findUnique({ where: { id: oldPending.id } })).not.toBeNull(); // 종단 상태가 아니라 대상 제외.
    expect(await prisma.workflowRun.findUnique({ where: { id: recentSucceeded.id } })).not.toBeNull(); // 보존 기간 안 — 아직 대상 아님.
  }, 30_000);
});
