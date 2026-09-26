import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import * as http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VersioningType } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { toKstDayBucket } from '@chat-bot/shared-types';
import { AllExceptionsFilter } from '../common/all-exceptions.filter';
import { PrismaService } from '../prisma/prisma.service';
import { loginAs, seedTestUsers } from './helpers/auth.helper';
import type { LegacyDnsResolver, LegacyTransport, LegacyTransportRequest, LegacyTransportResult } from '../legacy-api/transport/legacy-transport.port';
import { WORKFLOW_TRANSPORT, WORKFLOW_DNS_RESOLVER } from '../workflow/dispatch/workflow-http.sender';
import { WorkflowDispatchJob } from '../workflow/dispatch/workflow-dispatch.job';

/**
 * [신규 No.41] 업무 자동화 워크플로우 — 다중 인스턴스 안전성 통합 시험(★ AC-WF4-4 · AC-WF4-5).
 *
 * 근거: `docs/02-spec/workflow-automation-설계.md` §7.3(다중 인스턴스 안전성) · C-7(전달 의미 = 최소
 * 1회 + 멱등키) · `scheduled-deploy-multi-instance.integration.spec.ts`(No.28) 선례 — 같은 SQLite
 * 파일을 보는 완전히 별도의 Nest DI 컨테이너 2개(app1·app2)를 띄워 "컨테이너 2개"를 재현한다.
 *
 * 단일 앱 하네스(`workflow-automation.integration.spec.ts`)의 "중복 방지" 시험은 **같은
 * `WorkflowDispatchJob` 인스턴스**를 `Promise.all([dispatchJob.tick(), dispatchJob.tick()])`로 두 번
 * 부르는 것이라 "다른 인스턴스"를 완전히 재현하지 못한다(같은 프로세스 안 메모리 상태 공유). 이 파일은
 * **서로 다른 DI 컨테이너 2개**(각자의 `WorkflowDispatchJob`)가 같은 DB 행을 두고 경합하게 한다.
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

interface RecordedReceiverRequest {
  headers: http.IncomingHttpHeaders;
}

function startReceiver(requests: RecordedReceiverRequest[]): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        void raw;
        requests.push({ headers: { ...req.headers } });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{}');
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      resolve({ url: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(() => r())) });
    });
  });
}

function makeFakeDnsResolver(): LegacyDnsResolver {
  return {
    async lookupAll(): Promise<string[]> {
      return ['203.0.113.10']; // TEST-NET-3 — PUBLIC 분류
    },
  };
}

function makeFakeTransport(getReceiverUrl: () => string, counter: { calls: number }): LegacyTransport {
  return {
    request(req: LegacyTransportRequest): Promise<LegacyTransportResult> {
      counter.calls += 1;
      return new Promise((resolve) => {
        const target = new URL(req.url);
        const local = new URL(getReceiverUrl());
        const httpReq = http.request({ method: req.method, hostname: local.hostname, port: local.port, path: target.pathname + target.search, headers: req.headers }, (res) => {
          const status = res.statusCode ?? 0;
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => resolve({ kind: 'RESPONSE', status, contentType: res.headers['content-type'], bytes: Buffer.concat(chunks).length, body: Buffer.concat(chunks) }));
        });
        httpReq.on('error', () => resolve({ kind: 'ERROR', outcome: 'NETWORK_ERROR' }));
        if (req.body) httpReq.write(req.body);
        httpReq.end();
      });
    },
  };
}

describe('업무 자동화 워크플로우(No.41) 다중 인스턴스 통합 시험 — ★ AC-WF4-4 · AC-WF4-5', () => {
  let app1: NestExpressApplication;
  let app2: NestExpressApplication;
  let baseUrl1: string;
  let tmpDir: string;
  let prisma1: PrismaService;
  let dispatchJob1: WorkflowDispatchJob;
  let dispatchJob2: WorkflowDispatchJob;
  let receiver: { url: string; close: () => Promise<void> };
  const receiverRequests: RecordedReceiverRequest[] = [];
  const transportCounter1 = { calls: 0 };
  const transportCounter2 = { calls: 0 };
  let adminCookie = '';

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'workflow-multi-instance-test-'));
    const dbPath = join(tmpDir, 'test.db').replace(/\\/g, '/');
    const testDatabaseUrl = `file:${dbPath}`;

    receiver = await startReceiver(receiverRequests);

    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.DEPLOY_SCHEDULE_ENABLED = 'false';
    process.env.HANDOFF_SWEEPER_ENABLED = 'false';
    process.env.WIDGET_BASE_URL = process.env.WIDGET_BASE_URL ?? 'http://localhost:5174';
    process.env.PUBLIC_API_BASE_URL = process.env.PUBLIC_API_BASE_URL ?? 'http://localhost:3000/api/v1';
    delete process.env.EMBEDDING_BASE_URL;

    process.env.WORKFLOW_ENABLED = 'true';
    process.env.WORKFLOW_DISPATCH_ENABLED = 'false'; // 두 인스턴스 다 폴링 타이머 없이 수동 tick()만 쓴다.
    process.env.WORKFLOW_PRIVATE_ALLOWLIST = '';
    process.env.WORKFLOW_MAX_TIMEOUT_MS = '1000';
    process.env.WORKFLOW_CLAIM_LEASE_MS = '60000'; // WORKFLOW_MAX_TIMEOUT_MS(1000)+30000 하한(31000)보다 넉넉히 큰 값 — 자동 보정 없이 실측값 그대로 쓰인다. AC-WF4-5는 이 값보다 오래된 claimedAt을 심는다.

    try {
      execSync('pnpm exec prisma migrate deploy', { cwd: API_ROOT, env: { ...process.env, DATABASE_URL: testDatabaseUrl }, stdio: 'pipe' });
    } catch (e) {
      const err = e as { stdout?: Buffer; stderr?: Buffer };
      throw new Error(`prisma migrate deploy 실패:\n${err.stdout?.toString()}\n${err.stderr?.toString()}`);
    }

    const { AppModule } = await import('../app.module');

    // 인스턴스 1 — HTTP로 대상·챗봇·노드를 만들고 공개 대화도 이 인스턴스로 보낸다.
    const moduleRef1 = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(WORKFLOW_DNS_RESOLVER)
      .useValue(makeFakeDnsResolver())
      .overrideProvider(WORKFLOW_TRANSPORT)
      .useValue(makeFakeTransport(() => receiver.url, transportCounter1))
      .compile();
    app1 = moduleRef1.createNestApplication<NestExpressApplication>();
    app1.enableCors();
    app1.setGlobalPrefix('api');
    app1.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app1.useGlobalFilters(new AllExceptionsFilter());
    prisma1 = moduleRef1.get(PrismaService);
    dispatchJob1 = moduleRef1.get(WorkflowDispatchJob);

    await app1.listen(0);
    const server1 = app1.getHttpServer() as http.Server;
    const address1 = server1.address();
    const port1 = typeof address1 === 'object' && address1 !== null ? address1.port : 0;
    baseUrl1 = `http://127.0.0.1:${port1}/api/v1`;

    await seedTestUsers(prisma1);
    adminCookie = await loginAs(baseUrl1, 'ADMIN');

    // 인스턴스 2 — 같은 DATABASE_URL을 보는 완전히 별도의 DI 컨테이너("다른 컨테이너" 시뮬레이션).
    // HTTP 포트는 열지 않는다 — tick()만 직접 호출한다.
    const moduleRef2 = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(WORKFLOW_DNS_RESOLVER)
      .useValue(makeFakeDnsResolver())
      .overrideProvider(WORKFLOW_TRANSPORT)
      .useValue(makeFakeTransport(() => receiver.url, transportCounter2))
      .compile();
    app2 = moduleRef2.createNestApplication<NestExpressApplication>();
    await app2.init();
    dispatchJob2 = moduleRef2.get(WorkflowDispatchJob);
  }, 90_000);

  afterAll(async () => {
    await app1?.close();
    await app2?.close().catch(() => undefined);
    await receiver?.close();
    await safeCleanupTmpDir(tmpDir);
  }, 20_000);

  function admin<T = unknown>(method: string, path: string, body?: unknown): Promise<ApiResponse<T>> {
    return jsonRequest(method, `${baseUrl1}${path}`, body, { Cookie: adminCookie });
  }

  async function createTarget(): Promise<string> {
    const res = await admin<{ id: string }>('POST', '/workflow-targets', {
      name: `대상-${randomUUID().slice(0, 8)}`,
      baseUrl: 'https://wf-multi-instance.example.invalid/hook',
      signingEnabled: false,
      timeoutMs: 1000,
      maxAttempts: 5,
    });
    expect(res.status).toBe(201);
    return res.body.id;
  }

  async function createChatbotAndNodeWithWorkflow(targetId: string): Promise<{ slug: string }> {
    const groupRes = await admin<{ id: string }>('POST', '/chatbot-groups', { name: `그룹-${randomUUID().slice(0, 8)}` });
    const slug = `wf-multi-${randomUUID().slice(0, 8)}`;
    const botRes = await admin<{ id: string }>('POST', '/chatbots', { groupId: groupRes.body.id, name: '다중인스턴스시험봇', slug });
    const chatbotId = botRes.body.id;
    const kwRes = await admin<{ id: string }>('POST', `/chatbots/${chatbotId}/keywords`, { name: '테스트키워드', synonyms: ['테스트키워드'] });
    await admin('POST', `/chatbots/${chatbotId}/dialog-nodes`, {
      name: '워크플로우노드',
      keywordIds: [kwRes.body.id],
      outputs: [
        { type: 'TEXT', payload: { text: '접수했어요.' } },
        { type: 'WORKFLOW', payload: { version: 1, targetId, actionKey: 'test.action', fields: [] } },
      ],
    });
    await admin('PATCH', `/chatbots/${chatbotId}/status`, { status: 'ACTIVE' });
    await admin('PATCH', `/chatbots/${chatbotId}/channels/WEB`, { enabled: true, config: { allowedOrigins: [], greetingMessage: '안녕' } });
    return { slug };
  }

  it('★ AC-WF4-4 — 서로 다른 컨테이너 2개가 같은 대기 행에 동시에 tick()을 돌려도 1회만 발송된다(전송 목 호출 수 = 행 수)', async () => {
    const targetId = await createTarget();
    const { slug } = await createChatbotAndNodeWithWorkflow(targetId);
    await jsonRequest('POST', `${baseUrl1}/public/chatbots/${slug}/messages`, { sessionId: randomUUID(), message: '테스트키워드' });

    const pending = await prisma1.workflowRun.findFirst({ where: { targetId } });
    expect(pending?.status).toBe('PENDING');

    const before = receiverRequests.length;
    await Promise.all([dispatchJob1.tick(), dispatchJob2.tick()]);

    // 두 컨테이너 중 정확히 하나만 실제로 전송했다 — 총 수신 건수 = 새로 생긴 행 수(1).
    expect(receiverRequests.length).toBe(before + 1);
    const row = await prisma1.workflowRun.findUnique({ where: { id: pending!.id } });
    expect(row?.status).toBe('SUCCEEDED');
  });

  it('★ AC-WF4-5 — 임대(claim lease)가 만료된 SENDING 행을 다른 컨테이너가 회수해 같은 deliveryId로 재발송한다', async () => {
    const targetId = await createTarget();
    const runId = randomUUID();
    const now = new Date();
    // 인스턴스 1이 선점한 뒤(claimedAt) 프로세스가 죽어 임대(WORKFLOW_CLAIM_LEASE_MS=60000)가 만료된
    // 상태를 직접 재현한다(상대 시각 — CLAUDE.md: 절대 날짜 리터럴 금지).
    const staleClaimedAt = new Date(now.getTime() - 65_000);

    await prisma1.workflowRun.create({
      data: {
        id: runId,
        targetId,
        targetName: '임대만료대상',
        chatbotId: null,
        triggerKind: 'NODE',
        eventType: 'NODE_ACTION',
        actionKey: 'test.action',
        status: 'SENDING',
        attemptCount: 1,
        claimToken: 'stale-instance-1-token',
        claimedAt: staleClaimedAt,
        lastAttemptAt: staleClaimedAt,
        personalDataMasked: false,
        fieldNames: '[]',
        payload: '{"eventType":"NODE_ACTION"}',
        payloadBytes: 30,
        dayBucket: toKstDayBucket(now),
        createdAt: staleClaimedAt,
      },
    });

    const before = receiverRequests.length;
    // 인스턴스 2가 임대 만료를 회수해 재발송한다(인스턴스 1은 죽은 것으로 간주 — tick 호출 안 함).
    // §7.2 구현상 회수(SENDING → PENDING, nextAttemptAt=now)와 실제 재전송은 tick() 한 번에 다 이뤄지지
    // 않는다(이번 tick이 이미 읽어 둔 후보 목록은 회수 전 상태로 분류돼 있다) — 그래서 '다음 tick()'을
    // 두 번 부른다(첫 번째=회수, 두 번째=회수된 PENDING을 실제 선점·발송). 임대 만료 자체(회수)는 첫
    // 호출로 이미 일어난다는 점이 이 시험의 핵심이다.
    await dispatchJob2.tick();
    await dispatchJob2.tick();

    expect(receiverRequests.length).toBe(before + 1);
    const row = await prisma1.workflowRun.findUnique({ where: { id: runId } });
    expect(row?.status).toBe('SUCCEEDED');
    expect(row?.id).toBe(runId); // 같은 deliveryId(= id) 그대로 재발송됐다(멱등키 불변).
  });
});
