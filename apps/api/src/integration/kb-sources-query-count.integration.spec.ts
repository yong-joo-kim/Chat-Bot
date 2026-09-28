import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import * as http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VersioningType } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AllExceptionsFilter } from '../common/all-exceptions.filter';
import { loginAs, seedTestUsers } from './helpers/auth.helper';

/**
 * 지식베이스 자동 크롤링/동기화(No.43) R1 리뷰 M-1 — 목록 조회의 Prisma 쿼리 수가 행 개수와 무관하게
 * **고정**되는지 계측한다(N+1 회귀 방지). 기존 `environment-query-count.integration.spec.ts`와 같은
 * 계측 기법(테스트 전용 `PrismaClient` 서브클래스 + `log:[{emit:'event',level:'query'}]`)을 그대로
 * 쓴다 — 제품 코드(`PrismaService`)는 건드리지 않는다.
 */
const API_ROOT = join(__dirname, '..', '..');

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

class QueryCountingPrismaClient extends PrismaClient {
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

async function safeCleanupTmpDir(dir: string): Promise<void> {
  await new Promise((r) => setTimeout(r, 300));
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {
    // Windows 파일 핸들 지연 해제 — 판정에 영향 없음.
  }
}

function sourcePayload(suffix: string): Record<string, unknown> {
  return {
    name: `쿼리수-${suffix}`,
    seedUrls: [`https://203.0.113.10/${suffix}/`],
    sitemapUrls: [],
    pathPrefixes: [],
    excludePatterns: [],
    noisePatterns: [],
    allowQueryUrls: false,
    maxDepth: 3,
    maxPages: 50,
    fileTypes: [],
    maxFileBytes: 20971520,
    minIntervalMs: 500,
    scope: { company: '예시공사', category: '테스트', subcategory: suffix },
    schedule: { kind: 'MANUAL' },
    auth: { kind: 'NONE' },
    piiMask: false,
    allowRawFileIngest: false,
    rightsConfirmed: true,
  };
}

describe('지식베이스 소스 목록(No.43) R1 리뷰 M-1 — Prisma 쿼리 수 계측(N+1 회귀 방지)', () => {
  let app: NestExpressApplication;
  let baseUrl: string;
  let tmpDir: string;
  let prismaCounter: QueryCountingPrismaClient;
  let adminCookie = '';

  async function admin<T = unknown>(method: string, path: string, body?: unknown): Promise<ApiResponse<T>> {
    return jsonRequest(method, `${baseUrl}${path}`, body, { Cookie: adminCookie });
  }

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'chatbot-kb-sources-query-count-test-'));
    const dbPath = join(tmpDir, 'test.db').replace(/\\/g, '/');
    const testDatabaseUrl = `file:${dbPath}`;

    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.DEPLOY_SCHEDULE_ENABLED = 'false';
    process.env.WIDGET_BASE_URL = process.env.WIDGET_BASE_URL ?? 'http://localhost:5174';
    process.env.PUBLIC_API_BASE_URL = process.env.PUBLIC_API_BASE_URL ?? 'http://localhost:3000/api/v1';
    delete process.env.EMBEDDING_BASE_URL;
    process.env.KB_SYNC_ENABLED = 'true';

    try {
      execSync('pnpm exec prisma migrate deploy', { cwd: API_ROOT, env: { ...process.env, DATABASE_URL: testDatabaseUrl }, stdio: 'pipe' });
    } catch (e) {
      const err = e as { stdout?: Buffer; stderr?: Buffer };
      throw new Error(`prisma migrate deploy 실패:\n${err.stdout?.toString()}\n${err.stderr?.toString()}`);
    }

    prismaCounter = new QueryCountingPrismaClient(testDatabaseUrl);
    const { AppModule } = await import('../app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue(prismaCounter).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    app.enableCors();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalFilters(new AllExceptionsFilter());

    await app.listen(0);
    const server = app.getHttpServer() as http.Server;
    const address = server.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;
    baseUrl = `http://127.0.0.1:${port}/api/v1`;

    await seedTestUsers(prismaCounter as unknown as PrismaService);
    adminCookie = await loginAs(baseUrl, 'ADMIN');
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await safeCleanupTmpDir(tmpDir);
  }, 15_000);

  it('★ GET /kb-sources — 소스 2개일 때와 6개일 때 쿼리 수가 같다(행 개수와 무관하게 고정)', async () => {
    for (let i = 0; i < 2; i += 1) await admin('POST', '/kb-sources', sourcePayload(`목록소-${i}-${Date.now()}`));

    prismaCounter.queries.length = 0;
    const res2 = await admin('GET', '/kb-sources?pageSize=50');
    expect(res2.status).toBe(200);
    const queryCountWith2 = prismaCounter.queries.length;

    for (let i = 0; i < 4; i += 1) await admin('POST', '/kb-sources', sourcePayload(`목록소-추가-${i}-${Date.now()}`));

    prismaCounter.queries.length = 0;
    const res6 = await admin('GET', '/kb-sources?pageSize=50');
    expect(res6.status).toBe(200);
    const queryCountWith6 = prismaCounter.queries.length;

    expect(queryCountWith6).toBe(queryCountWith2); // 소스가 3배로 늘어도 쿼리 수는 그대로다.
  });

  it('★ GET /kb-sources/:id/runs — 실행 2건일 때와 6건일 때(진행률·ETA 계산 대상 포함) 쿼리 수가 같다', async () => {
    const created = await admin<{ id: string }>('POST', '/kb-sources', sourcePayload(`실행목록-${Date.now()}`));
    const sourceId = created.body.id;

    const makeRun = (i: number, status: string) =>
      prismaCounter.kbSyncRun.create({
        data: { id: randomUUID(), sourceId, sourceName: '실행목록', kind: 'SYNC', trigger: 'MANUAL', status, configVersion: 1, counts: '{}', startedAt: new Date(), crawlFinishedAt: new Date() },
      });

    for (let i = 0; i < 2; i += 1) await makeRun(i, i % 2 === 0 ? 'SUCCEEDED' : 'PARTIAL');
    prismaCounter.queries.length = 0;
    const runs2 = await admin('GET', `/kb-sources/${sourceId}/runs?pageSize=50`);
    expect(runs2.status).toBe(200);
    const queryCountWith2 = prismaCounter.queries.length;

    for (let i = 2; i < 6; i += 1) await makeRun(i, i % 2 === 0 ? 'SUCCEEDED' : 'PARTIAL');
    prismaCounter.queries.length = 0;
    const runs6 = await admin('GET', `/kb-sources/${sourceId}/runs?pageSize=50`);
    expect(runs6.status).toBe(200);
    const queryCountWith6 = prismaCounter.queries.length;

    expect(queryCountWith6).toBe(queryCountWith2); // 실행이 3배로 늘어도(진행률·ETA 계산 대상 포함) 쿼리 수는 그대로다.
  });
});
