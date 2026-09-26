import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import * as http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VersioningType } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { AppModule as AppModuleType } from '../app.module';
import { PublicMessageResponseSchema } from '@chat-bot/shared-types';
import { AllExceptionsFilter } from '../common/all-exceptions.filter';
import { PrismaService } from '../prisma/prisma.service';
import { loginAs, seedTestUsers } from './helpers/auth.helper';
import { LEGACY_DNS_RESOLVER, LEGACY_TRANSPORT } from '../legacy-api/transport/legacy-transport.port';
import type { LegacyDnsResolver, LegacyTransport, LegacyTransportRequest, LegacyTransportResult } from '../legacy-api/transport/legacy-transport.port';

/**
 * [신규 No.46 — 코드 리뷰 R1 (c) AC-RM2-4(★)] 공개 대화 HTTP 통합 시험 — v2 `API_CONDITION` 성공
 * 분기 → `resumeAfterApiCall` 재진입 → CAROUSEL·바로연결(`display`)이 유지되는지(rich-v1 있을 때) ·
 * 올바르게 강등되는지(rich-v1 없을 때) 확인한다.
 *
 * 레거시 API 목 서버·SSRF 우회 기법은 `legacy-api-integration.integration.spec.ts`의 로컬
 * `http.createServer` + 가짜 DNS 리졸버/전송 오버라이드 패턴을 그대로 재사용한다(운영 코드
 * 무수정 — `LegacyApiModule`이 시험 대체 지점으로 이미 노출한 DI 토큰만 교체).
 */

const API_ROOT = join(__dirname, '..', '..');

async function safeCleanupTmpDir(dir: string): Promise<void> {
  await new Promise((r) => setTimeout(r, 300));
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {
    // Windows 파일 핸들 지연 해제 — 정리 실패는 판정에 영향 없음.
  }
}

interface ApiResponse<T = unknown> {
  status: number;
  body: T;
  headers: http.IncomingHttpHeaders;
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
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          let parsed: unknown;
          try {
            parsed = data ? JSON.parse(data) : undefined;
          } catch {
            parsed = data;
          }
          resolve({ status: res.statusCode ?? 0, body: parsed as T, headers: res.headers });
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/** 로컬 목 "레거시 서버" — `/order-status`는 항상 `{ data: { status: 'SHIPPED' } }`로 응답한다. */
function startMockLegacyServer(): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      req.on('data', () => undefined);
      req.on('end', () => {
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

/** 가짜 DNS 리졸버 — 시험용 도메인을 공인 주소로 위장한다(운영 IP 분류 로직은 그대로 탄다). */
function makeFakeDnsResolver(): LegacyDnsResolver {
  return {
    async lookupAll(hostname: string): Promise<string[]> {
      return hostname === 'legacy-rich.example.invalid' ? ['203.0.113.20'] : ['203.0.113.99'];
    },
  };
}

/** 가짜 전송 — `ip-policy.ts` 검사를 통과한 요청만 여기 도달한다(운영 로직 무수정, 목 서버로 실제 소켓만 돌린다). */
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

describe('AC-RM2-4(★): v2 API_CONDITION 성공 분기 → resumeAfterApiCall 재진입 → CAROUSEL·바로연결 유지/강등', () => {
  let app: NestExpressApplication;
  let baseUrl: string;
  let tmpDir: string;
  let prisma: PrismaService;
  let mockLegacy: { url: string; close: () => Promise<void> };

  let adminCookie = '';
  let chatbotId: string;
  let slug: string;
  let intentExample: string;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'chatbot-rich-api-condition-test-'));
    const dbPath = join(tmpDir, 'test.db').replace(/\\/g, '/');
    const testDatabaseUrl = `file:${dbPath}`;

    mockLegacy = await startMockLegacyServer();

    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.DEPLOY_SCHEDULE_ENABLED = 'false';
    process.env.HANDOFF_SWEEPER_ENABLED = 'false';
    process.env.WIDGET_BASE_URL = process.env.WIDGET_BASE_URL ?? 'http://localhost:5174';
    process.env.PUBLIC_API_BASE_URL = process.env.PUBLIC_API_BASE_URL ?? 'http://localhost:3000/api/v1';
    process.env.LEGACY_API_ENABLED = 'true';
    process.env.LEGACY_API_DEFAULT_TIMEOUT_MS = '1000';
    process.env.LEGACY_API_MAX_TIMEOUT_MS = '1000';
    process.env.LEGACY_API_MAX_RESPONSE_BYTES = '262144';
    process.env.LEGACY_API_CIRCUIT_FAILURE_THRESHOLD = '3';
    process.env.LEGACY_API_CIRCUIT_OPEN_MS = '1000';

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

    const groupRes = await admin<{ id: string }>('POST', '/chatbot-groups', { name: `RM2-4그룹-${Math.random().toString(36).slice(2, 8)}` });
    const suffix = Math.random().toString(36).slice(2, 10);
    slug = `rm2-4-${suffix}`;
    const botRes = await admin<{ id: string }>('POST', '/chatbots', { groupId: groupRes.body.id, name: 'RM2-4봇', slug });
    chatbotId = botRes.body.id;
    await admin('PATCH', `/chatbots/${chatbotId}/status`, { status: 'ACTIVE' });
    await admin('PATCH', `/chatbots/${chatbotId}/channels/WEB`, { enabled: true, config: { allowedOrigins: [], greetingMessage: '안녕하세요' } });

    const connRes = await admin<{ id: string }>('POST', '/api-connections', {
      name: `RM2-4연결-${suffix}`,
      baseUrl: 'https://legacy-rich.example.invalid',
      allowedMethods: ['GET'],
      authType: 'NONE',
      sampleResponses: [],
      enabled: true,
    });
    expect(connRes.status).toBe(201);

    // 노이즈 의도 — 분기·종결 노드는 NORMAL 노드 저장 규약상 조건 1개 이상이 필요하다(노드 참조로만
    // 도달하는 실제 형태 재현 — legacy-api 통합 시험 `setupOrderFlow` 선례와 동일).
    const noiseIntentRes = await admin<{ intent: { id: string } }>('POST', `/chatbots/${chatbotId}/intents`, {
      name: `RM2-4노이즈의도-${suffix}`,
      examples: [`노이즈문장-${suffix}`],
    });
    const noiseIntentId = noiseIntentRes.body.intent.id;

    const targetRes = await admin<{ id: string }>('POST', `/chatbots/${chatbotId}/dialog-nodes`, {
      name: `RM2-4배송중안내-${suffix}`,
      intentIds: [noiseIntentId],
      outputs: [
        { type: 'CAROUSEL', payload: { version: 1, cards: [{ title: '요금제 A' }, { title: '요금제 B' }] } },
        { type: 'BUTTON', payload: { text: '배송 상태: {api.status}', buttons: [{ label: '확인', action: 'MESSAGE', value: '확인' }], display: 'QUICK_REPLY' } },
      ],
    });
    expect(targetRes.status).toBe(201);

    intentExample = `RM2-4배송조회_${suffix}`;
    const startIntentRes = await admin<{ intent: { id: string } }>('POST', `/chatbots/${chatbotId}/intents`, {
      name: `RM2-4배송조회의도-${suffix}`,
      examples: [intentExample],
    });

    const apiNodeRes = await admin<{ id: string }>('POST', `/chatbots/${chatbotId}/dialog-nodes`, {
      name: `RM2-4주문조회_실행-${suffix}`,
      intentIds: [startIntentRes.body.intent.id],
      outputs: [
        {
          type: 'API_CONDITION',
          payload: {
            version: 2,
            connectionId: connRes.body.id,
            method: 'GET',
            path: '/order-status',
            pathParams: [],
            query: [],
            body: [],
            responseMappings: [{ name: 'status', path: 'data.status', required: true, maxLength: 50 }],
            conditions: [{ path: 'data.status', operator: 'EQ', value: 'SHIPPED', nextNodeId: targetRes.body.id }],
          },
        },
      ],
    });
    expect(apiNodeRes.status).toBe(201);
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await mockLegacy?.close();
    await safeCleanupTmpDir(tmpDir);
  }, 15_000);

  function admin<T = unknown>(method: string, path: string, body?: unknown): Promise<ApiResponse<T>> {
    return jsonRequest(method, `${baseUrl}${path}`, body, { Cookie: adminCookie });
  }
  function anon<T = unknown>(method: string, path: string, body?: unknown): Promise<ApiResponse<T>> {
    return jsonRequest(method, `${baseUrl}${path}`, body);
  }

  it('rich-v1 선언 시 — CAROUSEL 원형과 바로연결(display=QUICK_REPLY)이 그대로 유지된다', async () => {
    const res = await anon<{ outputs: Array<{ type: string; payload: Record<string, unknown> }> }>('POST', `/public/chatbots/${slug}/messages`, {
      sessionId: '11111111-1111-4111-8111-111111111111',
      message: intentExample,
      features: ['rich-v1'],
    });

    expect(res.status).toBe(200);
    expect(() => PublicMessageResponseSchema.parse(res.body)).not.toThrow();

    const carousel = res.body.outputs.find((o) => o.type === 'CAROUSEL');
    expect(carousel).toBeDefined();
    expect((carousel!.payload.cards as unknown[]).length).toBe(2);

    const button = res.body.outputs.find((o) => o.type === 'BUTTON');
    expect(button).toBeDefined();
    expect(button!.payload.display).toBe('QUICK_REPLY');
    // resumeAfterApiCall이 조립한 응답값({api.status})도 함께 치환돼 있어야 한다(EN-3 회귀 방지).
    expect(button!.payload.text).toBe('배송 상태: SHIPPED');
  });

  it('rich-v1 미선언(구버전) 시 — CAROUSEL은 CARD 2개로 강등되고 바로연결은 display만 제거된 BUTTON으로 강등된다', async () => {
    const res = await anon<{ outputs: Array<{ type: string; payload: Record<string, unknown> }> }>('POST', `/public/chatbots/${slug}/messages`, {
      sessionId: '22222222-2222-4222-8222-222222222222',
      message: intentExample,
    });

    expect(res.status).toBe(200);
    expect(() => PublicMessageResponseSchema.parse(res.body)).not.toThrow();

    expect(res.body.outputs.some((o) => o.type === 'CAROUSEL')).toBe(false);
    expect(res.body.outputs.filter((o) => o.type === 'CARD').length).toBe(2);

    const button = res.body.outputs.find((o) => o.type === 'BUTTON');
    expect(button).toBeDefined();
    expect(button!.payload.display).toBeUndefined();
    expect(button!.payload.text).toBe('배송 상태: SHIPPED');
    expect((button!.payload.buttons as Array<{ label: string }>).length).toBeGreaterThan(0);
  });
});
