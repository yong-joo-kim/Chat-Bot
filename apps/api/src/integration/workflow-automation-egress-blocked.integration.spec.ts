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
import { WorkflowDispatchJob } from '../workflow/dispatch/workflow-dispatch.job';
import { installGovernanceRuntime, resetGovernanceRuntimeForTest } from '../common/governance/governance-runtime';

/**
 * [신규 No.41] 업무 자동화 워크플로우 — 출구 게이트(No.45) 모드 ON 통합 시험. 별도 파일(3번째)로 분리한
 * 이유는 다른 두 통합 시험 파일과 같다: `ConfigModule.forRoot()`가 `process.env`를 **동기 스냅샷**하므로
 * `DATA_GOVERNANCE_MODE=ON`은 이 파일의 `beforeAll`에서 **동적 import 전에** 설정해야 하고, 다른 시험
 * (모드 OFF 기본값)과 같은 파일에서 공존할 수 없다(CLAUDE.md 시험 격리 규약).
 *
 * "발송 시점" 차단(§9.3 AC-WF5-1 후반)은 저장 시점과 다른 허용 목록 상태를 재현해야 하는데, env는
 * 부팅 시 1회만 읽히므로 `resetGovernanceRuntimeForTest()`(거버넌스 런타임의 시험 전용 재설치 지점 —
 * `common/governance/governance-runtime.ts`가 이미 이 목적으로 노출한 함수)로 저장 뒤·발송 틱 전에
 * 허용 목록을 좁혀 재현한다. 앱을 다시 띄우지 않는다(운영 코드는 한 줄도 건드리지 않는다).
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

function startReceiver(requests: unknown[]): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        requests.push({ headers: req.headers, body: raw });
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

/** 가짜 DNS — `wf-egress-allowed.example.invalid`만 공인 주소로 위장한다(허용 목록에 있는 호스트). */
function makeFakeDnsResolver(): LegacyDnsResolver {
  return {
    async lookupAll(hostname: string): Promise<string[]> {
      return hostname === 'wf-egress-allowed.example.invalid' ? ['203.0.113.20'] : ['203.0.113.99'];
    },
  };
}

function makeFakeTransport(getReceiverUrl: () => string): LegacyTransport {
  return {
    request(req: LegacyTransportRequest): Promise<LegacyTransportResult> {
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
        const httpReq = http.request({ method: req.method, hostname: local.hostname, port: local.port, path: target.pathname + target.search, headers: req.headers }, (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => finish({ kind: 'RESPONSE', status: res.statusCode ?? 0, contentType: res.headers['content-type'], bytes: Buffer.concat(chunks).length, body: Buffer.concat(chunks) }));
        });
        httpReq.on('error', () => finish({ kind: 'ERROR', outcome: 'NETWORK_ERROR' }));
        if (req.body) httpReq.write(req.body);
        httpReq.end();
      });
    },
  };
}

describe('업무 자동화 워크플로우(No.41) — 출구 게이트(No.45) 모드 ON', () => {
  let app: NestExpressApplication;
  let baseUrl: string;
  let tmpDir: string;
  let prisma: PrismaService;
  let dispatchJob: WorkflowDispatchJob;
  let receiver: { url: string; close: () => Promise<void> };
  const receiverRequests: unknown[] = [];
  let adminCookie = '';

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'chatbot-workflow-egress-test-'));
    const dbPath = join(tmpDir, 'test.db').replace(/\\/g, '/');
    const testDatabaseUrl = `file:${dbPath}`;

    receiver = await startReceiver(receiverRequests);

    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.DEPLOY_SCHEDULE_ENABLED = 'false';
    process.env.WIDGET_BASE_URL = process.env.WIDGET_BASE_URL ?? 'http://localhost:5174';
    process.env.PUBLIC_API_BASE_URL = process.env.PUBLIC_API_BASE_URL ?? 'http://localhost:3000/api/v1';
    // [데이터 거버넌스 선례 — data-governance-query-count-on.integration.spec.ts] 모드 ON 기동 검사가
    // 다른 출구(임베딩·RAG·증강)의 base URL도 허용 목록과 대조하므로, 이 시험과 무관한 출구는
    // "설정 안 됨"으로 명시해 기동 검사 대상에서 빼야 한다(`undefined`가 아니라 빈 문자열).
    process.env.EMBEDDING_BASE_URL = '';
    process.env.RAG_BASE_URL = '';
    process.env.AUGMENTATION_PROVIDER = 'rule';
    delete process.env.AUGMENTATION_GEMINI_API_KEY;
    delete process.env.AUGMENTATION_LOCAL_BASE_URL;

    process.env.WORKFLOW_ENABLED = 'true';
    process.env.WORKFLOW_DISPATCH_ENABLED = 'false';
    process.env.WORKFLOW_MAX_TIMEOUT_MS = '1000';
    process.env.WORKFLOW_PRIVATE_ALLOWLIST = '';

    // ★ 모드 ON — 허용 목록에는 저장을 허용할 호스트만 넣는다(발송 시점 차단은 시험 안에서
    // `resetGovernanceRuntimeForTest()`로 재현한다).
    process.env.DATA_GOVERNANCE_MODE = 'ON';
    process.env.DATA_EGRESS_ALLOWED_HOSTS = 'wf-egress-allowed.example.invalid';

    execSync('pnpm exec prisma migrate deploy', { cwd: API_ROOT, env: { ...process.env, DATABASE_URL: testDatabaseUrl }, stdio: 'pipe' });

    const { AppModule } = (await import('../app.module')) as { AppModule: typeof AppModuleType };
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(WORKFLOW_DNS_RESOLVER)
      .useValue(makeFakeDnsResolver())
      .overrideProvider(WORKFLOW_TRANSPORT)
      .useValue(makeFakeTransport(() => receiver.url))
      .compile();

    app = moduleRef.createNestApplication<NestExpressApplication>();
    app.enableCors();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalFilters(new AllExceptionsFilter());
    prisma = moduleRef.get(PrismaService);
    dispatchJob = moduleRef.get(WorkflowDispatchJob);

    await app.listen(0);
    const server = app.getHttpServer() as http.Server;
    const address = server.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;
    baseUrl = `http://127.0.0.1:${port}/api/v1`;

    await seedTestUsers(prisma);
    adminCookie = await loginAs(baseUrl, 'ADMIN');
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await receiver?.close();
    await safeCleanupTmpDir(tmpDir);
  }, 15_000);

  function admin<T = unknown>(method: string, path: string, body?: unknown): Promise<ApiResponse<T>> {
    return jsonRequest(method, `${baseUrl}${path}`, body, { Cookie: adminCookie });
  }

  it('저장 시점 차단 — 허용 목록 밖 호스트는 400 EGRESS_HOST_NOT_ALLOWED로 거부되고 행이 생기지 않는다', async () => {
    const res = await admin('POST', '/workflow-targets', {
      name: `차단대상-${randomUUID().slice(0, 8)}`,
      baseUrl: 'https://wf-egress-blocked.example.invalid/hook',
      signingEnabled: false,
    });
    expect(res.status).toBe(400);
    expect((res.body as { code?: string }).code).toBe('EGRESS_HOST_NOT_ALLOWED');
  });

  it('저장 시점 허용 — 허용 목록 안 호스트는 정상 저장된다', async () => {
    const res = await admin<{ id: string; egressDecision: string }>('POST', '/workflow-targets', {
      name: `허용대상-${randomUUID().slice(0, 8)}`,
      baseUrl: 'https://wf-egress-allowed.example.invalid/hook',
      signingEnabled: false,
    });
    expect(res.status).toBe(201);
    expect(res.body.egressDecision).toBe('ALLOWED');
  });

  it('발송 시점 차단 — 저장 뒤 허용 목록이 좁혀지면(관리자가 목록을 축소) 송신 없이 EGRESS_BLOCKED로 영구 실패한다', async () => {
    const createRes = await admin<{ id: string }>('POST', '/workflow-targets', {
      name: `발송차단대상-${randomUUID().slice(0, 8)}`,
      baseUrl: 'https://wf-egress-allowed.example.invalid/hook',
      signingEnabled: false,
    });
    expect(createRes.status).toBe(201);
    const targetId = createRes.body.id;

    // 노드 방출과 같은 형태로 발송함에 직접 PENDING 행을 적재한다(공개 대화 경로를 새로 구성하지
    // 않고 이 시험의 관심사 — "발송 시점 차단" — 에만 집중한다).
    const now = new Date();
    await prisma.workflowRun.create({
      data: {
        id: randomUUID(),
        targetId,
        targetName: '발송차단대상',
        chatbotId: null,
        triggerKind: 'TEST',
        eventType: 'TEST',
        status: 'PENDING',
        nextAttemptAt: now,
        personalDataMasked: false,
        fieldNames: '[]',
        payload: JSON.stringify({ specVersion: '1', deliveryId: randomUUID(), eventType: 'TEST', occurredAt: now.toISOString(), test: true, chatbot: null, channel: null, sessionRef: null, source: {} }),
        payloadBytes: 10,
        dayBucket: '2026-01-01',
        createdAt: now,
      },
    });

    const beforeCount = receiverRequests.length;

    // ★ 관리자가 허용 목록을 좁혔다(운영 시나리오 재현) — env는 고정이라 런타임을 직접 재설치한다
    // (시험 전용 지점 `resetGovernanceRuntimeForTest()` — 운영 코드 호출 0).
    resetGovernanceRuntimeForTest();
    installGovernanceRuntime({ mode: 'ON', egress: { allowlist: [], enforce: true }, encryptionEnabled: false });

    await dispatchJob.tick();

    expect(receiverRequests.length).toBe(beforeCount);
    const row = await prisma.workflowRun.findFirst({ where: { targetId }, orderBy: { createdAt: 'desc' } });
    expect(row?.status).toBe('FAILED');
    expect(row?.lastOutcome).toBe('EGRESS_BLOCKED');
  });
});
