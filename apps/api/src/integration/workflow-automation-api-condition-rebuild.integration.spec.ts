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
import { LEGACY_DNS_RESOLVER, LEGACY_TRANSPORT } from '../legacy-api/transport/legacy-transport.port';
import type { LegacyDnsResolver, LegacyTransport, LegacyTransportRequest, LegacyTransportResult } from '../legacy-api/transport/legacy-transport.port';

/**
 * [신규 No.41] 업무 자동화 워크플로우 — ★ AC-WF2-6(엔진 재조립 경로 보존) 통합 시험.
 *
 * 근거: `docs/02-spec/workflow-automation-설계.md` §5.6("재조립 경로 보존 — resumeAfterApiCall·
 * 폴백 동봉본") · §21.1("API 재진입 이월"은 통합 수준으로 본다) · 제약 C-4.
 *
 * 이 시나리오는 `dialogue-engine/src/api-call.spec.ts`(순수 함수 단위 시험 — resumeAfterApiCall의
 * SUCCESS/FAILURE/NOT_EXECUTED 세 갈래 모두에서 `workflowEvents`가 그대로 보존됨을 이미 확인했다)의
 * 한 단계 위 계층이다. 여기서는 **실제 공개 대화 HTTP 요청 1턴**이 API_CONDITION 정지 → 레거시(No.26)
 * 실제 호출 → `resumeAfterApiCall` 재조립 → No.41 §4.7 적재까지 전부 지나서, DB에 실제로 몇 개의
 * `workflowRun` 행이 몇 번 적재되는지를 검증한다(엔진 단위 시험은 결과 객체만 보고, 적재 파이프라인
 * 자체는 보지 않는다 — 그 공백을 메운다).
 *
 * 레거시 API(No.26) 가짜 전송 기법은 `legacy-api-integration.integration.spec.ts` 선례를 그대로
 * 재사용한다. 이 시험은 발송 루프(`WorkflowDispatchJob.tick()`)를 호출하지 않는다 — 적재(enqueue)
 * 행 수·필드만 확인 대상이다(발송 자체는 다른 통합 시험이 이미 담당).
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

interface RecordedLegacyRequest {
  pathname: string;
}

/** 로컬 목 "레거시 서버"(No.26 선례) — 경로 마지막 세그먼트로 시나리오를 고른다. */
function startMockLegacyServer(legacyRequests: RecordedLegacyRequest[]): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const parsed = new URL(req.url ?? '/', 'http://legacy.local');
      req.on('data', () => undefined);
      req.on('end', () => {
        legacyRequests.push({ pathname: parsed.pathname });
        if (parsed.pathname === '/orders/SLOW') {
          return; // 응답하지 않는다 — 가짜 전송의 timeoutMs 타이머가 대신 끝낸다(TIMEOUT → FAILURE).
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ data: { status: 'SHIPPED' } }));
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

function makeFakeTransport(getMockBaseUrl: () => string): LegacyTransport {
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
        const timer = setTimeout(() => {
          httpReq.destroy();
          finish({ kind: 'ERROR', outcome: 'TIMEOUT' });
        }, req.timeoutMs);

        const target = new URL(req.url);
        const local = new URL(getMockBaseUrl());
        const httpReq = http.request({ method: req.method, hostname: local.hostname, port: local.port, path: target.pathname + target.search, headers: req.headers }, (res) => {
          const status = res.statusCode ?? 0;
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            const body = Buffer.concat(chunks);
            finish({ kind: 'RESPONSE', status, contentType: res.headers['content-type'], bytes: body.length, body });
          });
        });
        httpReq.on('error', () => finish({ kind: 'ERROR', outcome: 'NETWORK_ERROR' }));
        httpReq.end();
      });
    },
  };
}

describe('업무 자동화 워크플로우(No.41) 통합 시험 — API 조건 노드 재조립 경로(★ AC-WF2-6)', () => {
  let app: NestExpressApplication;
  let baseUrl: string;
  let tmpDir: string;
  let prisma: PrismaService;
  let mockLegacy: { url: string; close: () => Promise<void> };
  const legacyRequests: RecordedLegacyRequest[] = [];
  let adminCookie = '';

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'workflow-api-rebuild-test-'));
    const dbPath = join(tmpDir, 'test.db').replace(/\\/g, '/');
    const testDatabaseUrl = `file:${dbPath}`;

    mockLegacy = await startMockLegacyServer(legacyRequests);

    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.DEPLOY_SCHEDULE_ENABLED = 'false';
    process.env.HANDOFF_SWEEPER_ENABLED = 'false';
    process.env.WIDGET_BASE_URL = process.env.WIDGET_BASE_URL ?? 'http://localhost:5174';
    process.env.PUBLIC_API_BASE_URL = process.env.PUBLIC_API_BASE_URL ?? 'http://localhost:3000/api/v1';
    delete process.env.EMBEDDING_BASE_URL;

    process.env.LEGACY_API_ENABLED = 'true';
    process.env.LEGACY_API_PRIVATE_ALLOWLIST = '';
    process.env.LEGACY_API_DEFAULT_TIMEOUT_MS = '1000';
    process.env.LEGACY_API_MAX_TIMEOUT_MS = '1000';
    process.env.LEGACY_API_MAX_RESPONSE_BYTES = '262144';
    process.env.LEGACY_API_CIRCUIT_FAILURE_THRESHOLD = '10'; // 이 시험 세트에서 회로가 트립하지 않게 넉넉히
    process.env.LEGACY_API_CIRCUIT_OPEN_MS = '1000';

    process.env.WORKFLOW_ENABLED = 'true';
    process.env.WORKFLOW_DISPATCH_ENABLED = 'false'; // 이 시험은 적재만 확인 — 발송 루프 불필요.

    try {
      execSync('pnpm exec prisma migrate deploy', { cwd: API_ROOT, env: { ...process.env, DATABASE_URL: testDatabaseUrl }, stdio: 'pipe' });
    } catch (e) {
      const err = e as { stdout?: Buffer; stderr?: Buffer };
      throw new Error(`prisma migrate deploy 실패:\n${err.stdout?.toString()}\n${err.stderr?.toString()}`);
    }

    const { AppModule } = (await import('../app.module')) as { AppModule: typeof AppModuleType };
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(LEGACY_DNS_RESOLVER)
      .useValue(makeFakeDnsResolver())
      .overrideProvider(LEGACY_TRANSPORT)
      .useValue(makeFakeTransport(() => mockLegacy.url))
      .compile();

    app = moduleRef.createNestApplication<NestExpressApplication>();
    app.enableCors();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalFilters(new AllExceptionsFilter());
    prisma = moduleRef.get(PrismaService);

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
    await mockLegacy?.close();
    await safeCleanupTmpDir(tmpDir);
  }, 15_000);

  function admin<T = unknown>(method: string, path: string, body?: unknown): Promise<ApiResponse<T>> {
    return jsonRequest(method, `${baseUrl}${path}`, body, { Cookie: adminCookie });
  }

  async function createConnection(): Promise<string> {
    const res = await admin<{ id: string }>('POST', '/api-connections', {
      name: `레거시연결-${randomUUID().slice(0, 8)}`,
      baseUrl: 'https://legacy.example.invalid',
      allowedMethods: ['GET'],
      authType: 'NONE',
      allowRawPersonalData: false,
      personalDataLookup: false,
      sampleResponses: [{ label: '배송중', httpStatus: 200, body: { data: { status: 'SHIPPED' } } }],
      enabled: true,
    });
    expect(res.status).toBe(201);
    return res.body.id;
  }

  async function createTarget(): Promise<string> {
    const res = await admin<{ id: string }>('POST', '/workflow-targets', {
      name: `대상-${randomUUID().slice(0, 8)}`,
      baseUrl: 'https://wf-rebuild-target.example.invalid/hook',
      signingEnabled: false,
    });
    expect(res.status).toBe(201);
    return res.body.id;
  }

  /**
   * 노드 A = [WORKFLOW#1, API_CONDITION] · path별로 성공(SHIP1 → SHIPPED)/실패(SLOW → TIMEOUT) 분기.
   * 성공 시 nextNodeId = 노드 B(= [WORKFLOW#2, TEXT]). 실패는 실패 분기 노드를 지정하지 않아
   * 엔진이 "폴백 동봉본"(고정 문구)을 낸다(§5.6 결함 선례와 같은 경로).
   */
  async function setupApiWorkflowFlow(opts: { path: string; connectionId: string; targetId: string }): Promise<{ slug: string; keyword: string; apiNodeId: string; nodeBId: string }> {
    const groupRes = await admin<{ id: string }>('POST', '/chatbot-groups', { name: `그룹-${randomUUID().slice(0, 8)}` });
    const slug = `wf-rebuild-${randomUUID().slice(0, 8)}`;
    const botRes = await admin<{ id: string }>('POST', '/chatbots', { groupId: groupRes.body.id, name: 'AC-WF2-6 시험봇', slug });
    const chatbotId = botRes.body.id;

    // 분기 목적지 노드(B)는 직접 매칭되지 않아야 하므로 노이즈 의도로 저장 규약만 만족시킨다(No.26 선례).
    const noiseIntentRes = await admin<{ intent: { id: string } }>('POST', `/chatbots/${chatbotId}/intents`, {
      name: `노이즈의도-${randomUUID().slice(0, 6)}`,
      examples: [`노이즈문장-${randomUUID().slice(0, 10)}`],
    });
    const noiseIntentId = noiseIntentRes.body.intent.id;

    const nodeBRes = await admin<{ id: string }>('POST', `/chatbots/${chatbotId}/dialog-nodes`, {
      name: '성공분기_노드B',
      intentIds: [noiseIntentId],
      outputs: [
        { type: 'WORKFLOW', payload: { version: 1, targetId: opts.targetId, actionKey: 'wf.second', fields: [{ name: 'b', value: { kind: 'CONST', value: '값2' } }] } },
        { type: 'TEXT', payload: { text: '배송 중입니다.' } },
      ],
    });
    expect(nodeBRes.status).toBe(201);

    const keyword = `AC조건재조립-${randomUUID().slice(0, 8)}`;
    const kwRes = await admin<{ id: string }>('POST', `/chatbots/${chatbotId}/keywords`, { name: keyword, synonyms: [keyword] });

    const apiNodeRes = await admin<{ id: string }>('POST', `/chatbots/${chatbotId}/dialog-nodes`, {
      name: '노드A_API조건',
      keywordIds: [kwRes.body.id],
      outputs: [
        { type: 'WORKFLOW', payload: { version: 1, targetId: opts.targetId, actionKey: 'wf.first', fields: [{ name: 'a', value: { kind: 'CONST', value: '값1' } }] } },
        {
          type: 'API_CONDITION',
          payload: {
            version: 2,
            connectionId: opts.connectionId,
            method: 'GET',
            path: `/orders/${opts.path}`,
            pathParams: [],
            query: [],
            body: [],
            responseMappings: [{ name: 'status', path: 'data.status', required: false, maxLength: 50 }],
            conditions: [{ path: 'data.status', operator: 'EQ', value: 'SHIPPED', nextNodeId: nodeBRes.body.id }],
          },
        },
      ],
    });
    expect(apiNodeRes.status).toBe(201);

    await admin('PATCH', `/chatbots/${chatbotId}/status`, { status: 'ACTIVE' });
    await admin('PATCH', `/chatbots/${chatbotId}/channels/WEB`, { enabled: true, config: { allowedOrigins: [], greetingMessage: '안녕하세요' } });

    return { slug, keyword, apiNodeId: apiNodeRes.body.id, nodeBId: nodeBRes.body.id };
  }

  it('성공 분기(실제 API 성공) — 노드 A·B의 WORKFLOW가 각각 1행씩, 총 2행 적재된다', async () => {
    const connectionId = await createConnection();
    const targetId = await createTarget();
    const flow = await setupApiWorkflowFlow({ path: 'SHIP1', connectionId, targetId });

    const msgRes = await jsonRequest('POST', `${baseUrl}/public/chatbots/${flow.slug}/messages`, { sessionId: randomUUID(), message: flow.keyword });
    expect(msgRes.status).toBe(200);

    const rows = await prisma.workflowRun.findMany({ where: { targetId }, orderBy: { nodeId: 'asc' } });
    expect(rows).toHaveLength(2);
    const actionKeys = rows.map((r) => r.actionKey).sort();
    expect(actionKeys).toEqual(['wf.first', 'wf.second']);
    const nodeIds = rows.map((r) => r.nodeId).sort();
    expect(nodeIds).toEqual([flow.apiNodeId, flow.nodeBId].sort());
    // 같은 턴(메시지) 소속 — 두 방출이 한 messageId로 묶인다.
    expect(new Set(rows.map((r) => r.messageId)).size).toBe(1);
  });

  it('실패 분기(타임아웃 → 폴백 동봉본) — 노드 B는 실행되지 않고 노드 A의 WORKFLOW#1만 1행 유지된다(§5.6·C-4)', async () => {
    const connectionId = await createConnection();
    const targetId = await createTarget();
    const flow = await setupApiWorkflowFlow({ path: 'SLOW', connectionId, targetId });

    const msgRes = await jsonRequest<{ outputs: Array<{ type: string; payload: { text?: string } }> }>('POST', `${baseUrl}/public/chatbots/${flow.slug}/messages`, {
      sessionId: randomUUID(),
      message: flow.keyword,
    });
    expect(msgRes.status).toBe(200);
    // 실패 분기 미지정 — 엔진이 폴백 동봉본(고정 문구)을 낸다(노드 B의 "배송 중입니다."가 아니다).
    const texts = msgRes.body.outputs.filter((o) => o.type === 'TEXT').map((o) => o.payload.text);
    expect(texts.some((t) => t === '배송 중입니다.')).toBe(false);

    const rows = await prisma.workflowRun.findMany({ where: { targetId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].actionKey).toBe('wf.first');
    expect(rows[0].nodeId).toBe(flow.apiNodeId);
  });
});
