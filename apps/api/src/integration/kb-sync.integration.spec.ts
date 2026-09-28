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
import { KbSourcesService } from '../kb-sync/kb-sources.service';

/**
 * 지식베이스 자동 크롤링/동기화(No.43) 통합 시험 — `kb-crawling-설계.md` §17.
 *
 * SSRF 시험 기법은 `legacy-api-integration.integration.spec.ts`와 동일하다: 루프백은 절대 차단이라
 * `KB_DNS_RESOLVER`(가짜 — 시험용 도메인을 공인(TEST-NET-3) 주소로 위장) + `KB_TRANSPORT`(가짜 —
 * 검증을 통과한 요청만 실제로는 로컬 목 "사내 사이트" 서버로 돌린다)를 오버라이드한다. 외부 RAG는
 * `RagHttpClient`가 표준 Fetch API를 직접 쓰므로(전용 SSRF 계층 없음 — ADR-0022 기존 설계 그대로)
 * `RAG_BASE_URL`을 로컬 목 서버로 그대로 가리킨다.
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
 * 로컬 목 "사내 사이트" — 페이지 2개(/hr/ → /hr/policy). ETag로 조건부 요청·삭제 감지를 제어한다.
 * ------------------------------------------------------------------------------------------ */
interface SiteState {
  etagSuffix: string;
  policyGone: boolean;
  requestLog: string[];
}

function startMockSiteServer(state: SiteState): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const parsed = new URL(req.url ?? '/', 'http://intra.example.invalid');
      state.requestLog.push(parsed.pathname);
      const etag = `"v-${state.etagSuffix}"`;
      const inm = req.headers['if-none-match'];

      if (parsed.pathname === '/robots.txt') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('User-agent: *\nAllow: /\n');
        return;
      }
      if (parsed.pathname === '/hr/') {
        if (inm === etag) {
          res.writeHead(304, { ETag: etag });
          res.end();
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html', ETag: etag });
        res.end('<html><body><main><h1>인사 규정</h1><p>본문 내용입니다. 자세한 사항은 아래 링크를 참고하세요.</p><a href="/hr/policy">세부 규정</a><p>' + FILLER + '</p></main></body></html>');
        return;
      }
      if (parsed.pathname === '/hr/policy') {
        if (state.policyGone) {
          res.writeHead(404);
          res.end();
          return;
        }
        if (inm === etag) {
          res.writeHead(304, { ETag: etag });
          res.end();
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html', ETag: etag });
        res.end('<html><body><main><h1>세부 규정</h1><p>세부 규정 본문입니다. 연락처: 02-1234-5678</p><p>' + FILLER + '</p></main></body></html>');
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

/* ------------------------------------------------------------------------------------------
 * 로컬 목 "외부 RAG" — 적재는 즉시 동기 성공 문자열로 응답한다(비동기 폴링 없이 흐름 검증에 집중).
 * ------------------------------------------------------------------------------------------ */
interface RagState {
  ingestCount: number;
}

function startMockRagServer(state: RagState): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const parsed = new URL(req.url ?? '/', 'http://rag.local');
      if (parsed.pathname === '/api/status') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'healthy', vllm_ready: true, services: { vllm: { status: 'connected' } } })); // API_RAG.md §0-5 모양 — 준비 여부는 최상위 vllm_ready
        return;
      }
      if (parsed.pathname === '/api/documents/ingest' && req.method === 'POST') {
        state.ingestCount += 1;
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

/** 가짜 전송 — 검증 통과한 요청만 로컬 목 사이트로 실제 소켓 연결을 돌린다(운영 SSRF 로직 무수정). */
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

describe('지식베이스 자동 크롤링/동기화(No.43) 통합 시험', () => {
  let app: NestExpressApplication;
  let baseUrl: string;
  let tmpDir: string;
  let prisma: PrismaService;
  let mockSite: { url: string; close: () => Promise<void> };
  let mockRag: { url: string; close: () => Promise<void> };
  const siteState: SiteState = { etagSuffix: '1', policyGone: false, requestLog: [] };
  const ragState: RagState = { ingestCount: 0 };

  let adminCookie = '';
  let viewerCookie = '';
  let kbSyncJob: { tick: () => Promise<void> };

  async function admin<T = unknown>(method: string, path: string, body?: unknown): Promise<ApiResponse<T>> {
    return jsonRequest(method, `${baseUrl}${path}`, body, { Cookie: adminCookie });
  }
  async function viewer<T = unknown>(method: string, path: string, body?: unknown): Promise<ApiResponse<T>> {
    return jsonRequest(method, `${baseUrl}${path}`, body, { Cookie: viewerCookie });
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
    tmpDir = mkdtempSync(join(tmpdir(), 'chatbot-kb-sync-test-'));
    const dbPath = join(tmpDir, 'test.db').replace(/\\/g, '/');
    const testDatabaseUrl = `file:${dbPath}`;

    mockSite = await startMockSiteServer(siteState);
    mockRag = await startMockRagServer(ragState);

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
      // [3차 보완] 운영 기본값은 `WorkerThreadExtractor`(빌드 산출물 필요)다 — ts-jest는 그 산출물
      // 없이 돈다는 시험 실행 조건 문제이지 제품 배선 문제가 아니므로, 시험 구성만 `InProcessExtractor`
      // (같은 `run-extract-job.ts` 순수 로직을 스레드 격리 없이 직접 호출)로 바꾼다.
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
    viewerCookie = await loginAs(baseUrl, 'VIEWER');

    const { KbSyncJob } = await import('../kb-sync/engine/kb-sync.job');
    kbSyncJob = moduleRef.get(KbSyncJob);
    // `KB_SYNC_ENABLED=true`는 관리 API 게이트(404 해제)와 루프 자동 기동을 함께 켠다(§9.1 — 단일
    // 스위치, No.28/No.41과 달리 별도 "루프 전용" 변수가 없다). 이 시험은 엔진을 `tick()` 직접
    // 호출로만 구동하므로(CLAUDE.md 규약), 부트스트랩이 자동 시작한 백그라운드 루프를 `onModuleDestroy()`
    // (기존 Nest 라이프사이클 훅 — 신규 시험 전용 API 0)로 즉시 멈춰 수동 tick과 경합하지 않게 한다.
    await (kbSyncJob as unknown as { onModuleDestroy(): Promise<void> }).onModuleDestroy();
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await mockSite?.close();
    await mockRag?.close();
    await safeCleanupTmpDir(tmpDir);
  }, 15_000);

  let sourceId = '';

  it('AC-KB1: ADMIN이 소스를 등록한다(권리 확인 필수) — 첫 저장은 승인 전(미리보기 필요)', async () => {
    const res = await admin<{ id: string; ingestApproved: boolean; needsPreview: boolean; configVersion: number }>('POST', '/kb-sources', {
      name: `인사규정-${Date.now()}`,
      seedUrls: ['https://intra.example.invalid/hr/'],
      sitemapUrls: [],
      pathPrefixes: ['/hr/'],
      excludePatterns: [],
      noisePatterns: [],
      allowQueryUrls: false,
      maxDepth: 3,
      maxPages: 50,
      fileTypes: [],
      maxFileBytes: 20971520,
      minIntervalMs: 500,
      scope: { company: '예시공사', category: '인사', subcategory: '크롤_인사규정' },
      schedule: { kind: 'MANUAL' },
      auth: { kind: 'NONE' },
      piiMask: true,
      allowRawFileIngest: false,
      rightsConfirmed: true,
    });
    expect(res.status).toBe(201);
    expect(res.body.ingestApproved).toBe(false);
    expect(res.body.needsPreview).toBe(true);
    expect(res.body.configVersion).toBe(1);
    sourceId = res.body.id;
  });

  it('권한 매트릭스: VIEWER는 소스 목록을 볼 수 없다(security:read 없음) — 403', async () => {
    const res = await viewer('GET', '/kb-sources');
    expect(res.status).toBe(403);
  });

  it('SYNC 실행은 승인 전이라 거부된다(KB_INGEST_NOT_ALLOWED · PREVIEW_REQUIRED)', async () => {
    const res = await admin('POST', `/kb-sources/${sourceId}/runs`, { kind: 'SYNC' });
    expect(res.status).toBe(409);
    expect((res.body as { code: string }).code).toBe('KB_INGEST_NOT_ALLOWED');
    expect(ragState.ingestCount).toBe(0);
  });

  let previewRunId = '';

  it('PREVIEW 실행 — 크롤은 하되 적재 작업을 만들지 않는다(외부 RAG 호출 0)', async () => {
    const res = await admin<{ runId: string }>('POST', `/kb-sources/${sourceId}/runs`, { kind: 'PREVIEW' });
    expect(res.status).toBe(202);
    previewRunId = res.body.runId;

    await tickUntil(async () => {
      const r = await admin<{ status: string }>('GET', `/kb-sources/${sourceId}/runs/${previewRunId}`);
      return r.body.status === 'SUCCEEDED' || r.body.status === 'FAILED';
    });

    const runDetail = await admin<{ status: string }>('GET', `/kb-sources/${sourceId}/runs/${previewRunId}`);
    expect(runDetail.body.status).toBe('SUCCEEDED');
    expect(ragState.ingestCount).toBe(0);

    const docs = await admin<{ items: Array<{ observedChange: string }>; total: number }>('GET', `/kb-sources/${sourceId}/documents`);
    expect(docs.body.total).toBe(2); // /hr/ · /hr/policy
    expect(docs.body.items.every((d) => d.observedChange === 'NEW')).toBe(true);
  }, 20_000);

  it('적재 시작(승인) — 재크롤 후 두 문서 모두 외부 RAG에 성공 적재된다', async () => {
    const approve = await admin<{ runId: string }>('POST', `/kb-sources/${sourceId}/approve-ingest`, { previewRunId });
    expect(approve.status).toBe(202);
    const syncRunId = approve.body.runId;

    await tickUntil(async () => {
      const r = await admin<{ status: string }>('GET', `/kb-sources/${sourceId}/runs/${syncRunId}`);
      return r.body.status === 'SUCCEEDED' || r.body.status === 'PARTIAL' || r.body.status === 'FAILED';
    });

    const runDetail = await admin<{ status: string; ingest: { succeeded: number; total: number } | null }>('GET', `/kb-sources/${sourceId}/runs/${syncRunId}`);
    expect(runDetail.body.status).toBe('SUCCEEDED');
    expect(runDetail.body.ingest?.succeeded).toBe(2);
    expect(ragState.ingestCount).toBe(2);

    const source = await admin<{ ingestApproved: boolean }>('GET', `/kb-sources/${sourceId}`);
    expect(source.body.ingestApproved).toBe(true);

    const docs = await admin<{ items: Array<{ lastIngestedAt: string | null; externalFileName: string | null }> }>('GET', `/kb-sources/${sourceId}/documents`);
    for (const d of docs.body.items) {
      expect(d.lastIngestedAt).not.toBeNull();
      expect(d.externalFileName).toMatch(/^kb_[0-9a-f]{8}_[0-9a-f]{16}\.docx$/);
    }
  }, 20_000);

  it('AC-KB3-1: 변경 없는 재실행 — 외부 RAG 적재 호출이 0건 늘어난다(304 그대로 재사용)', async () => {
    const before = ragState.ingestCount;
    const res = await admin<{ runId: string }>('POST', `/kb-sources/${sourceId}/runs`, { kind: 'SYNC' });
    expect(res.status).toBe(202);
    const runId = res.body.runId;

    await tickUntil(async () => {
      const r = await admin<{ status: string }>('GET', `/kb-sources/${sourceId}/runs/${runId}`);
      return r.body.status === 'SUCCEEDED' || r.body.status === 'FAILED';
    });

    const runDetail = await admin<{ status: string }>('GET', `/kb-sources/${sourceId}/runs/${runId}`);
    expect(runDetail.body.status).toBe('SUCCEEDED');
    expect(ragState.ingestCount).toBe(before); // 추가 적재 호출 0건

    const docs = await admin<{ items: Array<{ observedChange: string; displayUrl: string }>; total: number }>('GET', `/kb-sources/${sourceId}/documents?runId=${runId}`);
    expect(docs.body.items.every((d) => d.observedChange === 'UNCHANGED')).toBe(true);
  }, 20_000);

  it('삭제 감지 — 연속 2회 404면 "정리 필요"(cleanupReason=GONE) · 외부 삭제 호출 0', async () => {
    siteState.policyGone = true;

    for (let i = 0; i < 2; i += 1) {
      const before = siteState.requestLog.length;
      const res = await admin<{ runId: string }>('POST', `/kb-sources/${sourceId}/runs`, { kind: 'SYNC' });
      expect(res.status).toBe(202);
      const runId = res.body.runId;
      await tickUntil(async () => {
        const r = await admin<{ status: string }>('GET', `/kb-sources/${sourceId}/runs/${runId}`);
        return r.body.status === 'SUCCEEDED' || r.body.status === 'FAILED';
      });
      // [pass 6 · H-2 · 시험 품질] 이 시험은 예전에 결함 때문에 우연히 통과했다 — 부모(/hr/)가 304라 링크를 못 따라가 /hr/policy를 **한 번도 요청하지 않았고**, "다시 발견되지 않음"이
      // 2번 쌓여 GONE이 됐다. 이제 부모가 304여도 자식을 이어 방문하므로 /hr/policy가 **실제로 404를 받는다**는 것을 요청 기록으로 확인한다.
      expect(siteState.requestLog.slice(before)).toContain('/hr/policy');
    }

    const docs = await admin<{ items: Array<{ displayUrl: string; state: string; cleanupReason: string | null }> }>('GET', `/kb-sources/${sourceId}/documents?cleanupOnly=true`);
    expect(docs.body.items.length).toBe(1);
    expect(docs.body.items[0].displayUrl).toContain('/hr/policy');
    expect(docs.body.items[0].state).toBe('GONE');
    expect(docs.body.items[0].cleanupReason).toBe('GONE');
  }, 30_000);

  it('AC-KB5-2: 다중 인스턴스 동시성 — 같은 소스를 동시에 claimForRun하면 1건만 성공한다(CAS)', async () => {
    const sourcesService = app.get(KbSourcesService);
    const [a, b] = await Promise.all([sourcesService.claimForRun(sourceId, 'run-a', null), sourcesService.claimForRun(sourceId, 'run-b', null)]);
    const successes = [a, b].filter(Boolean).length;
    expect(successes).toBe(1);
    // 원복(다음 시험에 영향 없도록) — 실제로는 activeRunId가 run-a 또는 run-b로 남아 있다.
    await prisma.kbSource.update({ where: { id: sourceId }, data: { activeRunId: null } });
  });

  it('감사 로그에 지식베이스 소스 등록·상태변경 기록이 남는다(값 비밀 필드 없음)', async () => {
    const res = await admin<{ items: Array<{ targetType: string; action: string }> }>('GET', `/audit-logs?targetType=KbSource&pageSize=50`);
    expect(res.status).toBe(200);
    const actions = res.body.items.map((i) => i.action);
    expect(actions).toContain('CREATE');
    expect(actions).toContain('STATUS_CHANGE');
  });
});
