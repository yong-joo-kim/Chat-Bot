import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import * as http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VersioningType } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { normalizeEmail } from '@chat-bot/shared-types';
import { AllExceptionsFilter } from '../../common/all-exceptions.filter';
import { hashPassword } from '../../common/auth/lib/password-hash';
import { CLOCK } from '../../common/polling/clock';
import type { Clock } from '../../common/polling/clock';
import { PrismaService } from '../../prisma/prisma.service';
import { TEST_PASSWORD, loginAs, seedTestUsers } from './auth.helper';

/**
 * AI 거버넌스·가드레일(No.36) 통합 시험 공용 하네스 — 앱 기동(`prisma migrate deploy` DB · 동적 import),
 * JSON 요청 헬퍼, 가짜 외부 RAG HTTP 서버, 2번째 ADMIN(2인 승인 시험용), 시계 주입, 쿼리 계측 Prisma.
 * CLAUDE.md 규약: 선택 기능을 켜는 spec은 환경변수를 먼저 설정한 뒤 `AppModule`을 동적 import한다.
 */

const API_ROOT = join(__dirname, '..', '..', '..');

export interface ApiResponse<T = unknown> {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: T;
}

export function jsonRequest<T = unknown>(method: string, url: string, body?: unknown, headers: Record<string, string> = {}): Promise<ApiResponse<T>> {
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

export class FakeClock implements Clock {
  private current: Date;
  constructor(initial: Date) {
    this.current = initial;
  }
  now(): Date {
    return this.current;
  }
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

/** 쿼리 수 계측용 Prisma — `environment-query-count` 선례와 같은 방식. */
export class QueryCountingPrismaClient extends PrismaClient {
  queries: string[] = [];

  constructor(datasourceUrl: string) {
    super({ datasources: { db: { url: datasourceUrl } }, log: [{ emit: 'event', level: 'query' }] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this as any).$on('query', (e: { query: string }) => {
      this.queries.push(e.query);
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}

/** 가짜 외부 RAG 서버 — `POST /api/rag/query`의 답을 시험이 바꾼다. 호출 수를 센다. */
export interface FakeRag {
  url: string;
  queryCalls: number;
  /** 다음 질의에 돌려줄 답 본문(`result`). */
  answer: string;
  close(): Promise<void>;
}

export async function startFakeRag(): Promise<FakeRag> {
  const fake: FakeRag = {
    url: '',
    queryCalls: 0,
    answer: '기본 답변입니다.',
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
  const server = http.createServer((req, res) => {
    const respond = (status: number, body: unknown): void => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.method === 'GET' && req.url === '/api/status') {
      respond(200, { status: 'healthy', vllm_ready: true });
      return;
    }
    if (req.method === 'POST' && req.url === '/api/rag/query') {
      req.resume();
      req.on('end', () => {
        fake.queryCalls += 1;
        respond(200, {
          result: fake.answer,
          keywords: [],
          source_info: { total_sources: 1, common_metadata: { company: '테스트회사' }, sources: [{ ['file' + '_path']: 'doc.pdf', page: 1 }] },
          retrieval_success: 1,
        });
      });
      return;
    }
    respond(404, { detail: 'not found' });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  fake.url = `http://127.0.0.1:${typeof address === 'object' && address !== null ? address.port : 0}`;
  return fake;
}

export interface Harness {
  app: NestExpressApplication;
  baseUrl: string;
  prisma: PrismaService;
  clock: FakeClock;
  cookies: { admin: string; admin2: string; editor: string; viewer: string };
  admin<T = unknown>(method: string, path: string, body?: unknown): Promise<ApiResponse<T>>;
  admin2<T = unknown>(method: string, path: string, body?: unknown): Promise<ApiResponse<T>>;
  editor<T = unknown>(method: string, path: string, body?: unknown): Promise<ApiResponse<T>>;
  viewer<T = unknown>(method: string, path: string, body?: unknown): Promise<ApiResponse<T>>;
  pub<T = unknown>(method: string, path: string, body?: unknown): Promise<ApiResponse<T>>;
  /** 마지막으로 쓴 세션 id 카운터로 UUID를 발급한다. */
  sessionUuid(): string;
  createChatbot(namePrefix: string, opts?: { activate?: boolean }): Promise<{ id: string; slug: string }>;
  close(): Promise<void>;
}

export interface BootOptions {
  tmpPrefix: string;
  env?: Record<string, string>;
  /** `true`면 쿼리 수 계측 Prisma를 주입한다(반환 `prisma`가 그 인스턴스). */
  countingPrisma?: boolean;
  /** `CLOCK`을 이 시계로 바꾼다(2인 승인·예약 시험). */
  clock?: FakeClock;
  overrides?: (builder: ReturnType<typeof Test.createTestingModule>) => ReturnType<typeof Test.createTestingModule>;
}

const SECOND_ADMIN_EMAIL = 'integration-test-admin2@chat-bot.local';

export async function bootHarness(options: BootOptions): Promise<Harness & { moduleRef: Awaited<ReturnType<ReturnType<typeof Test.createTestingModule>['compile']>> }> {
  const tmpDir = mkdtempSync(join(tmpdir(), options.tmpPrefix));
  const dbPath = join(tmpDir, 'test.db').replace(/\\/g, '/');
  const testDatabaseUrl = `file:${dbPath}`;

  process.env.DATABASE_URL = testDatabaseUrl;
  process.env.DEPLOY_SCHEDULE_ENABLED = 'false';
  process.env.HANDOFF_SWEEPER_ENABLED = 'false';
  process.env.WIDGET_BASE_URL = process.env.WIDGET_BASE_URL ?? 'http://localhost:5174';
  process.env.PUBLIC_API_BASE_URL = process.env.PUBLIC_API_BASE_URL ?? 'http://localhost:3000/api/v1';
  delete process.env.EMBEDDING_BASE_URL;
  for (const [key, value] of Object.entries(options.env ?? {})) process.env[key] = value;

  try {
    execSync('pnpm exec prisma migrate deploy', { cwd: API_ROOT, env: { ...process.env, DATABASE_URL: testDatabaseUrl }, stdio: 'pipe' });
  } catch (e) {
    const err = e as { stdout?: Buffer; stderr?: Buffer };
    throw new Error(`prisma migrate deploy 실패:\n${err.stdout?.toString()}\n${err.stderr?.toString()}`);
  }

  const counting = options.countingPrisma ? new QueryCountingPrismaClient(testDatabaseUrl) : undefined;

  const { AppModule } = await import('../../app.module');
  let builder = Test.createTestingModule({ imports: [AppModule] });
  if (counting) builder = builder.overrideProvider(PrismaService).useValue(counting);
  if (options.clock) builder = builder.overrideProvider(CLOCK).useValue(options.clock);
  if (options.overrides) builder = options.overrides(builder);
  const moduleRef = await builder.compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>();
  app.enableCors();
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalFilters(new AllExceptionsFilter());
  const prisma: PrismaService = (counting as unknown as PrismaService | undefined) ?? (moduleRef.get(PrismaService) as PrismaService);

  await app.listen(0);
  const server = app.getHttpServer() as http.Server;
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  const baseUrl = `http://127.0.0.1:${port}/api/v1`;

  await seedTestUsers(prisma);
  // 2인 승인 시험용 2번째 ADMIN.
  const passwordHash = await hashPassword(TEST_PASSWORD);
  const email2 = normalizeEmail(SECOND_ADMIN_EMAIL);
  await prisma.user.upsert({
    where: { email: email2 },
    update: {},
    create: { email: email2, name: '테스트 ADMIN2', role: 'ADMIN', passwordHash, mustChangePassword: false, status: 'ACTIVE' },
  });
  const cookies = {
    admin: await loginAs(baseUrl, 'ADMIN'),
    admin2: await loginWithEmail(baseUrl, email2),
    editor: await loginAs(baseUrl, 'EDITOR'),
    viewer: await loginAs(baseUrl, 'VIEWER'),
  };

  let sessionCounter = 0;
  const call = (cookie: string) => <T = unknown>(method: string, path: string, body?: unknown) => jsonRequest<T>(method, `${baseUrl}${path}`, body, { Cookie: cookie });
  const admin = call(cookies.admin);

  const harness: Harness = {
    app,
    baseUrl,
    prisma,
    clock: options.clock as FakeClock,
    cookies,
    admin,
    admin2: call(cookies.admin2),
    editor: call(cookies.editor),
    viewer: call(cookies.viewer),
    pub: <T = unknown>(method: string, path: string, body?: unknown) => jsonRequest<T>(method, `${baseUrl}${path}`, body),
    sessionUuid: () => {
      sessionCounter += 1;
      return `50000000-0000-4000-8000-${sessionCounter.toString(16).padStart(12, '0')}`;
    },
    createChatbot: async (namePrefix, opts) => {
      const groupRes = await admin<{ id: string }>('POST', '/chatbot-groups', { name: `${namePrefix} 그룹 ${Math.random().toString(36).slice(2, 8)}` });
      const suffix = Math.random().toString(36).slice(2, 10);
      const slug = `agr-${suffix}`;
      const res = await admin<{ id: string }>('POST', '/chatbots', { groupId: groupRes.body.id, name: `${namePrefix}-${suffix}`, slug });
      const id = res.body.id;
      if (opts?.activate !== false) {
        await admin('PATCH', `/chatbots/${id}/status`, { status: 'ACTIVE' });
        await admin('PATCH', `/chatbots/${id}/channels/WEB`, { enabled: true, config: { allowedOrigins: [] } });
      }
      return { id, slug };
    },
    close: async () => {
      await app.close();
      await new Promise((r) => setTimeout(r, 200));
      try {
        rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      } catch {
        // 정리 실패는 판정에 영향 없음(Windows 파일 핸들 지연 해제).
      }
    },
  };
  return Object.assign(harness, { moduleRef });
}

function loginWithEmail(baseUrl: string, email: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ email, password: TEST_PASSWORD });
    const { hostname, port, pathname } = new URL(`${baseUrl}/auth/login`);
    const req = http.request(
      { method: 'POST', hostname, port, path: pathname, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } },
      (res) => {
        let data = '';
        res.on('data', (c) => {
          data += c;
        });
        res.on('end', () => {
          const setCookie = res.headers['set-cookie'];
          const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
          if (res.statusCode !== 200 || !raw) {
            reject(new Error(`로그인 실패(하네스): status=${res.statusCode} body=${data}`));
            return;
          }
          resolve(raw.split(';')[0]);
        });
      },
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

/** fire-and-forget 적재를 폴링으로 기다린다(CLAUDE.md 규약). */
export async function eventually<T>(read: () => Promise<T | null | undefined | false>, timeoutMs = 4000): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (value) return value as T;
    if (Date.now() > deadline) return null;
    await new Promise((r) => setTimeout(r, 40));
  }
}
