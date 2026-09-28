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
import { KbRunStore } from '../kb-sync/core/kb-run.store';

/**
 * 지식베이스 자동 크롤링/동기화(No.43) 다중 인스턴스 시험(Phase 8 — 항목⑧·⑨).
 *
 * `createNestApplication()`을 **두 번** 호출해(각각 독립 DI 컨테이너) 같은 SQLite 파일을 공유하게
 * 만든다 — 실제 운영에서 인스턴스 2대가 같은 DB를 보는 상황을 그대로 재현한다. 시각은 전부 상대
 * 시각(`Date.now()` 기준 오프셋)만 쓴다(고정 날짜 리터럴 금지).
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

/** 목 사이트가 받은 요청 경로(순서대로) — RG-9 시험이 "같은 URL을 두 번 치지 않았다"를 확인한다. */
const siteLog: string[] = [];
const siteLogAt: number[] = [];
const LONG_BODY = '이 문서는 다중 인스턴스 시험용 본문입니다. '.repeat(12);

function startMockSiteServer(): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const parsed = new URL(req.url ?? '/', 'http://intra.example.invalid');
      siteLog.push(parsed.pathname);
      siteLogAt.push(Date.now());
      if (parsed.pathname === '/mi2/' || parsed.pathname === '/mi2/a' || parsed.pathname === '/mi2/b') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        const links = parsed.pathname === '/mi2/' ? '<a href="/mi2/a">A</a><a href="/mi2/b">B</a>' : '';
        res.end(`<html><body><main><h1>${parsed.pathname}</h1><p>${LONG_BODY}</p>${links}</main></body></html>`);
        return;
      }
      if (parsed.pathname === '/robots.txt') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('User-agent: *\nAllow: /\n');
        return;
      }
      if (parsed.pathname === '/mi/') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><body><main><h1>다중 인스턴스 시험 페이지</h1><p>본문입니다.</p></main></body></html>');
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
      if (hostname === 'intra.example.invalid') return ['203.0.113.10'];
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

interface AppInstance {
  app: NestExpressApplication;
  prisma: PrismaService;
  store: KbRunStore;
  kbSyncJob: { tick: () => Promise<void> };
}

async function bootAppInstance(mockSite: { url: string }): Promise<AppInstance> {
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

  const app = moduleRef.createNestApplication<NestExpressApplication>();
  app.enableCors();
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.listen(0);

  const prisma = moduleRef.get(PrismaService);
  const store = moduleRef.get(KbRunStore);
  const { KbSyncJob } = await import('../kb-sync/engine/kb-sync.job');
  const kbSyncJob = moduleRef.get(KbSyncJob);
  await (kbSyncJob as unknown as { onModuleDestroy(): Promise<void> }).onModuleDestroy(); // 자동 루프 중지 — tick() 수동 호출만 쓴다.

  return { app, prisma, store, kbSyncJob };
}

describe('지식베이스 자동 크롤링/동기화(No.43) 다중 인스턴스 시험 — 항목⑧·⑨', () => {
  let tmpDir: string;
  let mockSite: { url: string; close: () => Promise<void> };
  let mockRag: { url: string; close: () => Promise<void> };
  let instanceA: AppInstance;
  let instanceB: AppInstance;
  let baseUrlA = '';
  let adminCookieA = '';

  async function admin<T = unknown>(method: string, path: string, body?: unknown): Promise<ApiResponse<T>> {
    return jsonRequest(method, `${baseUrlA}${path}`, body, { Cookie: adminCookieA });
  }

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'chatbot-kb-sync-mi-test-'));
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
    process.env.KB_SYNC_LEASE_MS = '600000'; // 10분 — 항목⑨에서 "만료"를 상대 시각으로 흉내낸다.

    try {
      execSync('pnpm exec prisma migrate deploy', { cwd: API_ROOT, env: { ...process.env, DATABASE_URL: testDatabaseUrl }, stdio: 'pipe' });
    } catch (e) {
      const err = e as { stdout?: Buffer; stderr?: Buffer };
      throw new Error(`prisma migrate deploy 실패:\n${err.stdout?.toString()}\n${err.stderr?.toString()}`);
    }

    // 두 개의 독립 Nest 앱 인스턴스 — 같은 SQLite 파일을 공유한다(항목⑧ 요구사항 그대로).
    instanceA = await bootAppInstance(mockSite);
    instanceB = await bootAppInstance(mockSite);

    const serverA = instanceA.app.getHttpServer() as http.Server;
    const addressA = serverA.address();
    const portA = typeof addressA === 'object' && addressA !== null ? addressA.port : 0;
    baseUrlA = `http://127.0.0.1:${portA}/api/v1`;

    await seedTestUsers(instanceA.prisma);
    adminCookieA = await loginAs(baseUrlA, 'ADMIN');
  }, 60_000);

  afterAll(async () => {
    await instanceA?.app?.close();
    await instanceB?.app?.close();
    await mockSite?.close();
    await mockRag?.close();
    await safeCleanupTmpDir(tmpDir);
  }, 15_000);

  /* ──────────────────────────────── 항목⑧: 소스 CAS + 전역 직렬 적재 슬롯 ──────────────────────────────── */
  describe('항목⑧ — 두 인스턴스가 같은 DB를 볼 때 소스 CAS·적재 슬롯 CAS가 정확히 1건만 허용한다', () => {
    let sourceId = '';

    it('due 상태(nextRunAt 과거)인 소스 1개를 준비한다', async () => {
      const created = await admin<{ id: string }>('POST', '/kb-sources', {
        name: `multi-instance-${Date.now()}`,
        seedUrls: ['https://intra.example.invalid/mi/'],
        sitemapUrls: [],
        pathPrefixes: ['/mi/'],
        excludePatterns: [],
        noisePatterns: [],
        allowQueryUrls: false,
        maxDepth: 0,
        maxPages: 10,
        fileTypes: [],
        maxFileBytes: 20971520,
        minIntervalMs: 500,
        scope: { company: '예시공사', category: '테스트', subcategory: '항목8' },
        schedule: { kind: 'MANUAL' },
        auth: { kind: 'NONE' },
        piiMask: true,
        allowRawFileIngest: false,
        rightsConfirmed: true,
      });
      expect(created.status).toBe(201);
      sourceId = created.body.id;
      await instanceA.prisma.kbSource.update({ where: { id: sourceId }, data: { nextRunAt: new Date(Date.now() - 1000) } });
    });

    it('두 인스턴스가 동시에 tick()을 돌려도 이 소스의 실행은 정확히 1건만 생성된다(소스 CAS)', async () => {
      await Promise.all([instanceA.kbSyncJob.tick(), instanceB.kbSyncJob.tick()]);
      // 스케줄러가 claim에 성공하면 그 즉시 activeRunId를 채운다 — 두 인스턴스 모두 이 소스를 봤어도
      // 정확히 하나만 `KbSyncRun` 행을 만들어야 한다.
      const runs = await instanceA.prisma.kbSyncRun.findMany({ where: { sourceId } });
      expect(runs.length).toBe(1);
    }, 20_000);

    it('전역 직렬 적재 슬롯(INGEST_SLOT_0)도 두 인스턴스가 동시에 요청하면 1건만 획득한다', async () => {
      await instanceA.store.ensureLeaseRow('INGEST_SLOT_0');
      const now = new Date();
      const [a, b] = await Promise.all([
        instanceA.store.claimAnySlot(['INGEST_SLOT_0'], 600000, now, 'holder-a'),
        instanceB.store.claimAnySlot(['INGEST_SLOT_0'], 600000, now, 'holder-b'),
      ]);
      const acquired = [a, b].filter((v) => v !== null);
      expect(acquired.length).toBe(1);

      // 원복 — 뒤 시험에 영향 없도록 슬롯을 놓아준다.
      const winnerStore = a ? instanceA.store : instanceB.store;
      const winnerSlot = a ?? b;
      if (winnerSlot) await winnerStore.releaseSlot(winnerSlot);
    });
  });

  /* ──────────────────────────────── RG-9: 크롤 임대 상호 배제 ──────────────────────────────── */
  describe('RG-9 — 두 인스턴스가 같은 실행의 tick을 동시에 돌려도 한 인스턴스만 크롤한다', () => {
    it('★ 같은 URL·robots를 두 번 요청하지 않고, 임대 인수(resumedCount) 없이 한 번에 끝난다', async () => {
      const created = await admin<{ id: string }>('POST', '/kb-sources', {
        name: `rg9-${Date.now()}`,
        seedUrls: ['https://intra.example.invalid/mi2/'],
        sitemapUrls: [],
        pathPrefixes: ['/mi2/'],
        excludePatterns: [],
        noisePatterns: [],
        allowQueryUrls: false,
        maxDepth: 2,
        maxPages: 10,
        fileTypes: [],
        maxFileBytes: 20971520,
        minIntervalMs: 500,
        scope: { company: '예시공사', category: '테스트', subcategory: 'RG9' },
        schedule: { kind: 'MANUAL' },
        auth: { kind: 'NONE' },
        piiMask: true,
        allowRawFileIngest: false,
        rightsConfirmed: true,
      });
      expect(created.status).toBe(201);
      const sourceId = created.body.id;
      const startAt = siteLog.length;
      const run = await admin<{ runId: string }>('POST', `/kb-sources/${sourceId}/runs`, { kind: 'PREVIEW' });
      expect(run.status).toBe(202);

      let status = 'QUEUED';
      for (let i = 0; i < 80 && status !== 'SUCCEEDED' && status !== 'FAILED'; i += 1) {
        await Promise.all([instanceA.kbSyncJob.tick(), instanceB.kbSyncJob.tick()]);
        status = (await instanceA.prisma.kbSyncRun.findUniqueOrThrow({ where: { id: run.body.runId } })).status;
        if (status !== 'SUCCEEDED' && status !== 'FAILED') await new Promise((r) => setTimeout(r, 100));
      }
      expect(status).toBe('SUCCEEDED');

      const mine = siteLog.slice(startAt);
      const pageTimes = mine.map((p, i) => ({ p, at: siteLogAt[startAt + i] })).filter((e) => e.p !== '/robots.txt');
      const gaps = pageTimes.slice(1).map((e, i) => e.at - pageTimes[i].at);
      // 소스 간격(500ms)은 인스턴스 하나가 지킨다 — 두 인스턴스가 동시에 크롤하면 간격이 사라지거나 절반이 된다.
      expect(Math.min(...gaps)).toBeGreaterThanOrEqual(400);
      const count = (path: string): number => mine.filter((p) => p === path).length;
      expect(count('/mi2/')).toBe(1);
      expect(count('/mi2/a')).toBe(1);
      expect(count('/mi2/b')).toBe(1);
      // robots.txt는 인스턴스별 24시간 캐시라(앞 시험이 같은 호스트를 이미 읽었을 수 있다) 0 또는 1회다 — 두 인스턴스가 함께 크롤했다면 2회가 된다.
      expect(count('/robots.txt')).toBeLessThanOrEqual(1);
      const row = await instanceA.prisma.kbSyncRun.findUniqueOrThrow({ where: { id: run.body.runId } });
      expect(row.resumedCount).toBe(0);
    }, 60_000);
  });

  /* ──────────────────────────────── 항목⑨: 재시작 후 재개 — 임대 만료 → 다른 인스턴스가 인계 ──────────────────────────────── */
  describe('항목⑨ — 크롤 임대가 만료되면 다른 인스턴스가 인계하고, 중복 획득은 0건이다', () => {
    let runId = '';

    it('인스턴스 A가 시작했다가 죽은(임대 만료) CRAWLING 실행을 직접 만든다(상대 시각)', async () => {
      const staleClaimedAt = new Date(Date.now() - 20 * 60 * 1000); // 임대(10분)보다 오래된 시각 — 상대 시각.
      const created = await instanceA.prisma.kbSyncRun.create({
        data: {
          id: `restart-resume-${Date.now()}`,
          sourceId: 'no-such-source', // 이 시험은 크롤 임대 CAS 자체만 본다(소스 무결성 조인은 관심사가 아님).
          sourceName: 'restart-resume',
          kind: 'PREVIEW',
          trigger: 'MANUAL',
          status: 'CRAWLING',
          configVersion: 1,
          claimToken: 'stale-token-instance-a',
          claimedAt: staleClaimedAt,
          startedAt: staleClaimedAt,
        },
      });
      runId = created.id;
    });

    it('두 인스턴스가 동시에 만료된 임대를 훔치려 하면 정확히 1건만 성공한다(중복 인계 0건)', async () => {
      const now = new Date();
      const leaseMs = 600000; // beforeAll의 KB_SYNC_LEASE_MS와 일치.
      const [claimA, claimB] = await Promise.all([instanceA.store.claimCrawlLease(runId, leaseMs, now), instanceB.store.claimCrawlLease(runId, leaseMs, now)]);
      const successes = [claimA, claimB].filter((v): v is string => v !== null);
      expect(successes.length).toBe(1); // 정확히 1개 인스턴스만 인계에 성공 — 중복 인계 0건.

      const row = await instanceA.prisma.kbSyncRun.findUnique({ where: { id: runId } });
      expect(row?.claimToken).toBe(successes[0]);
      expect(row?.resumedCount).toBe(1); // 인계 1회만 기록됐다(중복 없음).
    });

    it('인계받은 인스턴스만 그 실행을 마무리할 수 있다(옛 토큰으로는 더 이상 갱신 불가)', async () => {
      const staleRenew = await instanceA.store.renewCrawlLease(runId, 'stale-token-instance-a', new Date());
      expect(staleRenew).toBe(false); // 옛 토큰은 더 이상 유효하지 않다 — 중복 처리 경로 차단 확인.
    });
  });
});
