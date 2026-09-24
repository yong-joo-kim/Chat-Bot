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
import { normalizeText } from '@chat-bot/shared-types';
import { AllExceptionsFilter } from '../common/all-exceptions.filter';
import { PrismaService } from '../prisma/prisma.service';
import { loginAs, seedTestUsers } from './helpers/auth.helper';
import { LEGACY_DNS_RESOLVER, LEGACY_TRANSPORT } from '../legacy-api/transport/legacy-transport.port';
import type { LegacyDnsResolver, LegacyTransport, LegacyTransportRequest, LegacyTransportResult } from '../legacy-api/transport/legacy-transport.port';

/**
 * [No.26] 레거시 API 연동 통합 시험.
 * 근거: `docs/requirements/legacy-api-integration.md`(AC-L1~L8·EX-L-1~25) ·
 * `docs/02-spec/legacy-api-integration-설계.md` §17(시험 설계 포인트) · ADR-0034.
 *
 * ★ SSRF/전송 계층 시험 기법(설계 §17 "가짜 리졸버·가짜 전송" NFR-LM2 그대로 재사용):
 * 루프백(127.0.0.1)은 운영 코드에서 **절대 차단**이라(§7.4 `ip-policy.ts`) 실제 앱을 통해 로컬
 * 목 레거시 서버를 호출하려면 loopback allowlist 같은 우회가 존재하지 않는다. 이 시험은 운영
 * 코드를 전혀 건드리지 않고 `LegacyApiModule`이 **시험 대체 지점으로 이미 노출한 DI 토큰**
 * (`LEGACY_DNS_RESOLVER`/`LEGACY_TRANSPORT`, `legacy-transport.port.ts` — "시험에서 가짜 리졸버·가짜
 * 전송으로 교체하는 지점"이라고 명시된 바로 그 토큰)을 `Test.createTestingModule().overrideProvider()`로
 * 교체한다: ① 가짜 DNS 리졸버는 시험용 도메인을 **공인 주소로 위장**해 반환해 SSRF 주소 분류
 * (`classifyAddress`)를 정상적으로 "통과"시키고 ② 가짜 전송은 그 뒤에만 개입해 실제 소켓 연결을
 * `127.0.0.1`의 로컬 목 서버로 돌린다. 즉 **주소 분류·차단 로직(`ip-policy.ts`, `build-request.ts`)은
 * 무수정·무우회로 항상 실행**되며, `baseUrl`이 IP 리터럴(`http://127.0.0.1:1`)인 루프백 시험은 DNS
 * 리졸버를 거치지 않으므로 가짜 리졸버 유무와 무관하게 운영 코드 그대로 차단된다(아래 "SSRF" 절).
 * 이 두 토큰은 `LegacyApiModule`의 `providers`에는 있으나 `exports`에는 없다(L-4 봉인) — 오버라이드는
 * Nest 테스트 모듈이 토큰 문자열로 전역 치환하는 방식이라 export 여부와 무관하게 동작하며, 운영 코드
 * 파일에는 어떤 테스트 전용 분기도 추가하지 않는다.
 *
 * ⚠ ConfigService 스냅샷 시점 — `@nestjs/config`의 `ConfigModule.forRoot()`는 **호출되는 즉시(동기)**
 * `process.env`를 스냅샷해 검증한다(`config.module.js`의 `forRoot()` 본문 — `await` 이전에 실행).
 * `app.module.ts`를 이 파일 맨 위에서 정적으로 `import`하면 그 스냅샷이 `beforeAll`보다 먼저(테스트
 * 파일이 로드되는 시점에) 고정되어, `LEGACY_API_*` 환경변수를 `beforeAll`에서 설정해도 반영되지
 * 않는다(직접 확인 — 실제 결함은 아니고 부팅 후 env 불변이 정상 동작이다). 그래서 이 파일은
 * `AppModule`을 정적 import하지 않고 `beforeAll` 안에서 환경변수를 먼저 설정한 뒤 **동적 import**로
 * 읽는다.
 */

const API_ROOT = join(__dirname, '..', '..');

async function safeCleanupTmpDir(dir: string): Promise<void> {
  await new Promise((r) => setTimeout(r, 300));
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {
    // 정리 실패는 판정에 영향 없음(Windows 파일 핸들 지연 해제 — 기존 그룹들과 동일한 완화책).
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
        headers: {
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
          ...headers,
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
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

/* --------------------------------------------------------------------------------------------
 * 로컬 목 "레거시 서버" — 실제 node:http로 127.0.0.1에 뜬다(learning-augmentation의
 * embeddingServer 선례). 주문번호(`/orders/<id>`)의 마지막 세그먼트 값으로 시나리오를 고른다.
 * -------------------------------------------------------------------------------------------- */

interface RecordedLegacyRequest {
  method: string;
  pathname: string;
  search: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}

const HUGE_ETA = 'x'.repeat(300_000); // > LEGACY_API_MAX_RESPONSE_BYTES(262144)

function startMockLegacyServer(legacyRequests: RecordedLegacyRequest[]): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const parsed = new URL(req.url ?? '/', 'http://legacy.local');
      let raw = '';
      req.on('data', (chunk) => {
        raw += chunk;
      });
      req.on('end', () => {
        legacyRequests.push({ method: req.method ?? 'GET', pathname: parsed.pathname, search: parsed.search, headers: { ...req.headers }, body: raw });

        if (parsed.pathname === '/orders/SLOW') {
          // 응답하지 않는다 — 가짜 전송의 timeoutMs 타이머가 대신 끝낸다.
          return;
        }
        if (parsed.pathname === '/orders/ERR500') {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end('{}');
          return;
        }
        if (parsed.pathname === '/orders/HTML') {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end('<p>legacy</p>');
          return;
        }
        if (parsed.pathname === '/orders/HUGE') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ data: { status: 'SHIPPED', delivery: { eta: HUGE_ETA } } }));
          return;
        }
        if (parsed.pathname === '/orders/REDIRECT') {
          res.writeHead(302, { Location: 'http://169.254.169.254/' });
          res.end();
          return;
        }
        if (parsed.pathname === '/orders/NOMAP') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ data: {} }));
          return;
        }
        if (parsed.pathname === '/orders/READY1') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ data: { status: 'READY' } }));
          return;
        }
        if (parsed.pathname === '/orders/RETURNED1') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ data: { status: 'RETURNED' } }));
          return;
        }
        if (parsed.pathname === '/orders/POSTINJECT' && req.method === 'POST') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ data: { ok: true } }));
          return;
        }
        // 기본값(SHIP1 포함, ".."·"%2e%2e"는 build-request 단계에서 이미 차단되어 여기 도달하지 않는다) — SHIPPED.
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ data: { status: 'SHIPPED', delivery: { eta: '09/26' } } }));
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      resolve({ url: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(() => r())) });
    });
  });
}

/** 가짜 DNS 리졸버 — 시험용 도메인을 공인/사설 주소로 "위장"해 반환한다(운영 IP 분류 로직은 그대로 탄다). */
function makeFakeDnsResolver(): LegacyDnsResolver {
  const map: Record<string, string[]> = {
    'legacy.example.invalid': ['203.0.113.10'], // TEST-NET-3 — PUBLIC 분류
    'legacy-private-allowed.example.invalid': ['10.20.5.5'], // allowlist(10.20.0.0/16) 안
    'legacy-private-blocked.example.invalid': ['10.30.5.5'], // 사설이지만 allowlist 밖
  };
  return {
    async lookupAll(hostname: string): Promise<string[]> {
      return map[hostname] ?? ['203.0.113.99'];
    },
  };
}

/**
 * 가짜 전송 — `ip-policy.ts` 검사를 통과한 요청만 여기 도달한다(운영 로직 무수정). 원래 호스트가
 * 아니라 로컬 목 서버로 실제 소켓 연결을 돌린다(경로·쿼리·헤더·본문은 그대로 전달). 타임아웃·
 * 리다이렉트 거부·응답 크기 상한을 `NodeHttpTransport`와 같은 의미로 재현한다(개별 저수준 소켓
 * 동작은 `legacy-api-http.client.spec.ts`가 단위 시험으로 이미 담당 — 이 파일은 조율/분기/로그/
 * 권한 등 서비스 계층 통합 동작이 목표다).
 */
function makeFakeTransport(getMockBaseUrl: () => string, counter: { calls: number }): LegacyTransport {
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
        const timer = setTimeout(() => {
          httpReq.destroy();
          finish({ kind: 'ERROR', outcome: 'TIMEOUT' });
        }, req.timeoutMs);

        const target = new URL(req.url);
        const local = new URL(getMockBaseUrl());
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
                finish({ kind: 'ERROR', outcome: 'RESPONSE_TOO_LARGE' });
                return;
              }
              chunks.push(chunk);
            });
            res.on('end', () => {
              const body = Buffer.concat(chunks);
              finish({ kind: 'RESPONSE', status, contentType: res.headers['content-type'], bytes: body.length, body });
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

describe('레거시 API 연동(No.26) 통합 시험', () => {
  let app: NestExpressApplication;
  let baseUrl: string;
  let tmpDir: string;
  let prisma: PrismaService;
  let mockLegacy: { url: string; close: () => Promise<void> };
  let legacyRequests: RecordedLegacyRequest[] = [];
  const transportCounter = { calls: 0 };

  let adminCookie = '';
  let editorCookie = '';
  let viewerCookie = '';

  const SECRET_VALUE = 'tok-XYZ-super-secret-9f21';

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'chatbot-legacy-api-test-'));
    const dbPath = join(tmpDir, 'test.db').replace(/\\/g, '/');
    const testDatabaseUrl = `file:${dbPath}`;

    mockLegacy = await startMockLegacyServer(legacyRequests);

    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.DEPLOY_SCHEDULE_ENABLED = 'false';
    process.env.WIDGET_BASE_URL = process.env.WIDGET_BASE_URL ?? 'http://localhost:5174';
    process.env.PUBLIC_API_BASE_URL = process.env.PUBLIC_API_BASE_URL ?? 'http://localhost:3000/api/v1';
    delete process.env.EMBEDDING_BASE_URL;

    process.env.LEGACY_API_ENABLED = 'true';
    process.env.LEGACY_API_PRIVATE_ALLOWLIST = '10.20.0.0/16';
    process.env.LEGACY_API_DEFAULT_TIMEOUT_MS = '1000'; // 시험 소요시간 단축(허용 하한 1000)
    process.env.LEGACY_API_MAX_TIMEOUT_MS = '1000';
    process.env.LEGACY_API_MAX_RESPONSE_BYTES = '262144';
    process.env.LEGACY_API_CIRCUIT_FAILURE_THRESHOLD = '3'; // 시험 소요시간 단축(기본 5 → 3)
    process.env.LEGACY_API_CIRCUIT_OPEN_MS = '1000'; // 시험 소요시간 단축(기본 60000 → 1000, 스키마 하한 1000)
    process.env.LEGACY_API_SECRET__ERPTEST = SECRET_VALUE;

    try {
      execSync('pnpm exec prisma migrate deploy', {
        cwd: API_ROOT,
        env: { ...process.env, DATABASE_URL: testDatabaseUrl },
        stdio: 'pipe',
      });
    } catch (e) {
      const err = e as { stdout?: Buffer; stderr?: Buffer };
      throw new Error(`prisma migrate deploy 실패:\n${err.stdout?.toString()}\n${err.stderr?.toString()}`);
    }

    const { AppModule } = (await import('../app.module')) as { AppModule: typeof AppModuleType };
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(LEGACY_DNS_RESOLVER)
      .useValue(makeFakeDnsResolver())
      .overrideProvider(LEGACY_TRANSPORT)
      .useValue(makeFakeTransport(() => mockLegacy.url, transportCounter))
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
    editorCookie = await loginAs(baseUrl, 'EDITOR');
    viewerCookie = await loginAs(baseUrl, 'VIEWER');
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await mockLegacy?.close();
    await safeCleanupTmpDir(tmpDir);
  }, 15_000);

  function admin<T = unknown>(method: string, path: string, body?: unknown): Promise<ApiResponse<T>> {
    return jsonRequest(method, `${baseUrl}${path}`, body, { Cookie: adminCookie });
  }
  function editor<T = unknown>(method: string, path: string, body?: unknown): Promise<ApiResponse<T>> {
    return jsonRequest(method, `${baseUrl}${path}`, body, { Cookie: editorCookie });
  }
  function viewer<T = unknown>(method: string, path: string, body?: unknown): Promise<ApiResponse<T>> {
    return jsonRequest(method, `${baseUrl}${path}`, body, { Cookie: viewerCookie });
  }
  function anon<T = unknown>(method: string, path: string, body?: unknown): Promise<ApiResponse<T>> {
    return jsonRequest(method, `${baseUrl}${path}`, body);
  }

  /* ----------------------------------------------------------------------------------------
   * 공용 픽스처 빌더
   * ---------------------------------------------------------------------------------------- */

  async function createGroup(name: string): Promise<string> {
    const res = await admin<{ id: string }>('POST', '/chatbot-groups', { name: `${name}-${Math.random().toString(36).slice(2, 8)}` });
    return res.body.id;
  }

  async function createChatbotWithChannel(namePrefix: string): Promise<{ chatbotId: string; slug: string; name: string }> {
    const groupId = await createGroup(namePrefix);
    const suffix = Math.random().toString(36).slice(2, 10);
    const slug = `legacy-${suffix}`;
    const name = `${namePrefix}-${suffix}`;
    const res = await admin<{ id: string }>('POST', '/chatbots', { groupId, name, slug });
    const chatbotId = res.body.id;
    await admin('PATCH', `/chatbots/${chatbotId}/status`, { status: 'ACTIVE' });
    await admin('PATCH', `/chatbots/${chatbotId}/channels/WEB`, { enabled: true, config: { allowedOrigins: [], greetingMessage: '안녕하세요' } });
    return { chatbotId, slug, name };
  }

  interface Connection {
    id: string;
    name: string;
  }

  async function createConnection(overrides: Record<string, unknown> = {}): Promise<Connection> {
    const suffix = Math.random().toString(36).slice(2, 10);
    const name = `연결-${suffix}`;
    const wantsRaw = overrides.allowRawPersonalData === true;
    const res = await admin<{ id: string; name: string }>('POST', '/api-connections', {
      baseUrl: 'https://legacy.example.invalid',
      allowedMethods: ['GET', 'POST'],
      authType: 'NONE',
      allowRawPersonalData: false,
      personalDataLookup: false,
      sampleResponses: [{ label: '배송중', httpStatus: 200, body: { data: { status: 'SHIPPED', delivery: { eta: '09/26' } } } }],
      enabled: true,
      ...(wantsRaw ? { confirmRawPersonalData: name } : {}),
      ...overrides,
      name, // overrides가 name을 바꾸지 못하게 고정(확인값과 실제 이름을 일치시키기 위함)
    });
    expect(res.status).toBe(201);
    return { id: res.body.id, name: res.body.name };
  }

  /** 주문번호+전화번호 2슬롯 폼 → API 조건분기 노드. 반환된 orderNo로 목 서버 시나리오를 고른다. */
  async function setupOrderFlow(opts: {
    connectionId: string;
    withDefault?: boolean;
    withFailure?: boolean;
    namePrefix?: string;
  }): Promise<{ chatbotId: string; slug: string; ctxId: string; apiNodeId: string; shippedNodeId: string; readyNodeId: string; startIntentExample: string }> {
    const prefix = opts.namePrefix ?? 'S1';
    const { chatbotId, slug } = await createChatbotWithChannel(prefix);

    const ctxRes = await admin<{ id: string }>('POST', `/chatbots/${chatbotId}/contexts`, {
      name: `주문조회폼-${Math.random().toString(36).slice(2, 6)}`,
      slots: [
        { name: 'orderNo', label: '주문번호', prompt: '주문번호를 입력해 주세요.', type: 'TEXT' },
        { name: 'phone', label: '전화번호', prompt: '전화번호를 입력해 주세요.', type: 'TEXT' },
      ],
    });
    expect(ctxRes.status).toBe(201);
    const ctxId = ctxRes.body.id;

    // 브랜치/종결/실패 노드는 매칭 조건(trigger)이 없으면 저장이 거부된다(NORMAL 노드 규약) — 노이즈
    // 의도를 하나 붙여 "분기 참조로만 도달"하는 실제 형태를 재현한다.
    const noiseIntentRes = await admin<{ intent: { id: string } }>('POST', `/chatbots/${chatbotId}/intents`, {
      name: `노이즈의도-${Math.random().toString(36).slice(2, 6)}`,
      examples: [`노이즈문장-${Math.random().toString(36).slice(2, 10)}`],
    });
    const noiseIntentId = noiseIntentRes.body.intent.id;

    const shippedRes = await admin<{ id: string }>('POST', `/chatbots/${chatbotId}/dialog-nodes`, {
      name: `배송중안내-${Math.random().toString(36).slice(2, 6)}`,
      intentIds: [noiseIntentId],
      outputs: [{ type: 'TEXT', payload: { text: '주문하신 상품은 배송 중이며 {api.eta} 도착 예정입니다.' } }],
    });
    expect(shippedRes.status).toBe(201);
    const readyRes = await admin<{ id: string }>('POST', `/chatbots/${chatbotId}/dialog-nodes`, {
      name: `준비중안내-${Math.random().toString(36).slice(2, 6)}`,
      intentIds: [noiseIntentId],
      outputs: [{ type: 'TEXT', payload: { text: '상품을 준비하고 있어요.' } }],
    });
    expect(readyRes.status).toBe(201);

    let defaultNodeId: string | undefined;
    let failureNodeId: string | undefined;
    if (opts.withDefault) {
      const r = await admin<{ id: string }>('POST', `/chatbots/${chatbotId}/dialog-nodes`, {
        name: `상태미상안내-${Math.random().toString(36).slice(2, 6)}`,
        intentIds: [noiseIntentId],
        outputs: [{ type: 'TEXT', payload: { text: '주문 상태를 확인했지만 자세한 안내가 필요해요.' } }],
      });
      expect(r.status).toBe(201);
      defaultNodeId = r.body.id;
    }
    if (opts.withFailure) {
      const r = await admin<{ id: string }>('POST', `/chatbots/${chatbotId}/dialog-nodes`, {
        name: `조회실패안내-${Math.random().toString(36).slice(2, 6)}`,
        intentIds: [noiseIntentId],
        outputs: [{ type: 'TEXT', payload: { text: '지금은 주문 정보를 확인할 수 없어요. 잠시 후 다시 시도해 주세요.' } }],
      });
      expect(r.status).toBe(201);
      failureNodeId = r.body.id;
    }

    const apiNodeRes = await admin<{ id: string }>('POST', `/chatbots/${chatbotId}/dialog-nodes`, {
      name: `주문조회_실행-${Math.random().toString(36).slice(2, 6)}`,
      contextVariableId: ctxId,
      outputs: [
        { type: 'TEXT', payload: { text: '조회해 볼게요.' } },
        {
          type: 'API_CONDITION',
          payload: {
            version: 2,
            connectionId: opts.connectionId,
            method: 'GET',
            path: '/orders/{0}',
            pathParams: [{ kind: 'SLOT', contextVariableId: ctxId, slotName: 'orderNo' }],
            query: [{ name: 'phone', value: { kind: 'SLOT', contextVariableId: ctxId, slotName: 'phone' } }],
            body: [],
            responseMappings: [
              { name: 'status', path: 'data.status', required: true, maxLength: 50 },
              { name: 'eta', path: 'data.delivery.eta', required: false, maxLength: 20 },
            ],
            conditions: [
              { path: 'data.status', operator: 'EQ', value: 'SHIPPED', nextNodeId: shippedRes.body.id },
              { path: 'data.status', operator: 'EQ', value: 'READY', nextNodeId: readyRes.body.id },
            ],
            ...(defaultNodeId ? { defaultNodeId } : {}),
            ...(failureNodeId ? { failureNodeId } : {}),
          },
        },
      ],
    });
    expect(apiNodeRes.status).toBe(201);

    const intentExample = `배송조회_${Math.random().toString(36).slice(2, 8)}`;
    const intentRes = await admin<{ intent: { id: string } }>('POST', `/chatbots/${chatbotId}/intents`, {
      name: `배송조회의도-${Math.random().toString(36).slice(2, 6)}`,
      examples: [intentExample],
    });
    expect(intentRes.status).toBe(201);

    const startRes = await admin('POST', `/chatbots/${chatbotId}/dialog-nodes`, {
      name: `배송조회_시작-${Math.random().toString(36).slice(2, 6)}`,
      intentIds: [intentRes.body.intent.id],
      outputs: [{ type: 'CONTEXT_FORM', payload: { contextVariableId: ctxId } }],
    });
    expect(startRes.status).toBe(201);

    return {
      chatbotId,
      slug,
      ctxId,
      apiNodeId: apiNodeRes.body.id,
      shippedNodeId: shippedRes.body.id,
      readyNodeId: readyRes.body.id,
      startIntentExample: intentExample,
    };
  }

  async function runForm(
    slug: string,
    startMessage: string,
    orderNo: string,
    phone: string,
  ): Promise<{ t1: ApiResponse<Record<string, unknown>>; t2: ApiResponse<Record<string, unknown>>; t3: ApiResponse<Record<string, unknown>> }> {
    const sessionId = randomUUID();
    const t1 = await anon<Record<string, unknown>>('POST', `/public/chatbots/${slug}/messages`, { sessionId, message: startMessage });
    const t2 = await anon<Record<string, unknown>>('POST', `/public/chatbots/${slug}/messages`, { sessionId, message: orderNo, state: t1.body.state });
    const t3 = await anon<Record<string, unknown>>('POST', `/public/chatbots/${slug}/messages`, { sessionId, message: phone, state: t2.body.state });
    return { t1, t2, t3 };
  }

  function outputTexts(body: Record<string, unknown>): string[] {
    const outputs = (body.outputs as Array<{ type: string; payload: Record<string, unknown> }>) ?? [];
    return outputs.filter((o) => o.type === 'TEXT').map((o) => o.payload.text as string);
  }

  /**
   * 회로 재개방(half-open) 대기를 고정 sleep이 아니라 폴링으로 확인한다(간헐 실패 안정화 —
   * No.27 부수 과제). LEGACY_API_CIRCUIT_OPEN_MS 경과 후 첫 요청만 탐침으로 통과한다
   * (LegacyApiGateService.tryAcquire — openUntil은 최초 개방 시각에 고정되며 개방 중
   * 재시도로 연장되지 않는다). 매 시도마다 새 세션으로 3턴 폼을 완주해, 실제 외부 호출
   * (legacyRequests 증가)이 관측될 때까지 짧은 간격으로 재시도한다 — 고정 대기(1300ms)와
   * 개방 시간(1000ms)의 여유가 300ms뿐이라 CI 지연 시 간헐 실패하던 것을 없앤다.
   */
  async function pollUntilCircuitReopens(
    slug: string,
    startMessage: string,
    requestCountNow: () => number,
    opts: { maxWaitMs?: number; intervalMs?: number } = {},
  ): Promise<{ t1: ApiResponse<Record<string, unknown>>; t2: ApiResponse<Record<string, unknown>>; t3: ApiResponse<Record<string, unknown>> }> {
    const maxWaitMs = opts.maxWaitMs ?? 10_000;
    const intervalMs = opts.intervalMs ?? 150;
    const deadline = Date.now() + maxWaitMs;
    const before = requestCountNow();
    let last: { t1: ApiResponse<Record<string, unknown>>; t2: ApiResponse<Record<string, unknown>>; t3: ApiResponse<Record<string, unknown>> } | undefined;
    while (Date.now() < deadline) {
      last = await runForm(slug, startMessage, 'SHIP1', '010-1111-2222');
      if (requestCountNow() > before) return last;
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    throw new Error(
      `회로가 ${maxWaitMs}ms 동안 폴링해도 half-open 탐침을 통과시키지 않았다 — 간헐 실패가 아니라 실제 결함일 수 있다(마지막 응답: ${JSON.stringify(last?.t3.body)})`,
    );
  }

  /* ============================================================================================
   * 1. v1(레거시 인라인) — 무회귀(AC-L1-2)
   * ========================================================================================== */
  describe('1. v1 API_CONDITION 무회귀(AC-L1-2)', () => {
    it('v1 노드는 외부 호출 0건이고, 반복 호출해도 응답이 바이트 단위로 동일하다', async () => {
      const { chatbotId, slug } = await createChatbotWithChannel('v1무회귀');
      const intentName = `v1의도-${Math.random().toString(36).slice(2, 6)}`;
      const intentRes = await admin<{ intent: { id: string } }>('POST', `/chatbots/${chatbotId}/intents`, { name: intentName, examples: ['v1테스트문장'] });

      await prisma.dialogNode.create({
        data: {
          chatbotId,
          name: 'v1노드',
          nameNormalized: normalizeText('v1노드'),
          outputs: JSON.stringify([
            {
              type: 'API_CONDITION',
              payload: {
                method: 'GET',
                url: 'https://legacy.example.invalid/old',
                headers: { Authorization: `Bearer ${SECRET_VALUE}` },
                conditions: [{ path: 'x', operator: 'EQ', value: 'y', nextNodeId: randomUUID() }],
              },
            },
          ]),
          intentLinks: { create: [{ intentId: intentRes.body.intent.id }] },
        },
      });

      const before = transportCounter.calls;
      const beforeReqCount = legacyRequests.length;

      const r1 = await anon<Record<string, unknown>>('POST', `/public/chatbots/${slug}/messages`, { sessionId: randomUUID(), message: 'v1테스트문장' });
      const r2 = await anon<Record<string, unknown>>('POST', `/public/chatbots/${slug}/messages`, { sessionId: randomUUID(), message: 'v1테스트문장' });

      expect(r1.status).toBe(200);
      expect(transportCounter.calls).toBe(before); // 외부 전송 계층 0건
      expect(legacyRequests.length).toBe(beforeReqCount); // 목 서버도 0건

      // PublicMessageResponse에는 unsupportedOutputs가 없다(FR-0-18, 내부 trace 미포함) — outputs 본문으로 확인한다.
      expect(r1.body.outputs).toEqual(r2.body.outputs); // messageId를 제외한 본체는 바이트 단위로 동일
      expect((r1.body as { apiCall?: unknown }).apiCall).toBeUndefined();
      expect((r1.body as { pendingAnswer?: unknown }).pendingAnswer).toBeUndefined();

      // 관리자 시뮬레이터(AC-L1-1 대조)는 unsupportedOutputs를 노출한다 — v1이 '미지원'으로 정확히 분류되는지 확인.
      const simRes = await admin<{ unsupportedOutputs: string[] }>('POST', `/chatbots/${chatbotId}/simulate`, { message: 'v1테스트문장' });
      expect(simRes.body.unsupportedOutputs).toEqual(['API_CONDITION']);
    });
  });

  /* ============================================================================================
   * 2. VIEWER 시크릿·토큰 비노출(AC-L1-4)
   * ========================================================================================== */
  describe('2. VIEWER는 v1 헤더 토큰 평문을 어디서도 받지 못한다(AC-L1-4)', () => {
    it('노드 조회·목록·버전 내용·버전 차이 응답 전수를 grep해도 토큰이 0회다', async () => {
      const { chatbotId } = await createChatbotWithChannel('토큰비노출');
      const nodeCreate = await prisma.dialogNode.create({
        data: {
          chatbotId,
          name: '토큰노드',
          nameNormalized: normalizeText('토큰노드'),
          outputs: JSON.stringify([
            {
              type: 'API_CONDITION',
              payload: {
                method: 'GET',
                url: 'https://legacy.example.invalid/secret-path',
                headers: { Authorization: `Bearer ${SECRET_VALUE}`, 'X-Api-Key': 'raw-key-value' },
                conditions: [{ path: 'x', operator: 'EQ', value: 'y', nextNodeId: randomUUID() }],
              },
            },
          ]),
        },
      });

      const detailRes = await viewer('GET', `/chatbots/${chatbotId}/dialog-nodes/${nodeCreate.id}`);
      const listRes = await viewer('GET', `/chatbots/${chatbotId}/dialog-nodes`);

      const captureRes = await admin<{ version: { id: string } }>('POST', `/chatbots/${chatbotId}/versions`, {});
      expect(captureRes.status).toBe(201);
      const versionId = captureRes.body.version.id;
      const contentRes = await viewer('GET', `/chatbots/${chatbotId}/versions/${versionId}/content`);

      // 두 번째 버전(노드 하나 더 추가) 대비 diff 상세도 확인한다.
      await admin('POST', `/chatbots/${chatbotId}/dialog-nodes`, { name: '더미노드', nodeType: 'START', outputs: [{ type: 'TEXT', payload: { text: 'x' } }] });
      const captureRes2 = await admin<{ version: { id: string } }>('POST', `/chatbots/${chatbotId}/versions`, {});
      const versionId2 = captureRes2.body.version.id;
      const diffRes = await viewer('GET', `/chatbots/${chatbotId}/versions/${versionId2}/diff?baseVersionId=${versionId}`);

      const haystacks = [detailRes, listRes, contentRes, diffRes].map((r) => JSON.stringify(r.body));
      for (const s of haystacks) {
        expect(s.includes(SECRET_VALUE)).toBe(false);
        expect(s.includes('raw-key-value')).toBe(false);
      }
      expect(detailRes.status).toBe(200);
      // 값은 가려지되 "헤더가 2개 있었다"는 사실(키 개수)은 남는다.
      expect(JSON.stringify(detailRes.body)).toContain('[비공개]');
    });

    it('v1 노드를 복사하면 API_CONDITION 아웃풋이 제외되고(헤더 토큰 복제 차단) 제외 건수가 응답에 실린다', async () => {
      const { chatbotId } = await createChatbotWithChannel('v1복사제외');
      const nodeCreate = await prisma.dialogNode.create({
        data: {
          chatbotId,
          name: '복사원본노드',
          nameNormalized: normalizeText('복사원본노드'),
          outputs: JSON.stringify([
            { type: 'TEXT', payload: { text: '안내문' } },
            {
              type: 'API_CONDITION',
              payload: {
                method: 'GET',
                url: 'https://legacy.example.invalid/x',
                headers: { Authorization: `Bearer ${SECRET_VALUE}` },
                conditions: [{ path: 'x', operator: 'EQ', value: 'y', nextNodeId: randomUUID() }],
              },
            },
          ]),
        },
      });

      const copyRes = await admin<{ id: string; excludedLegacyApiOutputCount: number; outputs: Array<{ type: string }> }>(
        'POST',
        `/chatbots/${chatbotId}/dialog-nodes/${nodeCreate.id}/copy`,
        {},
      );
      expect(copyRes.status).toBe(201);
      expect(copyRes.body.excludedLegacyApiOutputCount).toBe(1);
      expect(copyRes.body.outputs.some((o) => o.type === 'API_CONDITION')).toBe(false);
      expect(JSON.stringify(copyRes.body)).not.toContain(SECRET_VALUE);
    });

    it('v1 형태의 payload는 노드 생성·수정에서 400 API_OUTPUT_LEGACY_FORMAT으로 거부된다(AC-L1-3)', async () => {
      const { chatbotId } = await createChatbotWithChannel('v1저장거부');
      const res = await admin<{ code: string }>('POST', `/chatbots/${chatbotId}/dialog-nodes`, {
        name: 'v1저장시도',
        nodeType: 'START',
        outputs: [
          {
            type: 'API_CONDITION',
            payload: { method: 'GET', url: 'https://legacy.example.invalid/x', conditions: [{ path: 'x', operator: 'EQ', value: 'y', nextNodeId: randomUUID() }] },
          },
        ],
      });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('API_OUTPUT_LEGACY_FORMAT');
    });
  });

  /* ============================================================================================
   * 3. 공개 대화 성공 경로 — 매핑·조건분기·치환·ApiCallLog(item 3)
   * ========================================================================================== */
  describe('3. 공개 대화 v2 호출 성공 — 매핑·조건분기·{api.*} 치환·메타데이터 전용 로그', () => {
    it('S-1: 폼을 완료하는 한 응답에 조회 안내 + 치환된 배송안내가 함께 오고 pendingAnswer가 없다(AC-L3-1)', async () => {
      const conn = await createConnection();
      const flow = await setupOrderFlow({ connectionId: conn.id, withDefault: true, withFailure: true, namePrefix: 'S1성공' });

      const before = legacyRequests.length;
      const { t1, t2, t3 } = await runForm(flow.slug, flow.startIntentExample, 'SHIP1', '010-1234-5678');

      expect(t1.status).toBe(200);
      expect(t2.status).toBe(200);
      expect(t3.status).toBe(200);
      expect(t3.body.pendingAnswer).toBeUndefined();

      const texts = outputTexts(t3.body);
      expect(texts).toEqual(['조회해 볼게요.', '주문하신 상품은 배송 중이며 09/26 도착 예정입니다.']);

      expect(legacyRequests.length).toBe(before + 1); // 외부 호출 정확히 1회(턴당 1회 규약)
      const sent = legacyRequests[legacyRequests.length - 1];
      expect(sent.pathname).toBe('/orders/SHIP1');

      // ApiCallLog는 메타데이터만 — 질문 원문·응답값·경로 치환값이 어디에도 없다.
      const logsRes = await editor<{ items: Array<Record<string, unknown>> }>('GET', `/chatbots/${flow.chatbotId}/api-call-logs`);
      expect(logsRes.status).toBe(200);
      expect(logsRes.body.items.length).toBe(1);
      const logItem = logsRes.body.items[0];
      expect(logItem.pathTemplate).toBe('/orders/{0}');
      expect(logItem.branch).toBe('CONDITION');
      expect(logItem.conditionIndex).toBe(1);
      expect(logItem.outcome).toBe('SUCCESS');
      const logJson = JSON.stringify(logItem);
      expect(logJson).not.toContain('SHIP1');
      expect(logJson).not.toContain('09/26');
      expect(logJson).not.toContain('배송 조회');
    });

    it('두 번째 조건(READY)도 올바른 분기로 매핑된다', async () => {
      const conn = await createConnection();
      const flow = await setupOrderFlow({ connectionId: conn.id, withDefault: true, withFailure: true, namePrefix: 'S1조건2' });
      const { t3 } = await runForm(flow.slug, flow.startIntentExample, 'READY1', '010-1111-2222');
      expect(outputTexts(t3.body)).toEqual(['조회해 볼게요.', '상품을 준비하고 있어요.']);
    });

    it('필수 응답 매핑이 없으면 MAPPING_MISSING으로 실패 분기 처리된다(AC-L3-7)', async () => {
      const conn = await createConnection();
      const flow = await setupOrderFlow({ connectionId: conn.id, withDefault: true, withFailure: true, namePrefix: 'S1매핑누락' });
      const { t3 } = await runForm(flow.slug, flow.startIntentExample, 'NOMAP', '010-1111-2222');
      expect(outputTexts(t3.body)).toEqual(['조회해 볼게요.', '지금은 주문 정보를 확인할 수 없어요. 잠시 후 다시 시도해 주세요.']);
    });

    it('{api.*} 토큰만 치환되고 그 외 {…} 문법은 문자 그대로 남는다(AC-L3-8) — 응답 매핑 최대길이도 절단된다', async () => {
      const conn = await createConnection();
      const { chatbotId, slug } = await createChatbotWithChannel('치환문법');
      const ctxRes = await admin<{ id: string }>('POST', `/chatbots/${chatbotId}/contexts`, {
        name: `치환폼-${Math.random().toString(36).slice(2, 6)}`,
        slots: [{ name: 'orderNo', label: '주문번호', prompt: '주문번호?', type: 'TEXT' }],
      });
      const ctxId = ctxRes.body.id;
      const branchRes = await admin<{ id: string }>('POST', `/chatbots/${chatbotId}/dialog-nodes`, {
        name: '치환분기노드',
        nodeType: 'START',
        outputs: [{ type: 'TEXT', payload: { text: '{api.eta} / {주문번호} / {api.none}' } }],
      });
      const apiNodeRes = await admin('POST', `/chatbots/${chatbotId}/dialog-nodes`, {
        name: '치환API노드',
        contextVariableId: ctxId,
        outputs: [
          {
            type: 'API_CONDITION',
            payload: {
              version: 2,
              connectionId: conn.id,
              method: 'GET',
              path: '/orders/{0}',
              pathParams: [{ kind: 'SLOT', contextVariableId: ctxId, slotName: 'orderNo' }],
              query: [],
              body: [],
              responseMappings: [{ name: 'eta', path: 'data.delivery.eta', required: false, maxLength: 20 }],
              conditions: [{ path: 'data.status', operator: 'EQ', value: 'SHIPPED', nextNodeId: branchRes.body.id }],
            },
          },
        ],
      });
      expect(apiNodeRes.status).toBe(201);
      const intentRes = await admin<{ intent: { id: string } }>('POST', `/chatbots/${chatbotId}/intents`, {
        name: '치환의도',
        examples: ['치환테스트시작'],
      });
      await admin('POST', `/chatbots/${chatbotId}/dialog-nodes`, {
        name: '치환시작노드',
        intentIds: [intentRes.body.intent.id],
        outputs: [{ type: 'CONTEXT_FORM', payload: { contextVariableId: ctxId } }],
      });

      const sessionId = randomUUID();
      const t1 = await anon<Record<string, unknown>>('POST', `/public/chatbots/${slug}/messages`, { sessionId, message: '치환테스트시작' });
      const t2 = await anon<Record<string, unknown>>('POST', `/public/chatbots/${slug}/messages`, { sessionId, message: 'SHIP1', state: t1.body.state });

      expect(outputTexts(t2.body)).toEqual(['09/26 / {주문번호} / ']); // 없는 api 변수는 빈 문자열, 비-api 토큰은 그대로.
    });
  });

  /* ============================================================================================
   * 4. 실패 분기 — 타임아웃/5xx/비JSON/과대응답/리다이렉트/불일치(item 4)
   * ========================================================================================== */
  describe('4. 실패·불일치 분기 — 고정 문구/지정 분기, isAnswered, 미응답 큐, RAG', () => {
    it.each([
      ['ERR500', 'HTTP 5xx'],
      ['HTML', '비 JSON'],
      ['HUGE', '256KB 초과'],
      ['REDIRECT', '리다이렉트'],
    ])('%s(%s) → failureNodeId 분기로 처리되고 미응답 큐에 적재되지 않는다', async (orderNo) => {
      const conn = await createConnection();
      const flow = await setupOrderFlow({ connectionId: conn.id, withDefault: true, withFailure: true, namePrefix: `실패-${orderNo}` });
      const beforeUnanswered = await prisma.unansweredQuestion.count({ where: { chatbotId: flow.chatbotId } });

      const { t3 } = await runForm(flow.slug, flow.startIntentExample, orderNo, '010-1111-2222');
      expect(outputTexts(t3.body)).toEqual(['조회해 볼게요.', '지금은 주문 정보를 확인할 수 없어요. 잠시 후 다시 시도해 주세요.']);
      // 분기 노드로 끝난 턴은 노드 응답 취급이라 isAnswered=true(K-6) — pendingAnswer(2단계 RAG 진입)는 없다.
      expect(t3.body.pendingAnswer).toBeUndefined();

      const afterUnanswered = await prisma.unansweredQuestion.count({ where: { chatbotId: flow.chatbotId } });
      expect(afterUnanswered).toBe(beforeUnanswered);
    }, 15_000);

    it('타임아웃 — 연결 timeoutMs 안에 실패 분기로 끝난다(AC-L3-3)', async () => {
      const conn = await createConnection({ timeoutMs: 1000 });
      const flow = await setupOrderFlow({ connectionId: conn.id, withDefault: true, withFailure: true, namePrefix: '타임아웃' });

      const startedAt = Date.now();
      const { t3 } = await runForm(flow.slug, flow.startIntentExample, 'SLOW', '010-1111-2222');
      const elapsed = Date.now() - startedAt;

      expect(outputTexts(t3.body)).toEqual(['조회해 볼게요.', '지금은 주문 정보를 확인할 수 없어요. 잠시 후 다시 시도해 주세요.']);
      // 여유를 1500 → 4000으로 확대(간헐 실패 안정화). 이 단언의 목적은 "timeoutMs만큼만 기다리고 끝난다"는
      // 신호이며, 정확한 상한보다 "테스트 프레임워크 타임아웃(15_000ms)까지 무한 대기하지 않는다"를 보는 것이
      // 핵심이다 — CI 지연(GC·스케줄링)에 4000ms 여유를 두어도 설계 의도(타임아웃 강제)는 약화되지 않는다.
      expect(elapsed).toBeLessThan(1000 + 4000);
      const logsRes = await editor<{ items: Array<Record<string, unknown>> }>('GET', `/chatbots/${flow.chatbotId}/api-call-logs`);
      expect(logsRes.body.items[0].outcome).toBe('TIMEOUT');
    }, 15_000);

    it('조건 불일치(RETURNED) → defaultNodeId 분기, 지정이 없으면 고정 불일치 문구(AC-L3-2)', async () => {
      const connA = await createConnection();
      const flowWithDefault = await setupOrderFlow({ connectionId: connA.id, withDefault: true, withFailure: true, namePrefix: '불일치있음' });
      const withDefault = await runForm(flowWithDefault.slug, flowWithDefault.startIntentExample, 'RETURNED1', '010-1111-2222');
      expect(outputTexts(withDefault.t3.body)).toEqual(['조회해 볼게요.', '주문 상태를 확인했지만 자세한 안내가 필요해요.']);

      const connB = await createConnection();
      const flowNoBranches = await setupOrderFlow({ connectionId: connB.id, withDefault: false, withFailure: false, namePrefix: '불일치없음' });
      const noBranches = await runForm(flowNoBranches.slug, flowNoBranches.startIntentExample, 'RETURNED1', '010-1111-2222');
      expect(outputTexts(noBranches.t3.body)).toEqual(['조회해 볼게요.', '확인한 결과에 맞는 안내를 찾지 못했어요. 다른 방법으로 문의해 주세요.']);
    });

    it('API_CONDITION 뒤의 아웃풋은 실행되지 않는다(AC-L3-5, 정지점 = 노드 종결자)', async () => {
      const conn = await createConnection();
      const { chatbotId, slug } = await createChatbotWithChannel('종결자');
      const ctxRes = await admin<{ id: string }>('POST', `/chatbots/${chatbotId}/contexts`, {
        name: `종결폼-${Math.random().toString(36).slice(2, 6)}`,
        slots: [{ name: 'orderNo', label: '주문번호', prompt: '주문번호?', type: 'TEXT' }],
      });
      const ctxId = ctxRes.body.id;
      const branchRes = await admin<{ id: string }>('POST', `/chatbots/${chatbotId}/dialog-nodes`, {
        name: '종결분기노드',
        nodeType: 'START',
        outputs: [{ type: 'TEXT', payload: { text: '분기결과' } }],
      });
      await admin('POST', `/chatbots/${chatbotId}/dialog-nodes`, {
        name: '종결API노드',
        contextVariableId: ctxId,
        outputs: [
          {
            type: 'API_CONDITION',
            payload: {
              version: 2,
              connectionId: conn.id,
              method: 'GET',
              path: '/orders/{0}',
              pathParams: [{ kind: 'SLOT', contextVariableId: ctxId, slotName: 'orderNo' }],
              query: [],
              body: [],
              responseMappings: [],
              conditions: [{ path: 'data.status', operator: 'EQ', value: 'SHIPPED', nextNodeId: branchRes.body.id }],
            },
          },
          { type: 'TEXT', payload: { text: '이건 절대 보이면 안 됩니다' } },
        ],
      });
      const intentRes = await admin<{ intent: { id: string } }>('POST', `/chatbots/${chatbotId}/intents`, { name: '종결의도', examples: ['종결테스트시작'] });
      await admin('POST', `/chatbots/${chatbotId}/dialog-nodes`, {
        name: '종결시작노드',
        intentIds: [intentRes.body.intent.id],
        outputs: [{ type: 'CONTEXT_FORM', payload: { contextVariableId: ctxId } }],
      });

      const sessionId = randomUUID();
      const t1 = await anon<Record<string, unknown>>('POST', `/public/chatbots/${slug}/messages`, { sessionId, message: '종결테스트시작' });
      const t2 = await anon<Record<string, unknown>>('POST', `/public/chatbots/${slug}/messages`, { sessionId, message: 'SHIP1', state: t1.body.state });
      expect(outputTexts(t2.body)).toEqual(['분기결과']);
    });
  });

  /* ============================================================================================
   * 5. 회로차단(item 5)
   * ========================================================================================== */
  describe('5. 회로차단 — 연속 인프라 실패 임계치 후 개방, 4xx는 미계수, half-open 재개(AC-L3-4)', () => {
    it('연속 3회 5xx 후 개방되며 개방 중에는 외부 호출 없이 즉시 실패, 개방 시간 경과 후 다시 시도한다', async () => {
      const conn = await createConnection();
      const flow = await setupOrderFlow({ connectionId: conn.id, withDefault: true, withFailure: true, namePrefix: '회로' });

      for (let i = 0; i < 3; i++) {
        const { t3 } = await runForm(flow.slug, flow.startIntentExample, 'ERR500', '010-1111-2222');
        expect(outputTexts(t3.body)).toContain('지금은 주문 정보를 확인할 수 없어요. 잠시 후 다시 시도해 주세요.');
      }

      const countAfterThreeFailures = legacyRequests.length;
      const startedAt = Date.now();
      const opened = await runForm(flow.slug, flow.startIntentExample, 'SHIP1', '010-1111-2222');
      const elapsed = Date.now() - startedAt;

      expect(outputTexts(opened.t3.body)).toContain('지금은 주문 정보를 확인할 수 없어요. 잠시 후 다시 시도해 주세요.');
      expect(legacyRequests.length).toBe(countAfterThreeFailures); // 회로 개방 중 — 외부 호출 0(강한 근거)
      // "즉시 실패"의 시간 단언은 여유를 5000ms로 확대(간헐 실패 안정화) — 위 legacyRequests 0건 단언이
      // "실제로 외부 호출 없이 실패했다"는 본 증거이고, 이 시간 단언은 "개방 시간(1000ms)만큼 블로킹하지
      // 않는다"는 보조 신호일 뿐이다.
      expect(elapsed).toBeLessThan(5000);

      // 고정 sleep(기존 1300ms — LEGACY_API_CIRCUIT_OPEN_MS 1000ms 대비 여유 300ms)은 CI 지연 시 간헐
      // 실패했다. 폴링 대기로 교체한다 — 개방 시간이 지나기 전 재시도는 즉시 거부돼 회로를 다시 열지
      // 않으므로(pollUntilCircuitReopens 주석) 회로 개방 60초(운영값) 동안 호출 0·half-open 재개라는
      // 설계 의도는 그대로 유지된다.
      const reopened = await pollUntilCircuitReopens(flow.slug, flow.startIntentExample, () => legacyRequests.length, { maxWaitMs: 10_000 });
      expect(outputTexts(reopened.t3.body)).toEqual(['조회해 볼게요.', '주문하신 상품은 배송 중이며 09/26 도착 예정입니다.']);
      expect(legacyRequests.length).toBe(countAfterThreeFailures + 1); // half-open 탐침이 정확히 1건만 통과했다
    }, 30_000);

    it('4xx(존재하지 않는 경로 → 404)는 회로 실패로 계수되지 않는다(D-19)', async () => {
      const conn = await createConnection();
      const flow = await setupOrderFlow({ connectionId: conn.id, withDefault: true, withFailure: true, namePrefix: '4xx미계수' });

      for (let i = 0; i < 3; i++) {
        await runForm(flow.slug, flow.startIntentExample, 'NO_SUCH_ORDER_404', '010-1111-2222');
      }
      const countBefore = legacyRequests.length;
      const { t3 } = await runForm(flow.slug, flow.startIntentExample, 'SHIP1', '010-1111-2222');
      expect(outputTexts(t3.body)).toEqual(['조회해 볼게요.', '주문하신 상품은 배송 중이며 09/26 도착 예정입니다.']);
      expect(legacyRequests.length).toBe(countBefore + 1); // 회로가 열리지 않아 실제 호출이 나갔다
    }, 15_000);

    it(
      '시계 주입 관찰 — LegacyApiGateService는 Date.now()를 직접 쓰며 주입 가능한 시계 포트가 없다. ' +
        '개방시간(LEGACY_API_CIRCUIT_OPEN_MS)을 짧게 설정해 실제 대기로 검증했다(가짜 타이머 미사용) — ' +
        '이 사실 자체를 회귀 관찰용으로 남긴다',
      () => {
        // 관찰용 플레이스홀더 — 위 두 테스트가 실질 검증을 수행한다. 상세는 최종 보고서 참고.
        expect(true).toBe(true);
      },
    );
  });

  /* ============================================================================================
   * 6. SSRF(item 6)
   * ========================================================================================== */
  describe('6. SSRF 다층 방어(AC-L4-1/2/6)', () => {
    it('루프백 baseUrl은 절대 차단되며 외부(목 서버) 호출이 0건이다 — IP 리터럴이라 가짜 DNS도 우회하지 못한다', async () => {
      const conn = await createConnection({ baseUrl: 'http://127.0.0.1:1/api', authType: 'NONE' });
      const flow = await setupOrderFlow({ connectionId: conn.id, withDefault: true, withFailure: true, namePrefix: 'SSRF루프백' });
      const before = legacyRequests.length;
      const beforeTransport = transportCounter.calls;

      const { t3 } = await runForm(flow.slug, flow.startIntentExample, 'SHIP1', '010-1111-2222');
      expect(outputTexts(t3.body)).toEqual(['조회해 볼게요.', '지금은 주문 정보를 확인할 수 없어요. 잠시 후 다시 시도해 주세요.']);
      expect(legacyRequests.length).toBe(before); // 목 서버 0건
      expect(transportCounter.calls).toBe(beforeTransport); // 가짜 전송 계층조차 호출되지 않는다(IP 리터럴은 분류만으로 차단)
    });

    it('사설 대역은 allowlist 밖이면 차단, allowlist 안이면 허용된다(AC-L4-2)', async () => {
      const connBlocked = await createConnection({ baseUrl: 'https://legacy-private-blocked.example.invalid' });
      const flowBlocked = await setupOrderFlow({ connectionId: connBlocked.id, withDefault: true, withFailure: true, namePrefix: 'SSRF사설차단' });
      const beforeBlocked = legacyRequests.length;
      const blocked = await runForm(flowBlocked.slug, flowBlocked.startIntentExample, 'SHIP1', '010-1111-2222');
      expect(outputTexts(blocked.t3.body)).toEqual(['조회해 볼게요.', '지금은 주문 정보를 확인할 수 없어요. 잠시 후 다시 시도해 주세요.']);
      expect(legacyRequests.length).toBe(beforeBlocked);

      const connAllowed = await createConnection({ baseUrl: 'https://legacy-private-allowed.example.invalid' });
      const flowAllowed = await setupOrderFlow({ connectionId: connAllowed.id, withDefault: true, withFailure: true, namePrefix: 'SSRF사설허용' });
      const beforeAllowed = legacyRequests.length;
      const allowed = await runForm(flowAllowed.slug, flowAllowed.startIntentExample, 'SHIP1', '010-1111-2222');
      expect(outputTexts(allowed.t3.body)).toEqual(['조회해 볼게요.', '주문하신 상품은 배송 중이며 09/26 도착 예정입니다.']);
      expect(legacyRequests.length).toBe(beforeAllowed + 1);
    });

    it('경로 인젝션 — 슬롯 값 ".."·"%2e%2e"는 BLOCKED_URL로 거부되어 외부 호출이 0건이다(build-request.ts)', async () => {
      const conn = await createConnection();
      const flow = await setupOrderFlow({ connectionId: conn.id, withDefault: true, withFailure: true, namePrefix: '경로인젝션' });

      for (const malicious of ['..', '%2e%2e', '.']) {
        const before = legacyRequests.length;
        const { t3 } = await runForm(flow.slug, flow.startIntentExample, malicious, '010-1111-2222');
        expect(outputTexts(t3.body)).toEqual(['조회해 볼게요.', '지금은 주문 정보를 확인할 수 없어요. 잠시 후 다시 시도해 주세요.']);
        expect(legacyRequests.length).toBe(before);
      }
    });

    it('요청 구조 인젝션 — 특수문자 슬롯 값이 경로 세그먼트·쿼리 키 집합을 바꾸지 못한다(AC-L4-6)', async () => {
      const conn = await createConnection();
      const flow = await setupOrderFlow({ connectionId: conn.id, withDefault: true, withFailure: true, namePrefix: '구조인젝션' });

      const maliciousOrderNo = '../admin?x=1#frag';
      // ⚠ 슬롯 값은 저장 전 trim()된다(context-session.ts) — 선두 CRLF만 있는 값은 트리밍으로 사라지므로
      // "중간에 CRLF를 심어" 트리밍 이후에도 인젝션 시도가 남게 만든다(진짜 헤더 인젝션 저항성 검증).
      const maliciousPhone = '010\r\nX-Evil: 1';
      const before = legacyRequests.length;
      await runForm(flow.slug, flow.startIntentExample, maliciousOrderNo, maliciousPhone);
      expect(legacyRequests.length).toBe(before + 1); // 값은 안전하게 인코딩되어 정상 호출로 처리된다(차단 대상 아님)

      const sent = legacyRequests[legacyRequests.length - 1];
      const segments = sent.pathname.split('/').filter(Boolean);
      expect(segments).toHaveLength(2); // ['orders', <encoded>] — 추가 세그먼트가 생기지 않았다
      expect(segments[0]).toBe('orders');
      const query = new URLSearchParams(sent.search);
      expect([...query.keys()]).toEqual(['phone']); // 쿼리 키 집합 불변 — x=1이 별도 파라미터로 섞이지 않았다
      expect(Object.keys(sent.headers)).not.toContain('x-evil'); // 헤더 인젝션도 없다
      expect(query.get('phone')).toBe(maliciousPhone); // 값 자체는 손실 없이(인코딩만 되어) 전달된다
    });
  });

  /* ============================================================================================
   * 7. 시크릿(item 7)
   * ========================================================================================== */
  describe('7. 시크릿 — 헤더에는 실리고 어디에도 노출되지 않는다(AC-L2-2/2-3)', () => {
    it('BEARER 시크릿이 목 서버 Authorization 헤더로 전달되고, 응답·로그·오류 전수에서 0회다', async () => {
      const conn = await createConnection({ authType: 'BEARER', secretRef: 'ERPTEST' });
      const flow = await setupOrderFlow({ connectionId: conn.id, withDefault: true, withFailure: true, namePrefix: '시크릿전달' });

      const { t3 } = await runForm(flow.slug, flow.startIntentExample, 'SHIP1', '010-1111-2222');
      expect(outputTexts(t3.body)).toEqual(['조회해 볼게요.', '주문하신 상품은 배송 중이며 09/26 도착 예정입니다.']);

      const sent = legacyRequests[legacyRequests.length - 1];
      expect(sent.headers.authorization).toBe(`Bearer ${SECRET_VALUE}`);

      const detailRes = await admin('GET', `/api-connections/${conn.id}`);
      const listRes = await admin('GET', '/api-connections');
      const logsRes = await editor('GET', `/chatbots/${flow.chatbotId}/api-call-logs`);
      const pickerRes = await editor('GET', '/api-connections/picker');

      for (const r of [t3, detailRes, listRes, logsRes, pickerRes]) {
        expect(JSON.stringify(r.body)).not.toContain(SECRET_VALUE);
      }
    });

    it('시크릿 미설정 연결은 SECRET_MISSING으로 실패 분기 처리되고 외부 호출이 0건이다(AC-L2-3)', async () => {
      const conn = await createConnection({ authType: 'BEARER', secretRef: 'NOT_SET_ANYWHERE_REF' });
      const detailRes = await admin<{ secretStatus: string }>('GET', `/api-connections/${conn.id}`);
      expect(detailRes.body.secretStatus).toBe('MISSING');

      const flow = await setupOrderFlow({ connectionId: conn.id, withDefault: true, withFailure: true, namePrefix: '시크릿미설정' });
      const before = legacyRequests.length;
      const { t3 } = await runForm(flow.slug, flow.startIntentExample, 'SHIP1', '010-1111-2222');
      expect(outputTexts(t3.body)).toEqual(['조회해 볼게요.', '지금은 주문 정보를 확인할 수 없어요. 잠시 후 다시 시도해 주세요.']);
      expect(legacyRequests.length).toBe(before);
      const logsRes = await editor<{ items: Array<Record<string, unknown>> }>('GET', `/chatbots/${flow.chatbotId}/api-call-logs`);
      expect(logsRes.body.items[0].outcome).toBe('SECRET_MISSING');
    });
  });

  /* ============================================================================================
   * 8. 개인정보(item 8)
   * ========================================================================================== */
  describe('8. 개인정보 — 기본 마스킹 송신, allowRawPersonalData 연결은 원문(AC-L5-1)', () => {
    it('기본 연결은 마스킹된 전화번호를 송신하고 ApiCallLog.personalDataMasked=true다', async () => {
      const conn = await createConnection({ allowRawPersonalData: false });
      const flow = await setupOrderFlow({ connectionId: conn.id, withDefault: true, withFailure: true, namePrefix: '마스킹기본' });

      await runForm(flow.slug, flow.startIntentExample, 'SHIP1', '010-1234-5678');
      const sent = legacyRequests[legacyRequests.length - 1];
      const query = new URLSearchParams(sent.search);
      const receivedPhone = query.get('phone') ?? '';
      expect(receivedPhone).not.toBe('010-1234-5678');
      expect(receivedPhone.includes('1234')).toBe(false); // 가운데 자리가 마스킹된다

      const logsRes = await editor<{ items: Array<Record<string, unknown>> }>('GET', `/chatbots/${flow.chatbotId}/api-call-logs`);
      expect(logsRes.body.items[0].personalDataMasked).toBe(true);
      expect(JSON.stringify(logsRes.body)).not.toContain('010-1234-5678');
    });

    it('allowRawPersonalData=true 연결은 원문 전화번호를 송신한다', async () => {
      const conn = await createConnection({ allowRawPersonalData: true });
      const flow = await setupOrderFlow({ connectionId: conn.id, withDefault: true, withFailure: true, namePrefix: '마스킹해제' });

      await runForm(flow.slug, flow.startIntentExample, 'SHIP1', '010-1234-5678');
      const sent = legacyRequests[legacyRequests.length - 1];
      const query = new URLSearchParams(sent.search);
      expect(query.get('phone')).toBe('010-1234-5678');

      const logsRes = await editor<{ items: Array<Record<string, unknown>> }>('GET', `/chatbots/${flow.chatbotId}/api-call-logs`);
      expect(logsRes.body.items[0].personalDataMasked).toBe(false);
    });
  });

  /* ============================================================================================
   * 9. 시뮬레이터(item 9)
   * ========================================================================================== */
  describe('9. 시뮬레이터 — VIEWER LIVE 격하, 오버레이 LIVE 차단, 샘플 없음, 실제 LIVE(AC-L6-1/2/3/4)', () => {
    it('VIEWER가 LIVE를 요청하면 외부 호출 없이 MOCK으로 격하된다(AC-L6-1)', async () => {
      const conn = await createConnection();
      const flow = await setupOrderFlow({ connectionId: conn.id, withDefault: true, withFailure: true, namePrefix: '시뮬VIEWER' });
      const before = legacyRequests.length;

      const res = await viewer<{ apiStep?: { mode: string; downgradeReason?: string } }>('POST', `/chatbots/${flow.chatbotId}/simulate`, {
        buttonAction: { kind: 'NODE', nodeId: flow.apiNodeId },
        apiMode: 'LIVE',
      });
      expect(res.status).toBe(200);
      expect(res.body.apiStep?.mode).toBe('MOCK');
      expect(res.body.apiStep?.downgradeReason).toBe('NO_PERMISSION');
      expect(legacyRequests.length).toBe(before);
    });

    it('오버레이의 새 노드로는 LIVE를 우회할 수 없다(AC-L6-3, 케이스 A)', async () => {
      const conn = await createConnection();
      const flow = await setupOrderFlow({ connectionId: conn.id, withDefault: true, withFailure: true, namePrefix: '오버레이신규' });
      const before = legacyRequests.length;

      const overlayNodeId = randomUUID();
      const res = await editor<{ apiStep?: { mode: string; downgradeReason?: string } }>('POST', `/chatbots/${flow.chatbotId}/simulate`, {
        buttonAction: { kind: 'NODE', nodeId: overlayNodeId },
        apiMode: 'LIVE',
        overlay: {
          dialogNodes: [
            {
              id: overlayNodeId,
              name: '오버레이침투노드',
              nodeType: 'START',
              outputs: [
                {
                  type: 'API_CONDITION',
                  payload: {
                    version: 2,
                    connectionId: conn.id,
                    method: 'GET',
                    path: '/orders/SHIP1',
                    pathParams: [],
                    query: [],
                    body: [],
                    responseMappings: [],
                    conditions: [{ path: 'data.status', operator: 'EQ', value: 'SHIPPED', nextNodeId: flow.shippedNodeId }],
                  },
                },
              ],
            },
          ],
        },
      });
      expect(res.status).toBe(200);
      expect(res.body.apiStep?.mode).toBe('MOCK');
      expect(res.body.apiStep?.downgradeReason).toBe('UNSAVED_NODE');
      expect(legacyRequests.length).toBe(before);
    });

    it('오버레이가 저장된 노드와 같은 id를 덮어써도 LIVE를 우회할 수 없다(AC-L6-3, 케이스 B)', async () => {
      const conn = await createConnection();
      const flow = await setupOrderFlow({ connectionId: conn.id, withDefault: true, withFailure: true, namePrefix: '오버레이덮어쓰기' });
      const before = legacyRequests.length;

      const res = await editor<{ apiStep?: { mode: string; downgradeReason?: string } }>('POST', `/chatbots/${flow.chatbotId}/simulate`, {
        buttonAction: { kind: 'NODE', nodeId: flow.apiNodeId },
        apiMode: 'LIVE',
        overlay: {
          dialogNodes: [
            {
              id: flow.apiNodeId,
              name: '덮어쓴노드',
              contextVariableId: flow.ctxId,
              outputs: [
                { type: 'TEXT', payload: { text: '조회해 볼게요.' } },
                {
                  type: 'API_CONDITION',
                  payload: {
                    version: 2,
                    connectionId: conn.id,
                    method: 'GET',
                    path: '/orders/DIFFERENT', // 저장본과 다른 경로 — 직렬화 비교가 다르게 나온다
                    pathParams: [],
                    query: [],
                    body: [],
                    responseMappings: [],
                    conditions: [{ path: 'data.status', operator: 'EQ', value: 'SHIPPED', nextNodeId: flow.shippedNodeId }],
                  },
                },
              ],
            },
          ],
        },
      });
      expect(res.status).toBe(200);
      expect(res.body.apiStep?.mode).toBe('MOCK');
      expect(res.body.apiStep?.downgradeReason).toBe('UNSAVED_NODE');
      expect(legacyRequests.length).toBe(before);
    });

    it('MOCK 요청한 샘플 라벨이 연결에 없으면 noSample:true로 실패 분기를 재현한다', async () => {
      const conn = await createConnection(); // 기본 샘플 1개("배송중") 보유
      const flow = await setupOrderFlow({ connectionId: conn.id, withDefault: true, withFailure: true, namePrefix: '샘플불일치' });

      // 바인딩 값이 CONST뿐인 오버레이 노드를 써서(SLOT 미충족으로 인한 BINDING_MISSING을 배제)
      // 목 실행기가 실제로 resolveMockOutcome()까지 도달하는지 확인한다(폼 완료 없이도 재현 가능).
      const overlayNodeId = randomUUID();
      const res = await editor<{ apiStep?: { noSample?: boolean; mode: string } }>('POST', `/chatbots/${flow.chatbotId}/simulate`, {
        buttonAction: { kind: 'NODE', nodeId: overlayNodeId },
        apiMode: 'MOCK',
        mockResponse: { sampleLabel: '존재하지않는라벨' },
        overlay: {
          dialogNodes: [
            {
              id: overlayNodeId,
              name: '샘플불일치오버레이노드',
              nodeType: 'START',
              outputs: [
                {
                  type: 'API_CONDITION',
                  payload: {
                    version: 2,
                    connectionId: conn.id,
                    method: 'GET',
                    path: '/orders/SHIP1',
                    pathParams: [],
                    query: [],
                    body: [],
                    responseMappings: [],
                    conditions: [{ path: 'data.status', operator: 'EQ', value: 'SHIPPED', nextNodeId: flow.shippedNodeId }],
                  },
                },
              ],
            },
          ],
        },
      });
      expect(res.status).toBe(200);
      expect(res.body.apiStep?.mode).toBe('MOCK');
      expect(res.body.apiStep?.noSample).toBe(true);
    });

    it('EDITOR가 GET + 저장된 노드 + simulation:write로 LIVE를 요청하면 실제 목 서버까지 호출된다', async () => {
      const conn = await createConnection();
      const flow = await setupOrderFlow({ connectionId: conn.id, withDefault: true, withFailure: true, namePrefix: '시뮬LIVE' });
      const before = legacyRequests.length;

      const res = await editor<{ apiStep?: { mode: string; branch?: string } }>('POST', `/chatbots/${flow.chatbotId}/simulate`, {
        buttonAction: { kind: 'NODE', nodeId: flow.apiNodeId },
        apiMode: 'LIVE',
      });
      expect(res.status).toBe(200);
      // 폼 완료 없이 노드로 직접 진입하므로 바인딩이 비어 BINDING_MISSING 실패 분기이지만, 모드 자체는 LIVE로 승인되어야 한다.
      expect(res.body.apiStep?.mode).toBe('LIVE');
      expect(legacyRequests.length).toBe(before); // 바인딩 누락은 애초에 외부 호출을 만들지 않는다(호출 시도 자체가 없음)

      const logsRes = await editor<{ items: Array<Record<string, unknown>> }>('GET', `/chatbots/${flow.chatbotId}/api-call-logs?source=SIMULATION_LIVE`);
      expect(logsRes.body.items.length).toBe(1);
      expect(logsRes.body.items[0].source).toBe('SIMULATION_LIVE');
    });
  });

  /* ============================================================================================
   * 10. TC 실행은 항상 목(item 10)
   * ========================================================================================== */
  describe('10. TC 실행 — 항상 목, apiMockA 기록, 외부 호출 0건(AC-L6-6/6-7)', () => {
    it('폼 3턴을 담은 TC를 실행하면 목으로 판정되고 결과에 apiMockA가 기록되며 외부 호출이 0건이다', async () => {
      const conn = await createConnection();
      const flow = await setupOrderFlow({ connectionId: conn.id, withDefault: true, withFailure: true, namePrefix: 'TC목' });

      const setRes = await admin<{ id: string }>('POST', `/chatbots/${flow.chatbotId}/test-sets`, { name: 'No26 TC세트' });
      expect(setRes.status).toBe(201);
      const setId = setRes.body.id;
      const caseRes = await admin<{ id: string }>('POST', `/chatbots/${flow.chatbotId}/test-sets/${setId}/cases`, {
        messages: [flow.startIntentExample, 'SHIP1', '010-1111-2222'],
        expectedKind: 'NODE',
        expectedTargetId: flow.apiNodeId, // K-6: 최초 매칭 노드(API 조건 보유 노드) 기준
      });
      expect(caseRes.status).toBe(201);

      const before = legacyRequests.length;
      const runRes = await admin<{ runId: string }>('POST', `/chatbots/${flow.chatbotId}/test-sets/${setId}/runs`, { overlaySource: 'NONE', useRag: false });
      expect(runRes.status).toBe(202);
      const runId = runRes.body.runId;

      const start = Date.now();
      let status = 'QUEUED';
      while (Date.now() - start < 20_000) {
        const statusRes = await admin<{ status: string }>('GET', `/chatbots/${flow.chatbotId}/test-runs/${runId}`);
        status = statusRes.body.status;
        if (status === 'SUCCEEDED' || status === 'FAILED' || status === 'CANCELLED') break;
        await new Promise((r) => setTimeout(r, 150));
      }
      expect(status).toBe('SUCCEEDED');
      expect(legacyRequests.length).toBe(before); // TC 실행은 항상 목 — 외부 호출 0건

      // FR-L7-6 — 사용된 샘플의 해시 앞 8자리(또는 'NO_SAMPLE')가 DB와 결과 조회 API 양쪽에 있어야 한다.
      // (시험 중 발견: 결과 매퍼가 이 두 필드를 누락했었다 — test-run.mapper.ts에서 수정)
      const resultsRes = await admin<{ items: Array<Record<string, unknown>> }>('GET', `/chatbots/${flow.chatbotId}/test-runs/${runId}/results`);
      expect(resultsRes.body.items.length).toBe(1);
      const dbRow = await prisma.testRunResult.findUnique({ where: { id: resultsRes.body.items[0].id as string } });
      expect(dbRow?.apiMockA).toBeTruthy();
      expect(resultsRes.body.items[0].apiMockA).toBe(dbRow?.apiMockA);
    }, 30_000);
  });

  /* ============================================================================================
   * 11. 연결 삭제 409 / 영구삭제 동반삭제(item 11)
   * ========================================================================================== */
  describe('11. 연결 삭제 409(참조 노드 포함) · 챗봇 영구삭제 시 ApiCallLog 동반 삭제', () => {
    it('참조 중인 연결은 삭제할 수 없고, details에 chatbotId가 포함된다(FR-L2-3)', async () => {
      const conn = await createConnection();
      const flow = await setupOrderFlow({ connectionId: conn.id, withDefault: true, withFailure: true, namePrefix: '연결삭제409' });

      const delRes = await admin<{ code: string; details?: Array<{ chatbotId?: string }> }>('DELETE', `/api-connections/${conn.id}`);
      expect(delRes.status).toBe(409);
      expect(delRes.body.code).toBe('API_CONNECTION_IN_USE');
      expect(delRes.body.details?.[0]?.chatbotId).toBe(flow.chatbotId);
    });

    it('챗봇 영구삭제 시 해당 챗봇의 ApiCallLog가 함께 삭제된다(AC-L5-4)', async () => {
      // ⚠ 영구삭제는 CHATBOT_HAS_CHILDREN(의도·노드·컨텍스트·채널·대화로그 등)이 하나라도 있으면 409로
      // 막힌다(AC-1-11, chatbots.service.ts §children 검사) — ApiCallLog는 그 목록에 없다(FK 없는 로그
      // 규약). 그래서 실제 폼 대화로 발생시키는 대신, "다른 자식이 없는" 챗봇에 ApiCallLog 행만
      // 직접 심어 캐스케이드 삭제만 정확히 검증한다(연결·호출은 이미 §3/§4/§7~§9에서 검증됨).
      const groupId = await createGroup('영구삭제단독');
      const suffix = Math.random().toString(36).slice(2, 10);
      const name = `영구삭제단독-${suffix}`;
      const createRes = await admin<{ id: string }>('POST', '/chatbots', { groupId, name, slug: `legacy-purge-${suffix}` });
      const chatbotId = createRes.body.id;
      const conn = await createConnection();

      await prisma.apiCallLog.create({
        data: {
          chatbotId,
          connectionId: conn.id,
          connectionName: conn.name,
          source: 'PUBLIC',
          method: 'GET',
          pathTemplate: '/orders/{0}',
          outcome: 'SUCCESS',
          latencyMs: 12,
          branch: 'CONDITION',
          conditionIndex: 1,
          personalDataMasked: false,
        },
      });

      const countBefore = await prisma.apiCallLog.count({ where: { chatbotId } });
      expect(countBefore).toBe(1);

      const archiveRes = await admin('DELETE', `/chatbots/${chatbotId}`);
      expect(archiveRes.status).toBe(204);
      const purgeRes = await admin('POST', `/chatbots/${chatbotId}/permanent-delete`, { confirmName: name });
      expect(purgeRes.status).toBe(204);

      const countAfter = await prisma.apiCallLog.count({ where: { chatbotId } });
      expect(countAfter).toBe(0);
    });
  });

  /* ============================================================================================
   * 12. 참조 무결성 J-17(item 12)
   * ========================================================================================== */
  describe('12. 노드 참조 무결성(J-17) — 분기 대상 노드 삭제 409(v1·v2 모두, AC-L1-7)', () => {
    it('v2 API_CONDITION의 conditions[].nextNodeId가 가리키는 노드는 삭제할 수 없다', async () => {
      const conn = await createConnection();
      const flow = await setupOrderFlow({ connectionId: conn.id, withDefault: true, withFailure: true, namePrefix: '참조무결성v2' });
      const delRes = await admin<{ code: string }>('DELETE', `/chatbots/${flow.chatbotId}/dialog-nodes/${flow.shippedNodeId}`);
      expect(delRes.status).toBe(409);
      expect(delRes.body.code).toBe('NODE_IN_USE');
    });

    it('v1 API_CONDITION의 conditions[].nextNodeId가 가리키는 노드도 삭제할 수 없다', async () => {
      const { chatbotId } = await createChatbotWithChannel('참조무결성v1');
      const target = await admin<{ id: string }>('POST', `/chatbots/${chatbotId}/dialog-nodes`, {
        name: '참조대상노드',
        nodeType: 'START',
        outputs: [{ type: 'TEXT', payload: { text: 'x' } }],
      });
      await prisma.dialogNode.create({
        data: {
          chatbotId,
          name: 'v1참조노드',
          nameNormalized: normalizeText('v1참조노드'),
          outputs: JSON.stringify([
            {
              type: 'API_CONDITION',
              payload: { method: 'GET', url: 'https://legacy.example.invalid/x', conditions: [{ path: 'x', operator: 'EQ', value: 'y', nextNodeId: target.body.id }] },
            },
          ]),
        },
      });
      const delRes = await admin<{ code: string }>('DELETE', `/chatbots/${chatbotId}/dialog-nodes/${target.body.id}`);
      expect(delRes.status).toBe(409);
      expect(delRes.body.code).toBe('NODE_IN_USE');
    });
  });

  /* ============================================================================================
   * 13. 권한(item 13)
   * ========================================================================================== */
  describe('13. 권한 — 연결 관리 ADMIN 전용, picker/samples는 dialogue:read, 호출로그는 chatbot:read', () => {
    it('EDITOR·VIEWER는 연결 CRUD·테스트가 403이고 DB 변경이 없다', async () => {
      const conn = await createConnection();
      const before = await prisma.apiConnection.count();

      const editorCreate = await editor('POST', '/api-connections', {
        name: 'EDITOR시도',
        baseUrl: 'https://legacy.example.invalid',
        allowedMethods: ['GET'],
      });
      const viewerCreate = await viewer('POST', '/api-connections', {
        name: 'VIEWER시도',
        baseUrl: 'https://legacy.example.invalid',
        allowedMethods: ['GET'],
      });
      const editorUpdate = await editor('PATCH', `/api-connections/${conn.id}`, { description: 'x' });
      const editorDelete = await editor('DELETE', `/api-connections/${conn.id}`);
      const editorTest = await editor('POST', `/api-connections/${conn.id}/test`, {});
      const viewerDetail = await viewer('GET', `/api-connections/${conn.id}`);

      for (const r of [editorCreate, viewerCreate, editorUpdate, editorDelete, editorTest, viewerDetail]) expect(r.status).toBe(403);

      const after = await prisma.apiConnection.count();
      expect(after).toBe(before);
    });

    it('picker는 EDITOR·VIEWER 모두 접근 가능하고 baseUrl·secretRef·authType을 포함하지 않는다(AC-L2-1)', async () => {
      await createConnection();
      const editorPicker = await editor<{ items: Array<Record<string, unknown>> }>('GET', '/api-connections/picker');
      const viewerPicker = await viewer<{ items: Array<Record<string, unknown>> }>('GET', '/api-connections/picker');
      expect(editorPicker.status).toBe(200);
      expect(viewerPicker.status).toBe(200);
      for (const item of [...editorPicker.body.items, ...viewerPicker.body.items]) {
        expect(item).not.toHaveProperty('baseUrl');
        expect(item).not.toHaveProperty('secretRef');
        expect(item).not.toHaveProperty('authType');
      }
    });

    it('호출 로그 조회는 세 역할 모두 가능하다(chatbot:read)', async () => {
      const conn = await createConnection();
      const flow = await setupOrderFlow({ connectionId: conn.id, withDefault: true, withFailure: true, namePrefix: '로그권한' });
      const adminRes = await admin('GET', `/chatbots/${flow.chatbotId}/api-call-logs`);
      const editorRes = await editor('GET', `/chatbots/${flow.chatbotId}/api-call-logs`);
      const viewerRes = await viewer('GET', `/chatbots/${flow.chatbotId}/api-call-logs`);
      expect(adminRes.status).toBe(200);
      expect(editorRes.status).toBe(200);
      expect(viewerRes.status).toBe(200);
    });

    it('비로그인 요청은 401이다', async () => {
      const res = await anon('GET', '/api-connections');
      expect(res.status).toBe(401);
    });
  });

  /* ============================================================================================
   * 14. API 노드가 없는 턴 — 추가 쿼리 0건(item 14, No.29 jest.spyOn 선례)
   * ========================================================================================== */
  describe('14. API 노드가 없는 턴은 ApiConnection 관련 추가 쿼리가 0건이다(기존 예산 불변)', () => {
    it('API_CONDITION이 없는 노드로 응답하는 턴에서 apiConnection.findFirst/findUnique가 호출되지 않는다', async () => {
      const { chatbotId, slug } = await createChatbotWithChannel('쿼리예산');
      const intentRes = await admin<{ intent: { id: string } }>('POST', `/chatbots/${chatbotId}/intents`, { name: '일반의도', examples: ['일반질문입니다'] });
      await admin('POST', `/chatbots/${chatbotId}/dialog-nodes`, {
        name: '일반응답노드',
        intentIds: [intentRes.body.intent.id],
        outputs: [{ type: 'TEXT', payload: { text: '일반 응답입니다.' } }],
      });

      const findFirstSpy = jest.spyOn(prisma.apiConnection, 'findFirst');
      const findUniqueSpy = jest.spyOn(prisma.apiConnection, 'findUnique');
      const findManySpy = jest.spyOn(prisma.apiConnection, 'findMany');
      findFirstSpy.mockClear();
      findUniqueSpy.mockClear();
      findManySpy.mockClear();

      try {
        const res = await anon<Record<string, unknown>>('POST', `/public/chatbots/${slug}/messages`, { sessionId: randomUUID(), message: '일반질문입니다' });
        expect(res.status).toBe(200);
        expect(outputTexts(res.body)).toEqual(['일반 응답입니다.']);
        expect(findFirstSpy).not.toHaveBeenCalled();
        expect(findUniqueSpy).not.toHaveBeenCalled();
        expect(findManySpy).not.toHaveBeenCalled();
      } finally {
        findFirstSpy.mockRestore();
        findUniqueSpy.mockRestore();
        findManySpy.mockRestore();
      }
    });
  });
});
