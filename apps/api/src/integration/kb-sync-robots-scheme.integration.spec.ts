import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import * as http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VersioningType } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { AppModule as AppModuleType } from '../app.module';
import { AllExceptionsFilter } from '../common/all-exceptions.filter';
import { PrismaService } from '../prisma/prisma.service';
import { loginAs, seedTestUsers } from './helpers/auth.helper';
import { KB_DNS_RESOLVER, KB_TRANSPORT } from '../kb-sync/crawl/kb-crawl-http.fetcher';
import { KB_EXTRACTOR } from '../kb-sync/extract/kb-extractor.port';
import { InProcessExtractor } from '../kb-sync/extract/in-process.extractor';
import type { LegacyDnsResolver, LegacyTransport, LegacyTransportRequest, LegacyTransportResult } from '../legacy-api/transport/legacy-transport.port';

/**
 * 지식베이스 자동 크롤링/동기화(No.43) R1 리뷰 L-2 — robots.txt 요청이 문서 URL의 실제 스킴(http)을
 * 따르는지 종단 간 확인한다. 가짜 전송이 받은 논리 URL(`req.url`)을 그대로 기록해 검사한다(실제
 * 배선은 항상 로컬 목 서버로 평문 소켓을 연결하지만, "무엇을 요청하려 했는가"의 스킴은 그와 별개다).
 */
const API_ROOT = join(__dirname, '..', '..');

async function safeCleanupTmpDir(dir: string): Promise<void> {
  await new Promise((r) => setTimeout(r, 300));
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {
    // Windows 파일 핸들 지연 해제 — 판정에 영향 없음.
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

function startMockSiteServer(): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const parsed = new URL(req.url ?? '/', 'http://http-only.example.invalid');
      if (parsed.pathname === '/robots.txt') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('User-agent: *\nAllow: /\n');
        return;
      }
      if (parsed.pathname === '/page/') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><body><main><h1>http 전용 사내 사이트</h1><p>본문입니다.</p></main></body></html>');
        return;
      }
      res.writeHead(404);
      res.end();
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
    async lookupAll(hostname: string): Promise<string[]> {
      if (hostname === 'http-only.example.invalid') return ['203.0.113.10'];
      return ['203.0.113.99'];
    },
  };
}

/** 실제 배선은 항상 로컬 목 서버로 평문 소켓을 연결하지만, `req.url`(논리 URL)의 스킴을 그대로 기록한다. */
function makeRecordingFakeTransport(getMockBaseUrl: () => string, requestedUrls: string[]): LegacyTransport {
  return {
    request(req: LegacyTransportRequest): Promise<LegacyTransportResult> {
      requestedUrls.push(req.url);
      return new Promise((resolve) => {
        const target = new URL(req.url);
        const local = new URL(getMockBaseUrl());
        const httpReq = http.request({ method: req.method, hostname: local.hostname, port: local.port, path: target.pathname + target.search, headers: req.headers }, (res) => {
          const status = res.statusCode ?? 0;
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => {
            const body = Buffer.concat(chunks);
            const headers: Record<string, string> = {};
            if (req.captureHeaders) {
              for (const h of req.captureHeaders) {
                const v = res.headers[h];
                if (typeof v === 'string') headers[h] = v;
              }
            }
            resolve({ kind: 'RESPONSE', status, contentType: res.headers['content-type'], bytes: body.length, body, headers });
          });
        });
        httpReq.on('error', () => resolve({ kind: 'ERROR', outcome: 'NETWORK_ERROR' }));
        httpReq.end();
      });
    },
  };
}

describe('지식베이스 자동 크롤링/동기화(No.43) R1 리뷰 L-2 — robots.txt가 문서 URL의 실제 스킴을 따른다', () => {
  let app: NestExpressApplication;
  let baseUrl: string;
  let tmpDir: string;
  let prisma: PrismaService;
  let mockSite: { url: string; close: () => Promise<void> };
  let adminCookie = '';
  let kbSyncJob: { tick: () => Promise<void> };
  const requestedUrls: string[] = [];

  async function admin<T = unknown>(method: string, path: string, body?: unknown): Promise<ApiResponse<T>> {
    return jsonRequest(method, `${baseUrl}${path}`, body, { Cookie: adminCookie });
  }

  async function tickUntil(predicate: () => Promise<boolean>, maxIterations = 60): Promise<void> {
    for (let i = 0; i < maxIterations; i += 1) {
      await kbSyncJob.tick();
      if (await predicate()) return;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error('tickUntil: 조건이 충족되지 않았습니다(타임아웃)');
  }

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'chatbot-kb-robots-scheme-test-'));
    const dbPath = join(tmpDir, 'test.db').replace(/\\/g, '/');
    const testDatabaseUrl = `file:${dbPath}`;

    mockSite = await startMockSiteServer();

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

    const { AppModule } = (await import('../app.module')) as { AppModule: typeof AppModuleType };
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(KB_DNS_RESOLVER)
      .useValue(makeFakeDnsResolver())
      .overrideProvider(KB_TRANSPORT)
      .useValue(makeRecordingFakeTransport(() => mockSite.url, requestedUrls))
      .overrideProvider(KB_EXTRACTOR)
      .useClass(InProcessExtractor)
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

    const { KbSyncJob } = await import('../kb-sync/engine/kb-sync.job');
    kbSyncJob = moduleRef.get(KbSyncJob);
    await (kbSyncJob as unknown as { onModuleDestroy(): Promise<void> }).onModuleDestroy();
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await mockSite?.close();
    await safeCleanupTmpDir(tmpDir);
  }, 15_000);

  it('★ 시드 URL이 http://면 robots.txt도 http://로 요청한다(https 하드코딩 아님)', async () => {
    const created = await admin<{ id: string }>('POST', '/kb-sources', {
      name: `http전용-${Date.now()}`,
      seedUrls: ['http://http-only.example.invalid/page/'],
      sitemapUrls: [],
      pathPrefixes: ['/page/'],
      excludePatterns: [],
      noisePatterns: [],
      allowQueryUrls: false,
      maxDepth: 0,
      maxPages: 10,
      fileTypes: [],
      maxFileBytes: 20971520,
      minIntervalMs: 500,
      scope: { company: '예시공사', category: '테스트', subcategory: 'L2' },
      schedule: { kind: 'MANUAL' },
      auth: { kind: 'NONE' },
      piiMask: false,
      allowRawFileIngest: false,
      rightsConfirmed: true,
    });
    expect(created.status).toBe(201);

    const run = await admin<{ runId: string }>('POST', `/kb-sources/${created.body.id}/runs`, { kind: 'PREVIEW' });
    expect(run.status).toBe(202);
    await tickUntil(async () => {
      const r = await admin<{ status: string }>('GET', `/kb-sources/${created.body.id}/runs/${run.body.runId}`);
      return r.body.status === 'SUCCEEDED' || r.body.status === 'FAILED';
    });
    const detail = await admin<{ status: string }>('GET', `/kb-sources/${created.body.id}/runs/${run.body.runId}`);
    expect(detail.body.status).toBe('SUCCEEDED');

    const robotsRequests = requestedUrls.filter((u) => u.includes('/robots.txt'));
    expect(robotsRequests.length).toBeGreaterThan(0);
    expect(robotsRequests.every((u) => u.startsWith('http://'))).toBe(true);
    expect(robotsRequests.some((u) => u.startsWith('https://'))).toBe(false);
  }, 20_000);
});
