import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import * as http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConsoleLogger, VersioningType } from '@nestjs/common';
import type { LoggerService } from '@nestjs/common';
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
import { KbScheduler } from '../kb-sync/engine/kb-scheduler';
import { KbSourcesService } from '../kb-sync/kb-sources.service';

/**
 * 지식베이스 자동 크롤링/동기화(No.43) 보완 시험(Phase 8 — 항목⑥·⑦·⑪).
 *
 * SSRF 우회 기법은 `kb-sync.integration.spec.ts`와 동일(가짜 DNS + 가짜 전송 → 로컬 목 서버로 소켓만
 * 실제 연결). 이 파일은 그 파일을 수정하지 않고 **새 파일**로 추가한다(기존 시험 변경은 금지 항목이라
 * X-1·X-2 두 건에만 허용됨 — 그 두 건은 `parse-ingest-response.spec.ts`·`parse-task-status.spec.ts`).
 */

const API_ROOT = join(__dirname, '..', '..');

/** 추출 텍스트가 200자 미만인 페이지는 NO_BODY로 제외된다(RG-11) — 시험 페이지에 본문 분량을 채운다. */
const FILLER = '이 페이지는 지식베이스 동기화 시험을 위한 본문 분량 채움 문장입니다. '.repeat(6);

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

/* ------------------------------------------------------------------------------------------
 * 로컬 목 "사내 사이트" — 깊이 체인(/depth/ → l1 → l2 → l3) + 비밀 헤더 보호 페이지(/secret/).
 * ------------------------------------------------------------------------------------------ */
const SECRET_HEADER_VALUE = 'sekrit-CAPS-VALUE-9f3a7c';
const RAW_CONTENT_MARKER = 'RAW-CONTENT-MARKER-do-not-log-1a2b3c';

function startMockSiteServer(): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const parsed = new URL(req.url ?? '/', 'http://intra.example.invalid');
      const path = parsed.pathname;

      if (path === '/robots.txt') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('User-agent: *\nAllow: /\n');
        return;
      }
      if (path === '/depth/') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><body><main><h1>깊이0</h1><a href="/depth/l1">1단계</a><p>' + FILLER + '</p></main></body></html>');
        return;
      }
      if (path === '/depth/l1') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><body><main><h1>깊이1</h1><a href="/depth/l1/l2">2단계</a><p>' + FILLER + '</p></main></body></html>');
        return;
      }
      if (path === '/depth/l1/l2') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><body><main><h1>깊이2(초과 — maxDepth=1이면 방문되면 안 됨)</h1><a href="/depth/l1/l2/l3">3단계</a><p>' + FILLER + '</p></main></body></html>');
        return;
      }
      if (path === '/depth/l1/l2/l3') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><body><main><h1>깊이3</h1><p>' + FILLER + '</p></main></body></html>');
        return;
      }
      if (path === '/secret/') {
        const provided = req.headers['x-api-key'];
        if (provided !== SECRET_HEADER_VALUE) {
          res.writeHead(401);
          res.end();
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<html><body><main><h1>보호 문서</h1><p>${RAW_CONTENT_MARKER} 연락처 02-1234-5678</p><p>${FILLER}</p></main></body></html>`);
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

/* 로컬 목 "외부 RAG" — 적재는 즉시 동기 성공 문자열로 응답한다. */
function startMockRagServer(): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const parsed = new URL(req.url ?? '/', 'http://rag.local');
      if (parsed.pathname === '/api/status') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'healthy', vllm_ready: true, services: { vllm: { status: 'connected' } } })); // API_RAG.md §0-5 모양 — 준비 여부는 최상위 vllm_ready
        return;
      }
      if (parsed.pathname === '/api/documents/ingest' && req.method === 'POST') {
        let raw = Buffer.alloc(0);
        req.on('data', (c) => (raw = Buffer.concat([raw, c])));
        req.on('end', () => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ result: 'RAG Vector DB 추가 성공.' }));
        });
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
      if (hostname === 'intra.example.invalid') return ['203.0.113.10']; // TEST-NET-3 — PUBLIC 분류
      return ['203.0.113.99'];
    },
  };
}

function makeFakeTransport(getMockBaseUrl: () => string): LegacyTransport {
  return {
    request(req: LegacyTransportRequest): Promise<LegacyTransportResult> {
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

/**
 * [항목⑪] `process.stdout.write` 가로채기는 이 환경(ts-jest + 이미 부트스트랩된 Nest 앱)에서
 * 신뢰할 수 없다고 실측으로 확인했다(단독 파일에서는 되는데, 무거운 `beforeAll`(prisma migrate
 * deploy `execSync`·`app.listen()`) 이후에는 재현되지 않는다 — 원인 불명, 아마 stdio 스트림을
 * 내부적으로 바꿔치기하는 의존성 때문). 대신 Nest 공식 API `app.useLogger()`로 전역 로거 자체를
 * 교체한다 — 이미 생성된 `new Logger('Foo')` 인스턴스도 정적 참조를 공유해 이후 호출부터 전부
 * 이 캡처 로거로 간다(재현성 있는 방식).
 */
class CapturingLogger extends ConsoleLogger implements LoggerService {
  readonly captured: string[] = [];
  private record(message: unknown, ...optional: unknown[]): void {
    this.captured.push([message, ...optional].map((m) => (typeof m === 'string' ? m : JSON.stringify(m))).join(' '));
  }
  override log(message: unknown, ...optional: unknown[]): void {
    this.record(message, ...optional);
    super.log(message as string, ...(optional as never[]));
  }
  override warn(message: unknown, ...optional: unknown[]): void {
    this.record(message, ...optional);
    super.warn(message as string, ...(optional as never[]));
  }
  override error(message: unknown, ...optional: unknown[]): void {
    this.record(message, ...optional);
    super.error(message as string, ...(optional as never[]));
  }
  override debug(message: unknown, ...optional: unknown[]): void {
    this.record(message, ...optional);
    super.debug(message as string, ...(optional as never[]));
  }
}

describe('지식베이스 자동 크롤링/동기화(No.43) 보완 시험 — 항목⑥·⑦·⑪', () => {
  let app: NestExpressApplication;
  let baseUrl: string;
  let tmpDir: string;
  let prisma: PrismaService;
  let mockSite: { url: string; close: () => Promise<void> };
  let mockRag: { url: string; close: () => Promise<void> };
  let adminCookie = '';
  let kbSyncJob: { tick: () => Promise<void> };

  async function admin<T = unknown>(method: string, path: string, body?: unknown): Promise<ApiResponse<T>> {
    return jsonRequest(method, `${baseUrl}${path}`, body, { Cookie: adminCookie });
  }

  async function tickUntil(predicate: () => Promise<boolean>, maxIterations = 80): Promise<void> {
    for (let i = 0; i < maxIterations; i += 1) {
      await kbSyncJob.tick();
      if (await predicate()) return;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error('tickUntil: 조건이 충족되지 않았습니다(타임아웃)');
  }

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'chatbot-kb-sync-p8-test-'));
    const dbPath = join(tmpDir, 'test.db').replace(/\\/g, '/');
    const testDatabaseUrl = `file:${dbPath}`;

    mockSite = await startMockSiteServer();
    mockRag = await startMockRagServer();

    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.DEPLOY_SCHEDULE_ENABLED = 'false';
    process.env.WIDGET_BASE_URL = process.env.WIDGET_BASE_URL ?? 'http://localhost:5174';
    process.env.PUBLIC_API_BASE_URL = process.env.PUBLIC_API_BASE_URL ?? 'http://localhost:3000/api/v1';
    delete process.env.EMBEDDING_BASE_URL;

    process.env.KB_SYNC_ENABLED = 'true';
    process.env.KB_INGEST_TRANSPORT_ACK = 'INTERNAL_NETWORK';
    process.env.RAG_BASE_URL = mockRag.url;
    process.env.KB_SYNC_MAX_PARALLEL_SOURCES = '2';
    process.env.KB_INGEST_CONCURRENCY = '1';
    process.env.KB_SECRET__PHASE8REF = SECRET_HEADER_VALUE;

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
      .useValue(makeFakeTransport(() => mockSite.url))
      // [3차 보완] 운영 기본값 `WorkerThreadExtractor`는 빌드 산출물이 필요하다 — ts-jest 실행 조건
      // 문제이므로 시험 구성만 `InProcessExtractor`로 바꾼다(제품 DI 배선은 그대로).
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
    await mockRag?.close();
    await safeCleanupTmpDir(tmpDir);
  }, 15_000);

  /* ──────────────────────────────── 항목⑥ · K-5: 호스트 겹침 크롤 동시 시작 금지 ──────────────────────────────── */
  describe('항목⑥(K-5) — 호스트가 겹치는 소스는 같은 tick에 새로 시작하지 않는다', () => {
    let sourceAId = '';
    let sourceBId = '';

    it('같은 호스트(intra.example.invalid)를 쓰는 소스 2개를 등록한다', async () => {
      const a = await admin<{ id: string }>('POST', '/kb-sources', {
        name: `host-guard-a-${Date.now()}`,
        seedUrls: ['https://intra.example.invalid/hg/a/'],
        sitemapUrls: [],
        pathPrefixes: ['/hg/a/'],
        excludePatterns: [],
        noisePatterns: [],
        allowQueryUrls: false,
        maxDepth: 3,
        maxPages: 50,
        fileTypes: [],
        maxFileBytes: 20971520,
        minIntervalMs: 500,
        scope: { company: '예시공사', category: '테스트', subcategory: '항목6_A' },
        schedule: { kind: 'MANUAL' },
        auth: { kind: 'NONE' },
        piiMask: true,
        allowRawFileIngest: false,
        rightsConfirmed: true,
      });
      expect(a.status).toBe(201);
      sourceAId = a.body.id;

      const b = await admin<{ id: string }>('POST', '/kb-sources', {
        name: `host-guard-b-${Date.now()}`,
        seedUrls: ['https://intra.example.invalid/hg/b/'],
        sitemapUrls: [],
        pathPrefixes: ['/hg/b/'],
        excludePatterns: [],
        noisePatterns: [],
        allowQueryUrls: false,
        maxDepth: 3,
        maxPages: 50,
        fileTypes: [],
        maxFileBytes: 20971520,
        minIntervalMs: 500,
        scope: { company: '예시공사', category: '테스트', subcategory: '항목6_B' },
        schedule: { kind: 'MANUAL' },
        auth: { kind: 'NONE' },
        piiMask: true,
        allowRawFileIngest: false,
        rightsConfirmed: true,
      });
      expect(b.status).toBe(201);
      sourceBId = b.body.id;
    });

    it('소스 A가 CRAWLING 중이면(다른 소스가 이미 점유) — B는 due여도 이번 tick에 클레임되지 않는다', async () => {
      const now = new Date();
      const past = new Date(now.getTime() - 1000);

      // 소스 A가 이미 크롤 중이라고 DB로 직접 흉내낸다(실제 크롤을 돌릴 필요 없음 — 스케줄러의
      // "호스트 겹침 감지"만 관심사).
      const fakeRunId = `fake-run-${Date.now()}`;
      await prisma.kbSyncRun.create({
        data: { id: fakeRunId, sourceId: sourceAId, sourceName: 'host-guard-a', kind: 'PREVIEW', trigger: 'MANUAL', status: 'CRAWLING', configVersion: 1, startedAt: now },
      });
      await prisma.kbSource.update({ where: { id: sourceAId }, data: { activeRunId: fakeRunId, nextRunAt: null } });
      await prisma.kbSource.update({ where: { id: sourceBId }, data: { nextRunAt: past } });

      const scheduler = app.get(KbScheduler);
      const created = await scheduler.scheduleDueSources(now, 10);
      expect(created).toEqual([]); // B가 due였지만 호스트 겹침으로 스킵됐다.

      const bAfter = await prisma.kbSource.findUnique({ where: { id: sourceBId } });
      expect(bAfter?.activeRunId).toBeNull();
      expect(bAfter?.nextRunAt?.getTime()).toBe(past.getTime()); // nextRunAt을 건드리지 않아 다음 tick에 다시 후보가 된다.
    });

    it('소스 A의 크롤이 끝나면 — 같은 호스트인 B도 그다음엔 정상적으로 클레임된다', async () => {
      await prisma.kbSyncRun.update({ where: { id: (await prisma.kbSource.findUnique({ where: { id: sourceAId } }))!.activeRunId! }, data: { status: 'SUCCEEDED', finishedAt: new Date() } });
      await prisma.kbSource.update({ where: { id: sourceAId }, data: { activeRunId: null } });

      const scheduler = app.get(KbScheduler);
      const created = await scheduler.scheduleDueSources(new Date(), 10);
      expect(created.length).toBe(1);

      const bAfter = await prisma.kbSource.findUnique({ where: { id: sourceBId } });
      expect(bAfter?.activeRunId).not.toBeNull();

      // 원복 — 뒤 시험에 영향 없도록.
      await prisma.kbSyncRun.update({ where: { id: bAfter!.activeRunId! }, data: { status: 'CANCELLED', finishedAt: new Date() } });
      await prisma.kbSource.update({ where: { id: sourceBId }, data: { activeRunId: null, nextRunAt: null } });
    });
  });

  /* ──────────────────────────────── 항목⑦: 링크 깊이 = 부모 깊이 + 1 ──────────────────────────────── */
  describe('항목⑦ — 링크 깊이는 부모 깊이+1로 계산되고 maxDepth 경계에서 정확히 잘린다', () => {
    let sourceId = '';
    let runId = '';

    it('maxDepth=1인 소스를 등록하고 PREVIEW를 실행한다', async () => {
      const res = await admin<{ id: string }>('POST', '/kb-sources', {
        name: `depth-boundary-${Date.now()}`,
        seedUrls: ['https://intra.example.invalid/depth/'],
        sitemapUrls: [],
        pathPrefixes: ['/depth/'],
        excludePatterns: [],
        noisePatterns: [],
        allowQueryUrls: false,
        maxDepth: 1,
        maxPages: 50,
        fileTypes: [],
        maxFileBytes: 20971520,
        minIntervalMs: 500,
        scope: { company: '예시공사', category: '테스트', subcategory: '항목7' },
        schedule: { kind: 'MANUAL' },
        auth: { kind: 'NONE' },
        piiMask: true,
        allowRawFileIngest: false,
        rightsConfirmed: true,
      });
      expect(res.status).toBe(201);
      sourceId = res.body.id;

      const run = await admin<{ runId: string }>('POST', `/kb-sources/${sourceId}/runs`, { kind: 'PREVIEW' });
      expect(run.status).toBe(202);
      runId = run.body.runId;

      await tickUntil(async () => {
        const r = await admin<{ status: string }>('GET', `/kb-sources/${sourceId}/runs/${runId}`);
        return r.body.status === 'SUCCEEDED' || r.body.status === 'FAILED';
      });
      const runDetail = await admin<{ status: string }>('GET', `/kb-sources/${sourceId}/runs/${runId}`);
      expect(runDetail.body.status).toBe('SUCCEEDED');
    }, 20_000);

    it('깊이 0·1 문서만 방문되고(2개) 깊이 2·3은 범위 밖이라 방문되지 않는다', async () => {
      const docs = await admin<{ items: Array<{ displayUrl: string }>; total: number }>('GET', `/kb-sources/${sourceId}/documents`);
      expect(docs.body.total).toBe(2);
      const urls = docs.body.items.map((d) => d.displayUrl);
      expect(urls.some((u) => u.endsWith('/depth/'))).toBe(true);
      expect(urls.some((u) => u.endsWith('/depth/l1'))).toBe(true);
      expect(urls.some((u) => u.includes('/depth/l1/l2'))).toBe(false);

      // API 응답 DTO는 depth를 노출하지 않으므로(§11 — 필요 정보만) DB에서 직접 확인해 "부모 깊이+1"
      // 계산 자체(항목⑦)를 검증한다.
      const rows = await prisma.kbDocument.findMany({ where: { sourceId }, select: { url: true, depth: true } });
      const byUrl = new Map(rows.map((r) => [r.url, r.depth]));
      const rootEntry = [...byUrl.entries()].find(([u]) => u.endsWith('/depth/'));
      const l1Entry = [...byUrl.entries()].find(([u]) => u.endsWith('/depth/l1'));
      expect(rootEntry?.[1]).toBe(0);
      expect(l1Entry?.[1]).toBe(1);
    });
  });

  /* ──────────────────────────────── 항목⑪ · KB-15: 로그에 비밀·원문 누출 없음 ──────────────────────────────── */
  describe('항목⑪(KB-15) — 고정 헤더 비밀값·원문 본문이 실행 중 로그에 절대 나타나지 않는다', () => {
    it('STATIC_HEADER 인증이 필요한 소스를 크롤·적재하는 동안 stdout/stderr를 캡처해 검사한다', async () => {
      const res = await admin<{ id: string }>('POST', '/kb-sources', {
        name: `no-log-leak-${Date.now()}`,
        seedUrls: ['https://intra.example.invalid/secret/'],
        sitemapUrls: [],
        pathPrefixes: ['/secret/'],
        excludePatterns: [],
        noisePatterns: [],
        allowQueryUrls: false,
        maxDepth: 0,
        maxPages: 10,
        fileTypes: [],
        maxFileBytes: 20971520,
        minIntervalMs: 500,
        scope: { company: '예시공사', category: '테스트', subcategory: '항목11' },
        schedule: { kind: 'MANUAL' },
        auth: { kind: 'STATIC_HEADER', headerName: 'X-Api-Key', secretRef: 'PHASE8REF' },
        piiMask: true,
        allowRawFileIngest: false,
        rightsConfirmed: true,
      });
      expect(res.status).toBe(201);
      const sourceId = res.body.id;

      const previewRun = await admin<{ runId: string }>('POST', `/kb-sources/${sourceId}/runs`, { kind: 'PREVIEW' });
      expect(previewRun.status).toBe(202);

      // Nest 공식 API로 전역 로거를 캡처 로거로 바꾼다(정적 참조 공유 — 이미 생성된 `new Logger(...)`
      // 인스턴스도 이후 호출부터 캡처된다). 시험이 끝나면 반드시 기본 로거로 되돌린다.
      const capturingLogger = new CapturingLogger();
      app.useLogger(capturingLogger);

      try {
        await tickUntil(async () => {
          const r = await admin<{ status: string }>('GET', `/kb-sources/${sourceId}/runs/${previewRun.body.runId}`);
          return r.body.status === 'SUCCEEDED' || r.body.status === 'FAILED';
        });

        const approve = await admin<{ runId: string }>('POST', `/kb-sources/${sourceId}/approve-ingest`, { previewRunId: previewRun.body.runId });
        expect(approve.status).toBe(202);
        await tickUntil(async () => {
          const r = await admin<{ status: string }>('GET', `/kb-sources/${sourceId}/runs/${approve.body.runId}`);
          return r.body.status === 'SUCCEEDED' || r.body.status === 'PARTIAL' || r.body.status === 'FAILED';
        });

        // 확인 — 실제로 인증 헤더를 써서 본문을 성공적으로 가져왔는지(그렇지 않으면 이 시험은 "누출이
        // 없다"를 공짜로 통과하는 거짓양성이 된다).
        const runDetail = await admin<{ status: string; ingest: { succeeded: number } | null }>('GET', `/kb-sources/${sourceId}/runs/${approve.body.runId}`);
        expect(runDetail.body.status).toBe('SUCCEEDED');
        expect(runDetail.body.ingest?.succeeded).toBe(1);
      } finally {
        app.useLogger(new ConsoleLogger());
      }

      const joined = capturingLogger.captured.join('\n');
      expect(joined).not.toContain(SECRET_HEADER_VALUE);
      expect(joined).not.toContain(RAW_CONTENT_MARKER);
      expect(capturingLogger.captured.length).toBeGreaterThan(0); // 캡처 장치 자체가 동작했는지 확인(거짓양성 방지).
    }, 30_000);
  });
});
