import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import * as http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VersioningType } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { AppModule as AppModuleType } from '../app.module';
import { Test } from '@nestjs/testing';
import { AllExceptionsFilter } from '../common/all-exceptions.filter';
import { PrismaService } from '../prisma/prisma.service';
import { loginAs, seedTestUsers } from './helpers/auth.helper';
import type { LegacyDnsResolver, LegacyTransport, LegacyTransportRequest, LegacyTransportResult } from '../legacy-api/transport/legacy-transport.port';
import { WORKFLOW_TRANSPORT, WORKFLOW_DNS_RESOLVER } from '../workflow/dispatch/workflow-http.sender';
import { CLOCK } from '../common/polling/clock';
import type { Clock } from '../common/polling/clock';
import { WorkflowDispatchJob, WORKFLOW_RANDOM } from '../workflow/dispatch/workflow-dispatch.job';
import { WorkflowTriggerService } from '../workflow/triggers/workflow-trigger.service';

/**
 * [신규 No.41] 업무 자동화 워크플로우 통합 시험 — `docs/02-spec/workflow-automation-설계.md` §21 근거.
 * SSRF 시험 기법은 No.26 선례(`legacy-api-integration.integration.spec.ts`)를 그대로 재사용한다 —
 * `WORKFLOW_DNS_RESOLVER`/`WORKFLOW_TRANSPORT`(발송기가 실제로 두 번째 DI 토큰으로 등록한 그 지점)를
 * 오버라이드해 ① 가짜 DNS로 시험 도메인을 공인/사설 주소로 위장 ② 가짜 전송이 그 뒤에서만 실제 소켓을
 * 로컬 목 수신 서버로 돌린다. 주소 분류·출구 게이트는 무수정으로 실행된다.
 *
 * ⚠ 선택 env(WORKFLOW_*)를 켜므로 `AppModule`을 동적 import한다(CLAUDE.md).
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
  headers: http.IncomingHttpHeaders;
  body: T;
}

function jsonRequest<T = unknown>(method: string, url: string, body?: unknown, headers: Record<string, string> = {}): Promise<ApiResponse<T>> {
  return new Promise((resolve, reject) => {
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    const { hostname, port, pathname, search } = new URL(url);
    const req = http.request(
      {
        method,
        hostname,
        port,
        path: pathname + search,
        headers: { ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}), ...headers },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          let parsed: unknown;
          try {
            parsed = data ? JSON.parse(data) : undefined;
          } catch {
            parsed = data;
          }
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: parsed as T });
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
  body: string;
}

type ReceiverScript = Array<{ status: number; headers?: Record<string, string>; body?: string }>;

/** 실제 node:http 수신 서버 — 응답 시나리오를 큐(script)로 미리 설정할 수 있다(재시도 시나리오용). */
function startReceiver(requests: RecordedReceiverRequest[], script: ReceiverScript): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        requests.push({ headers: { ...req.headers }, body: raw });
        const step = script.length > 0 ? script.shift()! : { status: 200 };
        res.writeHead(step.status, step.headers ?? { 'Content-Type': 'application/json' });
        res.end(step.body ?? '{}');
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
  const map: Record<string, string[]> = {
    'wf-receiver.example.invalid': ['203.0.113.10'], // TEST-NET-3 — PUBLIC 분류
    'wf-private-blocked.example.invalid': ['10.30.5.5'], // 사설 · WORKFLOW_PRIVATE_ALLOWLIST 밖
  };
  return {
    async lookupAll(hostname: string): Promise<string[]> {
      return map[hostname] ?? ['203.0.113.99'];
    },
  };
}

function makeFakeTransport(getReceiverUrl: () => string, counter: { calls: number }): LegacyTransport {
  return {
    request(req: LegacyTransportRequest): Promise<LegacyTransportResult> {
      counter.calls += 1;
      return new Promise((resolve) => {
        let settled = false;
        const finish = (r: LegacyTransportResult): void => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(r);
        };
        const timer = setTimeout(() => finish({ kind: 'ERROR', outcome: 'TIMEOUT' }), req.timeoutMs);
        const target = new URL(req.url);
        const local = new URL(getReceiverUrl());
        const httpReq = http.request(
          { method: req.method, hostname: local.hostname, port: local.port, path: target.pathname + target.search, headers: req.headers },
          (res) => {
            const status = res.statusCode ?? 0;
            if (status >= 300 && status < 400) {
              res.resume();
              finish({ kind: 'ERROR', outcome: 'REDIRECT_NOT_ALLOWED' });
              return;
            }
            const chunks: Buffer[] = [];
            let total = 0;
            res.on('data', (chunk: Buffer) => {
              total += chunk.length;
              if (total > req.maxBytes) {
                httpReq.destroy();
                return;
              }
              chunks.push(chunk);
            });
            res.on('end', () => {
              finish({ kind: 'RESPONSE', status, contentType: res.headers['content-type'], bytes: total, body: Buffer.concat(chunks), retryAfter: res.headers['retry-after'] as string | undefined });
            });
          },
        );
        httpReq.on('error', () => finish({ kind: 'ERROR', outcome: 'NETWORK_ERROR' }));
        if (req.body) httpReq.write(req.body);
        httpReq.end();
      });
    },
  };
}

class FakeClock implements Clock {
  // ★ 상대 시각(CLAUDE.md) — `offsetMs=0`인 동안은 실제 벽시계를 그대로 따른다(노드 방출 적재 시점의
  // 실제 `new Date()`와 어긋나지 않는다). `advance()`는 그 뒤로 오프셋만 더한다(백오프·보류 만료 시뮬레이션).
  private offsetMs = 0;
  now(): Date {
    return new Date(Date.now() + this.offsetMs);
  }
  advance(ms: number): void {
    this.offsetMs += ms;
  }
}

describe('업무 자동화 워크플로우(No.41) 통합 시험', () => {
  let app: NestExpressApplication;
  let baseUrl: string;
  let tmpDir: string;
  let prisma: PrismaService;
  let dispatchJob: WorkflowDispatchJob;
  let triggerService: WorkflowTriggerService;
  let receiver: { url: string; close: () => Promise<void> };
  const receiverRequests: RecordedReceiverRequest[] = [];
  const receiverScript: ReceiverScript = [];
  const transportCounter = { calls: 0 };
  const clock = new FakeClock();

  let adminCookie = '';
  let editorCookie = '';
  let agentCookie = '';

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'chatbot-workflow-test-'));
    const dbPath = join(tmpDir, 'test.db').replace(/\\/g, '/');
    const testDatabaseUrl = `file:${dbPath}`;

    receiver = await startReceiver(receiverRequests, receiverScript);

    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.DEPLOY_SCHEDULE_ENABLED = 'false';
    process.env.WIDGET_BASE_URL = process.env.WIDGET_BASE_URL ?? 'http://localhost:5174';
    process.env.PUBLIC_API_BASE_URL = process.env.PUBLIC_API_BASE_URL ?? 'http://localhost:3000/api/v1';
    delete process.env.EMBEDDING_BASE_URL;

    process.env.WORKFLOW_ENABLED = 'true';
    process.env.WORKFLOW_DISPATCH_ENABLED = 'false'; // 시험은 tick()을 직접 호출한다.
    process.env.WORKFLOW_PRIVATE_ALLOWLIST = '';
    process.env.WORKFLOW_MAX_TIMEOUT_MS = '1000';
    process.env.WORKFLOW_CLAIM_LEASE_MS = '10000';
    process.env.WORKFLOW_SECRET__WFTEST = 'wf-signing-secret-0123456789abcdef';

    try {
      execSync('pnpm exec prisma migrate deploy', { cwd: API_ROOT, env: { ...process.env, DATABASE_URL: testDatabaseUrl }, stdio: 'pipe' });
    } catch (e) {
      const err = e as { stdout?: Buffer; stderr?: Buffer };
      throw new Error(`prisma migrate deploy 실패:\n${err.stdout?.toString()}\n${err.stderr?.toString()}`);
    }

    const { AppModule } = (await import('../app.module')) as { AppModule: typeof AppModuleType };
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(WORKFLOW_DNS_RESOLVER)
      .useValue(makeFakeDnsResolver())
      .overrideProvider(WORKFLOW_TRANSPORT)
      .useValue(makeFakeTransport(() => receiver.url, transportCounter))
      .overrideProvider(CLOCK)
      .useValue(clock)
      .compile();

    app = moduleRef.createNestApplication<NestExpressApplication>();
    app.enableCors();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalFilters(new AllExceptionsFilter());
    prisma = moduleRef.get(PrismaService);
    dispatchJob = moduleRef.get(WorkflowDispatchJob);
    triggerService = moduleRef.get(WorkflowTriggerService);

    await app.listen(0);
    const server = app.getHttpServer() as http.Server;
    const address = server.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;
    baseUrl = `http://127.0.0.1:${port}/api/v1`;

    await seedTestUsers(prisma);
    adminCookie = await loginAs(baseUrl, 'ADMIN');
    editorCookie = await loginAs(baseUrl, 'EDITOR');
    agentCookie = await loginAs(baseUrl, 'AGENT');
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await receiver?.close();
    await safeCleanupTmpDir(tmpDir);
  }, 15_000);

  function admin<T = unknown>(method: string, path: string, body?: unknown): Promise<ApiResponse<T>> {
    return jsonRequest(method, `${baseUrl}${path}`, body, { Cookie: adminCookie });
  }
  function editor<T = unknown>(method: string, path: string, body?: unknown): Promise<ApiResponse<T>> {
    return jsonRequest(method, `${baseUrl}${path}`, body, { Cookie: editorCookie });
  }
  function agent<T = unknown>(method: string, path: string, body?: unknown): Promise<ApiResponse<T>> {
    return jsonRequest(method, `${baseUrl}${path}`, body, { Cookie: agentCookie });
  }

  async function createTarget(overrides: Partial<Record<string, unknown>> = {}): Promise<string> {
    const res = await admin<{ id: string }>('POST', '/workflow-targets', {
      name: `대상-${randomUUID().slice(0, 8)}`,
      baseUrl: 'https://wf-receiver.example.invalid/hook',
      signingEnabled: true,
      signingSecretRef: 'WFTEST',
      timeoutMs: 1000,
      maxAttempts: 5,
      ...overrides,
    });
    expect(res.status).toBe(201);
    return res.body.id;
  }

  async function createChatbotAndNodeWithWorkflow(targetId: string): Promise<{ chatbotId: string; slug: string }> {
    const groupRes = await admin<{ id: string }>('POST', '/chatbot-groups', { name: `그룹-${randomUUID().slice(0, 8)}` });
    const slug = `wf-bot-${randomUUID().slice(0, 8)}`;
    const botRes = await admin<{ id: string }>('POST', '/chatbots', { groupId: groupRes.body.id, name: '워크플로우 테스트봇', slug });
    const chatbotId = botRes.body.id;

    const kwRes = await admin<{ id: string }>('POST', `/chatbots/${chatbotId}/keywords`, { name: '테스트키워드', synonyms: ['테스트키워드'] });
    await admin('POST', `/chatbots/${chatbotId}/dialog-nodes`, {
      name: '워크플로우노드',
      keywordIds: [kwRes.body.id],
      outputs: [
        { type: 'TEXT', payload: { text: '요청을 접수했어요.' } },
        { type: 'WORKFLOW', payload: { version: 1, targetId, actionKey: 'test.action', fields: [{ name: 'a', value: { kind: 'CONST', value: '상수값' } }] } },
      ],
    });
    await admin('PATCH', `/chatbots/${chatbotId}/status`, { status: 'ACTIVE' });
    await admin('PATCH', `/chatbots/${chatbotId}/channels/WEB`, { enabled: true, config: { allowedOrigins: [], greetingMessage: '안녕하세요' } });
    return { chatbotId, slug };
  }

  it('노드 발송 E2E — 공개 대화에서 WORKFLOW 방출 → tick() → 실 수신 서버가 서명된 요청을 받는다', async () => {
    receiverScript.length = 0;
    const targetId = await createTarget();
    const { slug } = await createChatbotAndNodeWithWorkflow(targetId);

    const before = receiverRequests.length;
    const msgRes = await jsonRequest('POST', `${baseUrl}/public/chatbots/${slug}/messages`, { sessionId: randomUUID(), message: '테스트키워드' });
    expect(msgRes.status).toBe(200);

    // 적재는 await되므로(§6.1) 바로 PENDING 행이 있어야 한다.
    const pending = await prisma.workflowRun.findFirst({ where: { targetId, triggerKind: 'NODE' } });
    expect(pending?.status).toBe('PENDING');

    await dispatchJob.tick();

    expect(receiverRequests.length).toBe(before + 1);
    const last = receiverRequests[receiverRequests.length - 1];
    expect(last.headers['x-chatbot-delivery']).toBeDefined();
    expect(last.headers['idempotency-key']).toBe(last.headers['x-chatbot-delivery']);
    expect(String(last.headers['x-chatbot-signature'])).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
    const parsed = JSON.parse(last.body);
    expect(parsed.eventType).toBe('NODE_ACTION');
    expect(parsed.fields.a).toBe('상수값');
    expect(parsed.chatbot).toBeTruthy();

    const row = await prisma.workflowRun.findUnique({ where: { id: pending!.id } });
    expect(row?.status).toBe('SUCCEEDED');
    expect(row?.payload).toBeNull();
  });

  it('중복 방지 — 같은 대기 행을 두 번 tick해도 중복 발송되지 않는다(선점 CAS)', async () => {
    receiverScript.length = 0;
    const targetId = await createTarget();
    const { slug } = await createChatbotAndNodeWithWorkflow(targetId);
    await jsonRequest('POST', `${baseUrl}/public/chatbots/${slug}/messages`, { sessionId: randomUUID(), message: '테스트키워드' });

    const before = receiverRequests.length;
    await Promise.all([dispatchJob.tick(), dispatchJob.tick()]);
    expect(receiverRequests.length).toBe(before + 1);
  });

  it('재시도 — 503(Retry-After) 뒤 재시도, 같은 X-Chatbot-Delivery로 재발송된다(AC-WF4-1/4-3)', async () => {
    receiverScript.length = 0;
    receiverScript.push({ status: 503, headers: { 'Retry-After': '30' } });
    const targetId = await createTarget();
    const { slug } = await createChatbotAndNodeWithWorkflow(targetId);
    await jsonRequest('POST', `${baseUrl}/public/chatbots/${slug}/messages`, { sessionId: randomUUID(), message: '테스트키워드' });

    // [test-automation 2026-09-26 — No.41 3회 회귀 확인 중 재현] 서버가 nextAttemptAt를 계산할 때 쓰는
    // clock.now()는 tick() 내부(실 HTTP 왕복·DB 쓰기보다 앞)에서 캡처된다 — tick() 완료 뒤(§처리 지연
    // 포함)의 clock.now()를 기준으로 재면 전체 스위트 부하 시 처리 지연(수백ms~1초 이상)만큼 30000ms에
    // 못 미치는 값이 나와 간헐 실패했다(28550 관측). tick() 호출 **직전** 시각을 기준으로 재야 처리
    // 지연과 무관하게 항상 30000ms 이상이 보장된다(위쪽 여유는 스케줄링 지연만 허용하면 되므로 좁게 둔다).
    const beforeTick = clock.now();
    await dispatchJob.tick();
    const afterFirst = await prisma.workflowRun.findFirst({ where: { targetId }, orderBy: { createdAt: 'desc' } });
    expect(afterFirst?.status).toBe('PENDING');
    expect(afterFirst?.attemptCount).toBe(1);
    const firstDeliveryId = afterFirst!.id;
    const nextAttemptMs = afterFirst!.nextAttemptAt!.getTime() - beforeTick.getTime();
    expect(nextAttemptMs).toBeGreaterThan(29_000);
    expect(nextAttemptMs).toBeLessThan(33_000);

    clock.advance(31_000);
    await dispatchJob.tick();
    const afterSecond = await prisma.workflowRun.findUnique({ where: { id: firstDeliveryId } });
    expect(afterSecond?.status).toBe('SUCCEEDED');
    const lastTwo = receiverRequests.slice(-2);
    expect(lastTwo[0].headers['x-chatbot-delivery']).toBe(lastTwo[1].headers['x-chatbot-delivery']);
  });

  it('영구 실패 후 재발송 — 404는 영구 실패, 관리자 재발송 API로 같은 본문이 다시 나간다(§7.7)', async () => {
    receiverScript.length = 0;
    receiverScript.push({ status: 404 });
    const targetId = await createTarget();
    const { chatbotId, slug } = await createChatbotAndNodeWithWorkflow(targetId);
    await jsonRequest('POST', `${baseUrl}/public/chatbots/${slug}/messages`, { sessionId: randomUUID(), message: '테스트키워드' });

    await dispatchJob.tick();
    const failed = await prisma.workflowRun.findFirst({ where: { targetId }, orderBy: { createdAt: 'desc' } });
    expect(failed?.status).toBe('FAILED');
    expect(failed?.statusReason).toBe('PERMANENT_ERROR');

    receiverScript.push({ status: 200 });
    const retryRes = await admin('POST', `/chatbots/${chatbotId}/workflow-runs/retry`, { runIds: [failed!.id] });
    expect([200, 201]).toContain(retryRes.status);
    const afterRetryReq = await prisma.workflowRun.findUnique({ where: { id: failed!.id } });
    expect(afterRetryReq?.status).toBe('PENDING');
    expect(afterRetryReq?.manualRetryCount).toBe(1);

    await dispatchJob.tick();
    const finalRow = await prisma.workflowRun.findUnique({ where: { id: failed!.id } });
    expect(finalRow?.status).toBe('SUCCEEDED');
  });

  it('일시 정지 — 보류 후 재개 시 발송된다(§7.6)', async () => {
    receiverScript.length = 0;
    const targetId = await createTarget();
    await admin('POST', `/workflow-targets/${targetId}/pause`);
    const { slug } = await createChatbotAndNodeWithWorkflow(targetId);
    await jsonRequest('POST', `${baseUrl}/public/chatbots/${slug}/messages`, { sessionId: randomUUID(), message: '테스트키워드' });

    const held = await prisma.workflowRun.findFirst({ where: { targetId }, orderBy: { createdAt: 'desc' } });
    expect(held?.status).toBe('HELD');
    expect(held?.holdReason).toBe('TARGET');

    await admin('POST', `/workflow-targets/${targetId}/resume`);
    const resumed = await prisma.workflowRun.findUnique({ where: { id: held!.id } });
    expect(resumed?.status).toBe('PENDING');

    await dispatchJob.tick();
    const finalRow = await prisma.workflowRun.findUnique({ where: { id: held!.id } });
    expect(finalRow?.status).toBe('SUCCEEDED');
  });

  it('SSRF 사설 대역 차단 — allowlist 밖 사설 주소는 송신 0으로 영구 실패한다', async () => {
    receiverScript.length = 0;
    const targetId = await createTarget({ baseUrl: 'https://wf-private-blocked.example.invalid/hook' });
    const { slug } = await createChatbotAndNodeWithWorkflow(targetId);
    const before = receiverRequests.length;
    await jsonRequest('POST', `${baseUrl}/public/chatbots/${slug}/messages`, { sessionId: randomUUID(), message: '테스트키워드' });

    await dispatchJob.tick();
    expect(receiverRequests.length).toBe(before);
    const row = await prisma.workflowRun.findFirst({ where: { targetId }, orderBy: { createdAt: 'desc' } });
    expect(row?.status).toBe('FAILED');
    expect(row?.lastOutcome).toBe('BLOCKED_ADDRESS');
  });

  it('권한 — AGENT는 챗봇 스코프 구독·이력 조회가 403이다(dialogue:read 없음)', async () => {
    const targetId = await createTarget();
    const { chatbotId } = await createChatbotAndNodeWithWorkflow(targetId);
    const res = await agent('GET', `/chatbots/${chatbotId}/workflow-subscriptions`);
    expect(res.status).toBe(403);
    const res2 = await agent('GET', `/chatbots/${chatbotId}/workflow-runs`);
    expect(res2.status).toBe(403);
  });

  it('권한 — EDITOR는 발송 대상 CRUD가 403이다(security:write 없음)', async () => {
    const res = await editor('POST', '/workflow-targets', { name: '거부대상', baseUrl: 'https://wf-receiver.example.invalid/hook' });
    expect(res.status).toBe(403);
  });

  it('코드 리뷰 R1 M-1 — http 스킴 대상은 기본값(WORKFLOW_ALLOW_HTTP=false)에서 400 VALIDATION_FAILED다', async () => {
    const res = await admin<{ code: string }>('POST', '/workflow-targets', { name: `http거부-${randomUUID().slice(0, 8)}`, baseUrl: 'http://wf-receiver.example.invalid/hook' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
  });

  async function createGroupAndChatbot(namePrefix: string): Promise<{ chatbotId: string; slug: string; name: string }> {
    const groupRes = await admin<{ id: string }>('POST', '/chatbot-groups', { name: `그룹-${namePrefix}-${randomUUID().slice(0, 8)}` });
    const slug = `wf-${namePrefix}-${randomUUID().slice(0, 8)}`;
    const name = `${namePrefix}테스트봇`;
    const botRes = await admin<{ id: string }>('POST', '/chatbots', { groupId: groupRes.body.id, name, slug });
    const chatbotId = botRes.body.id;
    await admin('PATCH', `/chatbots/${chatbotId}/status`, { status: 'ACTIVE' });
    return { chatbotId, slug, name };
  }

  async function enableWebChannel(chatbotId: string, extraConfig: Record<string, unknown> = {}): Promise<void> {
    await admin('PATCH', `/chatbots/${chatbotId}/channels/WEB`, { enabled: true, config: { allowedOrigins: [], greetingMessage: '안녕하세요', ...extraConfig } });
  }

  async function enableHandoff(chatbotId: string, overrides: Record<string, unknown> = {}): Promise<void> {
    const res = await admin('PUT', `/chatbots/${chatbotId}/handoff-settings`, {
      enabled: true,
      cautionThreshold: 1,
      warningThreshold: 2,
      activeWindowMinutes: 10,
      userIdleMinutes: 10,
      agentNoReplyMinutes: 5,
      connectNotice: '상담원이 연결되었어요.',
      endNotice: '상담이 종료되었어요.',
      failNotice: '연결이 어려워요.',
      ...overrides,
    });
    expect(res.status).toBe(200);
  }

  /** conversationLog 쓰기(TURN_LOGGED 발행원)가 응답 뒤 잠깐 지연될 수 있어 짧게 폴링한다(선례 — feedback-loop). */
  async function waitForLogRow(messageId: string): Promise<void> {
    const deadline = Date.now() + 5000;
    for (;;) {
      const row = await prisma.conversationLog.findUnique({ where: { id: messageId } });
      if (row) return;
      if (Date.now() >= deadline) throw new Error(`conversationLog 대기 시간 초과: ${messageId}`);
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  /**
   * ★ `receiverRequests`는 이 파일의 모든 대상이 같은 실 수신 서버로 몰리는 **전역 로그**다 — 여러
   * 이벤트 시험이 같은 tick에서 동시에(`Promise.all`) 발송되면 도착 순서가 뒤섞일 수 있다. 그래서
   * "마지막 요청"이 아니라 **봉투 `deliveryId`(= 그 `WorkflowRun.id`)로 정확히 찾는다**(§4.3).
   */
  function findEnvelopeByDeliveryId(deliveryId: string): Record<string, unknown> {
    for (let i = receiverRequests.length - 1; i >= 0; i -= 1) {
      const parsed = JSON.parse(receiverRequests[i].body) as Record<string, unknown>;
      if (parsed.deliveryId === deliveryId) return parsed;
    }
    throw new Error(`수신 서버 요청 중 deliveryId=${deliveryId}를 찾지 못했습니다.`);
  }

  describe('구독 이벤트(§6.2) — 5종 이벤트 E2E(코드 리뷰 R1 시험 공백 (a))', () => {
    it('HANDOFF_STARTED/HANDOFF_ENDED가 각 1회 적재되고 chatbot·data가 채워진다(H-1 회귀 확인 포함)', async () => {
      receiverScript.length = 0;
      const targetId = await createTarget();
      const { chatbotId, slug, name } = await createGroupAndChatbot('handoff');
      await enableWebChannel(chatbotId);
      await enableHandoff(chatbotId);
      expect((await admin('POST', `/chatbots/${chatbotId}/workflow-subscriptions`, { eventType: 'HANDOFF_STARTED', targetId })).status).toBe(201);
      expect((await admin('POST', `/chatbots/${chatbotId}/workflow-subscriptions`, { eventType: 'HANDOFF_ENDED', targetId })).status).toBe(201);

      const sessionId = randomUUID();
      await jsonRequest('POST', `${baseUrl}/public/chatbots/${slug}/messages`, { sessionId, message: '이해할 수 없는 질문입니다' });
      const listRes = await admin<{ items: Array<{ sessionRef: string }> }>('GET', `/chatbots/${chatbotId}/live-sessions`);
      expect(listRes.body.items.length).toBeGreaterThan(0);
      const sessionRef = listRes.body.items[0].sessionRef;
      const intervened = await agent<{ id: string }>('POST', `/chatbots/${chatbotId}/live-sessions/${sessionRef}/handoff`, {});
      expect(intervened.status).toBe(201);
      const handoffId = intervened.body.id;

      await triggerService.drainForTest();
      const startedRuns = await prisma.workflowRun.findMany({ where: { chatbotId, eventType: 'HANDOFF_STARTED' } });
      expect(startedRuns).toHaveLength(1); // 1회만 적재(§6.2 1회 발행 보장).
      expect(startedRuns[0].status).toBe('PENDING');

      await dispatchJob.tick();
      const startedBody = findEnvelopeByDeliveryId(startedRuns[0].id) as { eventType: string; chatbot: unknown; data: { handoffId: string; consecutiveUnansweredAtStart: number } };
      expect(startedBody.eventType).toBe('HANDOFF_STARTED');
      expect(startedBody.chatbot).toEqual({ id: chatbotId, name }); // ★ H-1 — chatbot이 더 이상 null이 아니다.
      expect(startedBody.data.handoffId).toBe(handoffId);
      expect(typeof startedBody.data.consecutiveUnansweredAtStart).toBe('number');

      const endRes = await agent('POST', `/chatbots/${chatbotId}/handoffs/${handoffId}/end`, {});
      expect([200, 201]).toContain(endRes.status);

      await triggerService.drainForTest();
      const endedRuns = await prisma.workflowRun.findMany({ where: { chatbotId, eventType: 'HANDOFF_ENDED' } });
      expect(endedRuns).toHaveLength(1);

      await dispatchJob.tick();
      const endedBody = findEnvelopeByDeliveryId(endedRuns[0].id) as { chatbot: unknown; data: { handoffId: string; endReason: string; durationSeconds: number } };
      expect(endedBody.chatbot).toEqual({ id: chatbotId, name });
      expect(endedBody.data.handoffId).toBe(handoffId);
      expect(endedBody.data.endReason).toBe('AGENT_ENDED');
      expect(typeof endedBody.data.durationSeconds).toBe('number');
    });

    it('AC-WF3-1 — 상담 종료 요청이 동시에 두 번 들어와도(정리 루프와의 경합 시뮬레이션) HANDOFF_ENDED는 1행만 생긴다', async () => {
      receiverScript.length = 0;
      const targetId = await createTarget();
      const { chatbotId, slug } = await createGroupAndChatbot('race');
      await enableWebChannel(chatbotId);
      await enableHandoff(chatbotId);
      await admin('POST', `/chatbots/${chatbotId}/workflow-subscriptions`, { eventType: 'HANDOFF_ENDED', targetId });

      const sessionId = randomUUID();
      await jsonRequest('POST', `${baseUrl}/public/chatbots/${slug}/messages`, { sessionId, message: '이해할 수 없는 질문입니다' });
      const listRes = await admin<{ items: Array<{ sessionRef: string }> }>('GET', `/chatbots/${chatbotId}/live-sessions`);
      const sessionRef = listRes.body.items[0].sessionRef;
      const intervened = await agent<{ id: string }>('POST', `/chatbots/${chatbotId}/live-sessions/${sessionRef}/handoff`, {});
      const handoffId = intervened.body.id;

      // 상담원 종료(컨트롤러 경로)와 정리 루프 종료(같은 thread.endHandoff() 경로 — handoff-sweeper.service.ts
      // 102행)는 동일 함수를 호출한다 — 같은 엔드포인트를 동시에 두 번 호출해 그 경합을 재현한다.
      const [r1, r2] = await Promise.all([
        agent('POST', `/chatbots/${chatbotId}/handoffs/${handoffId}/end`, {}),
        agent('POST', `/chatbots/${chatbotId}/handoffs/${handoffId}/end`, {}),
      ]);
      const statuses = [r1.status, r2.status].sort((a, b) => a - b);
      expect([200, 201]).toContain(statuses[0]); // 하나만 CAS를 쥐고 성공한다.
      expect(statuses[1]).toBe(409); // 나머지 하나는 실패(HANDOFF_NOT_ACTIVE) — CAS를 놓쳤다.

      await triggerService.drainForTest();
      const endedRuns = await prisma.workflowRun.findMany({ where: { chatbotId, eventType: 'HANDOFF_ENDED' } });
      expect(endedRuns).toHaveLength(1);
    });

    it('SURVEY_COMPLETED가 1회 적재되고 answers가 실린다(includeStructuredAnswers=true)', async () => {
      receiverScript.length = 0;
      const targetId = await createTarget();
      const { chatbotId, slug, name } = await createGroupAndChatbot('survey');
      await enableWebChannel(chatbotId);
      const intentRes = await admin<{ intent: { id: string } }>('POST', `/chatbots/${chatbotId}/intents`, { name: '설문요청', examples: ['만족도 조사 참여할래요'] });
      const surveyRes = await admin<{ id: string }>('POST', `/chatbots/${chatbotId}/surveys`, {
        name: '워크플로우 설문',
        questions: [
          { type: 'SCALE', prompt: '만족도를 알려주세요.', required: true, scale: 'STAR_5' },
          { type: 'MULTI_CHOICE', prompt: '이유를 모두 골라주세요.', required: true, minSelect: 1, maxSelect: 2, choices: [{ label: '속도' }, { label: '친절도' }, { label: '가격' }] },
        ],
      });
      expect(surveyRes.status).toBe(201);
      const surveyId = surveyRes.body.id;
      await admin('PATCH', `/chatbots/${chatbotId}/surveys/${surveyId}`, { status: 'OPEN' });
      await admin('POST', `/chatbots/${chatbotId}/dialog-nodes`, { name: '설문노드', intentIds: [intentRes.body.intent.id], outputs: [{ type: 'SURVEY', payload: { version: 2, surveyId } }] });
      expect((await admin('POST', `/chatbots/${chatbotId}/workflow-subscriptions`, { eventType: 'SURVEY_COMPLETED', targetId, conditions: { includeStructuredAnswers: true } })).status).toBe(
        201,
      );

      const sessionId = randomUUID();
      const t0 = await jsonRequest<{ state: unknown }>('POST', `${baseUrl}/public/chatbots/${slug}/messages`, { sessionId, message: '만족도 조사 참여할래요' });
      const t1 = await jsonRequest<{ state: unknown }>('POST', `${baseUrl}/public/chatbots/${slug}/messages`, { sessionId, message: '5점', state: t0.body.state });
      const t2 = await jsonRequest<{ state: unknown }>('POST', `${baseUrl}/public/chatbots/${slug}/messages`, { sessionId, message: '속도', state: t1.body.state });
      expect((t2.body.state as { surveySession?: unknown }).surveySession).toBeUndefined(); // 완주 확인.

      await triggerService.drainForTest();
      const runs = await prisma.workflowRun.findMany({ where: { chatbotId, eventType: 'SURVEY_COMPLETED' } });
      expect(runs).toHaveLength(1);

      await dispatchJob.tick();
      const body = findEnvelopeByDeliveryId(runs[0].id) as { chatbot: unknown; data: { surveyId: string; isDuplicate: boolean; answers: unknown[] } };
      expect(body.chatbot).toEqual({ id: chatbotId, name });
      expect(body.data.surveyId).toBe(surveyId);
      expect(body.data.isDuplicate).toBe(false);
      expect(Array.isArray(body.data.answers)).toBe(true);
      expect(body.data.answers.length).toBeGreaterThan(0);
    });

    it('FEEDBACK_NEGATIVE가 1회 적재되고 data.feedbackId·messageId가 채워진다', async () => {
      receiverScript.length = 0;
      const targetId = await createTarget();
      const { chatbotId, slug, name } = await createGroupAndChatbot('feedback');
      await enableWebChannel(chatbotId, { feedbackEnabled: true });
      expect((await admin('POST', `/chatbots/${chatbotId}/workflow-subscriptions`, { eventType: 'FEEDBACK_NEGATIVE', targetId })).status).toBe(201);

      const sessionId = randomUUID();
      const sendRes = await jsonRequest<{ messageId: string }>('POST', `${baseUrl}/public/chatbots/${slug}/messages`, {
        sessionId,
        message: '해외배송 되나요',
        features: ['feedback-v1'],
      });
      expect(sendRes.status).toBe(200);
      const messageId = sendRes.body.messageId;
      await waitForLogRow(messageId);

      const putRes = await jsonRequest<{ rating: string }>('PUT', `${baseUrl}/public/chatbots/${slug}/messages/${messageId}/feedback`, { sessionId, rating: 'DOWN' });
      expect(putRes.status).toBe(200);

      await triggerService.drainForTest();
      const runs = await prisma.workflowRun.findMany({ where: { chatbotId, eventType: 'FEEDBACK_NEGATIVE' } });
      expect(runs).toHaveLength(1);

      await dispatchJob.tick();
      const body = findEnvelopeByDeliveryId(runs[0].id) as { chatbot: unknown; data: { messageId: string; feedbackId: string } };
      expect(body.chatbot).toEqual({ id: chatbotId, name });
      expect(body.data.messageId).toBe(messageId);
      expect(typeof body.data.feedbackId).toBe('string');
    });

    it('UNANSWERED_STREAK가 임계값(threshold=2) 도달 시 세션당 1회만 적재된다', async () => {
      receiverScript.length = 0;
      const targetId = await createTarget();
      const { chatbotId, slug, name } = await createGroupAndChatbot('streak');
      await enableWebChannel(chatbotId);
      expect(
        (await admin('POST', `/chatbots/${chatbotId}/workflow-subscriptions`, { eventType: 'UNANSWERED_STREAK', targetId, conditions: { threshold: 2 } })).status,
      ).toBe(201);

      const sessionId = randomUUID();
      const first = await jsonRequest<{ messageId: string }>('POST', `${baseUrl}/public/chatbots/${slug}/messages`, { sessionId, message: '알수없는아무말123' });
      await waitForLogRow(first.body.messageId);
      const second = await jsonRequest<{ messageId: string }>('POST', `${baseUrl}/public/chatbots/${slug}/messages`, { sessionId, message: '또다른아무말456' });
      await waitForLogRow(second.body.messageId);

      await triggerService.drainForTest();
      let runs = await prisma.workflowRun.findMany({ where: { chatbotId, eventType: 'UNANSWERED_STREAK' } });
      expect(runs).toHaveLength(1); // 2회째(threshold 도달)에 적재.

      // 세 번째 미응답 — 세션당 1회 유일 키(dedupeKey)라 추가 적재가 없다(S-4).
      const third = await jsonRequest<{ messageId: string }>('POST', `${baseUrl}/public/chatbots/${slug}/messages`, { sessionId, message: '세번째아무말789' });
      await waitForLogRow(third.body.messageId);
      await triggerService.drainForTest();
      runs = await prisma.workflowRun.findMany({ where: { chatbotId, eventType: 'UNANSWERED_STREAK' } });
      expect(runs).toHaveLength(1);

      await dispatchJob.tick();
      const body = findEnvelopeByDeliveryId(runs[0].id) as { chatbot: unknown; data: { threshold: number; streakCount: number } };
      expect(body.chatbot).toEqual({ id: chatbotId, name });
      expect(body.data.threshold).toBe(2);
      expect(body.data.streakCount).toBeGreaterThanOrEqual(2);
    });
  });

  describe('벌크 재발송·취소 — 교차 챗봇 스코프 404(코드 리뷰 R1 시험 공백 (c))', () => {
    it('다른 챗봇 소속 runId를 섞으면 재발송·취소 모두 404다(존재 노출 없이 전체 거부)', async () => {
      receiverScript.length = 0;
      receiverScript.push({ status: 404 });
      const targetId = await createTarget();
      const { chatbotId: chatbotA, slug: slugA } = await createGroupAndChatbot('bulk-a');
      const { chatbotId: chatbotB } = await createGroupAndChatbot('bulk-b');
      await enableWebChannel(chatbotA);
      const kwRes = await admin<{ id: string }>('POST', `/chatbots/${chatbotA}/keywords`, { name: '벌크키워드', synonyms: ['벌크키워드'] });
      await admin('POST', `/chatbots/${chatbotA}/dialog-nodes`, {
        name: '벌크노드',
        keywordIds: [kwRes.body.id],
        outputs: [{ type: 'WORKFLOW', payload: { version: 1, targetId, actionKey: 'bulk.action', fields: [] } }],
      });
      await jsonRequest('POST', `${baseUrl}/public/chatbots/${slugA}/messages`, { sessionId: randomUUID(), message: '벌크키워드' });
      await dispatchJob.tick(); // 404 스크립트 → FAILED(PERMANENT_ERROR), payload 있음(재발송 대상).

      const failedRun = await prisma.workflowRun.findFirst({ where: { chatbotId: chatbotA }, orderBy: { createdAt: 'desc' } });
      expect(failedRun?.status).toBe('FAILED');

      const retryRes = await admin<{ code: string }>('POST', `/chatbots/${chatbotB}/workflow-runs/retry`, { runIds: [failedRun!.id] });
      expect(retryRes.status).toBe(404);

      const cancelRes = await admin<{ code: string }>('POST', `/chatbots/${chatbotB}/workflow-runs/cancel`, { runIds: [failedRun!.id] });
      expect(cancelRes.status).toBe(404);

      // 원래 챗봇 스코프로는 정상 재발송된다(대조군).
      const okRetry = await admin('POST', `/chatbots/${chatbotA}/workflow-runs/retry`, { runIds: [failedRun!.id] });
      expect([200, 201]).toContain(okRetry.status);
    });
  });

  describe('세션 상한(§6.6) — 코드 리뷰 R1 시험 공백 보강', () => {
    it('같은 세션·대상의 노드 요청이 10분 내 상한(기본 3)을 넘으면 4번째는 SKIPPED(RATE_LIMITED)다', async () => {
      const targetId = await createTarget();
      const { chatbotId, slug } = await createGroupAndChatbot('ratelimit');
      await enableWebChannel(chatbotId);
      const kwRes = await admin<{ id: string }>('POST', `/chatbots/${chatbotId}/keywords`, { name: '한도키워드', synonyms: ['한도키워드'] });
      await admin('POST', `/chatbots/${chatbotId}/dialog-nodes`, {
        name: '한도노드',
        keywordIds: [kwRes.body.id],
        outputs: [{ type: 'WORKFLOW', payload: { version: 1, targetId, actionKey: 'rate.action', fields: [] } }],
      });

      const sessionId = randomUUID();
      for (let i = 0; i < 3; i += 1) {
        await jsonRequest('POST', `${baseUrl}/public/chatbots/${slug}/messages`, { sessionId, message: '한도키워드' });
      }
      await jsonRequest('POST', `${baseUrl}/public/chatbots/${slug}/messages`, { sessionId, message: '한도키워드' });

      const runs = await prisma.workflowRun.findMany({ where: { targetId, sessionRef: { not: null } }, orderBy: { createdAt: 'asc' } });
      const forThisSession = runs.filter((r) => r.eventType === 'NODE_ACTION');
      expect(forThisSession.length).toBeGreaterThanOrEqual(4);
      const last = forThisSession[forThisSession.length - 1];
      expect(last.status).toBe('SKIPPED');
      expect(last.statusReason).toBe('RATE_LIMITED');
    });
  });

  describe('감사 — 대상 CRUD·원문 허용(★ AC-WF7-3)', () => {
    it('대상 생성·원문 허용 전환·일시정지·삭제가 각각 감사 1건씩 남고 비밀 값은 어디에도 없다', async () => {
      const name = `감사대상-${randomUUID().slice(0, 8)}`;
      const createRes = await admin<{ id: string; name: string }>('POST', '/workflow-targets', {
        name,
        baseUrl: 'https://wf-audit-test.example.invalid/hook',
        signingEnabled: true,
        signingSecretRef: 'WFTEST',
      });
      expect(createRes.status).toBe(201);
      const targetId = createRes.body.id;

      const rawAllowRes = await admin('PATCH', `/workflow-targets/${targetId}`, { allowRawPersonalData: true, confirmRawPersonalData: name });
      expect(rawAllowRes.status).toBe(200);

      const pauseRes = await admin('POST', `/workflow-targets/${targetId}/pause`);
      expect([200, 201]).toContain(pauseRes.status);

      const deleteRes = await admin('DELETE', `/workflow-targets/${targetId}`);
      expect([200, 204]).toContain(deleteRes.status);

      const auditRows = await prisma.auditLog.findMany({ where: { targetType: 'WorkflowTarget', targetId }, orderBy: { createdAt: 'asc' } });
      const actions = auditRows.map((r) => r.action);
      expect(actions).toContain('CREATE');
      expect(actions).toContain('UPDATE'); // 원문 허용 전환
      expect(actions).toContain('STATUS_CHANGE'); // 일시 정지
      expect(actions).toContain('DELETE');
      // 감사 기록 어디에도 서명 비밀 참조 값·주소가 원문으로 남지 않는다(NFR-WFS1 — 화이트리스트 스냅샷 규약).
      for (const row of auditRows) {
        const serialized = JSON.stringify(row);
        expect(serialized.includes('wf-signing-secret')).toBe(false);
      }
    });
  });


  describe('조기 반환 경로(★ AC-WF2-8 · EX-WF-5) — 엔진 미호출 턴은 노드 트리거가 구조적으로 없다', () => {
    it('입구 금지어 BLOCK 턴 — 엔진을 호출하지 않으므로 WORKFLOW 아웃풋이 있어도 발송함 적재가 0이다', async () => {
      const targetId = await createTarget();
      const { chatbotId, slug } = await createGroupAndChatbot('blocktest');
      await enableWebChannel(chatbotId);
      const kwRes = await admin<{ id: string }>('POST', `/chatbots/${chatbotId}/keywords`, { name: 'BLOCK시험키워드', synonyms: ['BLOCK시험키워드'] });
      await admin('POST', `/chatbots/${chatbotId}/dialog-nodes`, {
        name: 'BLOCK시험노드',
        keywordIds: [kwRes.body.id],
        outputs: [
          { type: 'TEXT', payload: { text: '접수했어요.' } },
          { type: 'WORKFLOW', payload: { version: 1, targetId, actionKey: 'block.action', fields: [] } },
        ],
      });

      const wordRes = await admin<{ id: string; word: string }>('POST', '/banned-words', { word: `금지어차단${randomUUID().slice(0, 6)}`, matchType: 'CONTAINS', policy: 'BLOCK' });
      expect(wordRes.status).toBe(201);

      const before = await prisma.workflowRun.count({ where: { targetId } });
      const res = await jsonRequest('POST', `${baseUrl}/public/chatbots/${slug}/messages`, {
        sessionId: randomUUID(),
        message: `${wordRes.body.word} BLOCK시험키워드 포함`,
      });
      expect(res.status).toBe(200);

      const after = await prisma.workflowRun.count({ where: { targetId } });
      expect(after).toBe(before); // 엔진 미호출 — 노드 트리거가 구조적으로 발생하지 않는다(EX-WF-5).
    });
  });


  describe('운영 — 이력 조회·테스트 발송·삭제 충돌(★ AC-WF6-4 · AC-WF6-5 · AC-WF6-6)', () => {
    it('AC-WF6-4 — 실행 이력 응답에 필드 이름만 있고 payload·필드 값·원본 sessionId가 없다', async () => {
      const targetId = await createTarget();
      const { slug } = await createChatbotAndNodeWithWorkflow(targetId);
      const sessionId = randomUUID();
      await jsonRequest('POST', `${baseUrl}/public/chatbots/${slug}/messages`, { sessionId, message: '테스트키워드' });

      const listRes = await admin<{ items: Array<Record<string, unknown>> }>('GET', `/workflow-runs?targetId=${targetId}`);
      expect(listRes.status).toBe(200);
      expect(listRes.body.items.length).toBeGreaterThan(0);
      const item = listRes.body.items[0];
      expect(item.fieldNames).toEqual(['a']); // createChatbotAndNodeWithWorkflow가 만드는 CONST 필드 이름
      expect('payload' in item).toBe(false);
      expect(JSON.stringify(item).includes(sessionId)).toBe(false); // 원본 sessionId는 어디에도 없다.
      expect(JSON.stringify(item).includes('상수값')).toBe(false); // 필드 값 자체도 없다.
    });

    it('AC-WF6-5 · EX-WF-25 — 테스트 발송은 실제 경로로 1회 나가고, 대상이 꺼져 있어도 허용되며 안내 문구가 붙고, 분당 6회째는 429다', async () => {
      receiverScript.length = 0;
      const targetId = await createTarget();
      const before = receiverRequests.length;
      const sendRes = await admin<{ runId: string; outcome: string; attempted: boolean; targetDisabled: boolean; guidance: string }>('POST', `/workflow-targets/${targetId}/test`, {});
      expect([200, 201]).toContain(sendRes.status);
      expect(sendRes.body.outcome).toBe('SUCCESS');
      expect(sendRes.body.attempted).toBe(true);
      expect(sendRes.body.targetDisabled).toBe(false);
      expect(typeof sendRes.body.guidance).toBe('string');
      expect(receiverRequests.length).toBe(before + 1);

      const testRun = await prisma.workflowRun.findUnique({ where: { id: sendRes.body.runId } });
      expect(testRun?.triggerKind).toBe('TEST');
      expect(testRun?.chatbotId).toBeNull();

      await admin('POST', `/workflow-targets/${targetId}/pause`);
      const disabledSendRes = await admin<{ targetDisabled: boolean; targetPaused: boolean }>('POST', `/workflow-targets/${targetId}/test`, {});
      expect([200, 201]).toContain(disabledSendRes.status); // EX-WF-25 — 정지 중에도 테스트 발송은 허용된다(설정 확인 목적).
      expect(disabledSendRes.body.targetPaused).toBe(true);

      // 이미 2회 보냈다 — 분당 상한 5회 중 3회를 더 채우고 6회째에서 429를 받는다.
      for (let i = 0; i < 3; i += 1) {
        await admin('POST', `/workflow-targets/${targetId}/test`, {});
      }
      const sixthRes = await admin('POST', `/workflow-targets/${targetId}/test`, {});
      expect(sixthRes.status).toBe(429);
    });

    it('AC-WF6-6 — 이벤트 구독이 참조 중인 대상을 삭제하려 하면 409 WORKFLOW_TARGET_IN_USE다', async () => {
      const targetId = await createTarget();
      const { chatbotId } = await createChatbotAndNodeWithWorkflow(targetId);
      const subRes = await admin('POST', `/chatbots/${chatbotId}/workflow-subscriptions`, { eventType: 'HANDOFF_STARTED', targetId });
      expect([200, 201]).toContain(subRes.status);

      const deleteRes = await admin<{ code: string }>('DELETE', `/workflow-targets/${targetId}`);
      expect(deleteRes.status).toBe(409);
      expect(deleteRes.body.code).toBe('WORKFLOW_TARGET_IN_USE');
    });
  });


  describe('노드 저장 검증(★ AC-WF2-7 · EX-WF-8)', () => {
    it('존재하지 않는 targetId로 WORKFLOW 아웃풋을 저장하면 404 INVALID_REFERENCE다', async () => {
      const { chatbotId } = await createGroupAndChatbot('invalidref');
      const kwRes = await admin<{ id: string }>('POST', `/chatbots/${chatbotId}/keywords`, { name: '존재안함키워드', synonyms: ['존재안함키워드'] });
      const res = await admin<{ code: string }>('POST', `/chatbots/${chatbotId}/dialog-nodes`, {
        name: '존재안함대상노드',
        keywordIds: [kwRes.body.id],
        outputs: [{ type: 'WORKFLOW', payload: { version: 1, targetId: randomUUID(), actionKey: 'x.y', fields: [] } }],
      });
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('INVALID_REFERENCE');
    });

    it('EX-WF-8 — 같은 노드에 WORKFLOW 아웃풋 4개를 저장하면 400(VALIDATION_FAILED — zod 스키마 상한 3)이다', async () => {
      const targetId = await createTarget();
      const { chatbotId } = await createGroupAndChatbot('perNodeLimit');
      const kwRes = await admin<{ id: string }>('POST', `/chatbots/${chatbotId}/keywords`, { name: '노드당한도키워드', synonyms: ['노드당한도키워드'] });
      const makeOutput = (i: number) => ({ type: 'WORKFLOW' as const, payload: { version: 1, targetId, actionKey: `x.${i}`, fields: [] } });
      const res = await admin<{ code: string }>('POST', `/chatbots/${chatbotId}/dialog-nodes`, {
        name: '노드당4개노드',
        keywordIds: [kwRes.body.id],
        outputs: [makeOutput(1), makeOutput(2), makeOutput(3), makeOutput(4)],
      });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
    });

    it('꺼진 대상을 참조하는 저장은 허용된다(EX-WF-1의 저장 시점 — 실행 시에만 SKIPPED)', async () => {
      const targetId = await createTarget();
      // 저장 뒤 대상을 비활성화(disable API가 없다면 정지로 대체 — pause는 §7.6 별개 개념이라 여기서는
      // 실제 enabled=false 필드를 직접 다루는 API가 없으므로, 이 케이스는 "정지 중 저장 허용"으로 좁혀 확인한다.
      await admin('POST', `/workflow-targets/${targetId}/pause`);
      const { chatbotId } = await createGroupAndChatbot('pausedsave');
      const kwRes = await admin<{ id: string }>('POST', `/chatbots/${chatbotId}/keywords`, { name: '정지대상키워드', synonyms: ['정지대상키워드'] });
      const res = await admin('POST', `/chatbots/${chatbotId}/dialog-nodes`, {
        name: '정지대상노드',
        keywordIds: [kwRes.body.id],
        outputs: [{ type: 'WORKFLOW', payload: { version: 1, targetId, actionKey: 'x.y', fields: [] } }],
      });
      expect(res.status).toBe(201);
    });
  });

});
