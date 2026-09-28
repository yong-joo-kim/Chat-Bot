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
 * 지식베이스 자동 크롤링/동기화(No.43) — ★ AC-KB2-4(리다이렉트 매 단계 재검증) 전용 통합 시험.
 *
 * `kb-crawling-설계.md` §17.1 "필수 10종" 중 하나. 3가지를 확인한다:
 * ① 같은 호스트 안의 302는 최대 3회까지 따라가 최종 200 본문을 얻는다.
 * ② 같은 호스트 안이라도 4번째 redirect hop은 따라가지 않고(3회 초과) 그 문서는 방문 실패로 남는다
 *    (마지막 목적지 페이지는 절대 요청되지 않는다).
 * ③ 302 대상이 **다른 호스트**(소스의 `allowedHosts` 밖)면 `isInScope` 재검증에서 걸려 그 요청 자체가
 *    나가지 않는다(범위 밖 호스트로 향하는 실제 네트워크 요청 0).
 *
 * SSRF 시험 기법은 `kb-sync.integration.spec.ts`와 동일 — 가짜 DNS·가짜 전송으로 실제 네트워크 0.
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
 * 로컬 목 "사내 사이트" — 리다이렉트 체인 3종(정상 3홉·정지 4홉·범위밖 호스트).
 * ------------------------------------------------------------------------------------------ */
interface SiteState {
  requestLog: string[];
}

function startMockSiteServer(state: SiteState): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const parsed = new URL(req.url ?? '/', 'http://intra.example.invalid');
      state.requestLog.push(parsed.pathname);

      if (parsed.pathname === '/robots.txt') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('User-agent: *\nAllow: /\n');
        return;
      }
      // ① 정상 3홉 체인 — hop0 → hop1 → hop2 → hop3(200).
      if (parsed.pathname === '/redir3/hop0') {
        res.writeHead(302, { Location: '/redir3/hop1' });
        res.end();
        return;
      }
      if (parsed.pathname === '/redir3/hop1') {
        res.writeHead(302, { Location: '/redir3/hop2' });
        res.end();
        return;
      }
      if (parsed.pathname === '/redir3/hop2') {
        res.writeHead(302, { Location: '/redir3/hop3' });
        res.end();
        return;
      }
      if (parsed.pathname === '/redir3/hop3') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><head><title>최종 페이지</title></head><body><main><p>도착했습니다.</p><p>' + FILLER + '</p></main></body></html>');
        return;
      }
      // ② 4홉 체인(3회 초과) — hop0..hop3까지는 302, hop4(최종)는 요청되면 안 된다.
      if (parsed.pathname === '/redir4/hop0') {
        res.writeHead(302, { Location: '/redir4/hop1' });
        res.end();
        return;
      }
      if (parsed.pathname === '/redir4/hop1') {
        res.writeHead(302, { Location: '/redir4/hop2' });
        res.end();
        return;
      }
      if (parsed.pathname === '/redir4/hop2') {
        res.writeHead(302, { Location: '/redir4/hop3' });
        res.end();
        return;
      }
      if (parsed.pathname === '/redir4/hop3') {
        res.writeHead(302, { Location: '/redir4/hop4' });
        res.end();
        return;
      }
      if (parsed.pathname === '/redir4/hop4') {
        // 절대 도달하면 안 되는 목적지 — 요청 로그에 잡히면 시험이 실패해야 한다.
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><head><title>도달하면 안 됨</title></head><body><main><p>여기 오면 실패</p><p>' + FILLER + '</p></main></body></html>');
        return;
      }
      // ③ 다른 호스트로의 302 — 범위 밖.
      if (parsed.pathname === '/redir-cross/start') {
        res.writeHead(302, { Location: 'https://out-of-scope.example.invalid/cross-host-target' });
        res.end();
        return;
      }
      if (parsed.pathname === '/cross-host-target') {
        // 가짜 전송이 호스트 구분 없이 로컬로 라우팅하므로, 이 경로가 요청 로그에 나타나면 안 된다.
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><body><main><p>범위 밖 — 도달하면 안 됨</p><p>' + FILLER + '</p></main></body></html>');
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

describe('지식베이스 자동 크롤링/동기화(No.43) — AC-KB2-4 리다이렉트 매 단계 재검증', () => {
  let app: NestExpressApplication;
  let baseUrl: string;
  let tmpDir: string;
  let prisma: PrismaService;
  let mockSite: { url: string; close: () => Promise<void> };
  const siteState: SiteState = { requestLog: [] };

  let adminCookie = '';
  let kbSyncJob: { tick: () => Promise<void> };

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

  async function registerAndPreview(name: string, seedPath: string, pathPrefix: string): Promise<string> {
    const created = await admin<{ id: string }>('POST', '/kb-sources', {
      name: `${name}-${Date.now()}`,
      seedUrls: [`https://intra.example.invalid${seedPath}`],
      sitemapUrls: [],
      pathPrefixes: [pathPrefix],
      excludePatterns: [],
      noisePatterns: [],
      allowQueryUrls: false,
      maxDepth: 3,
      maxPages: 50,
      fileTypes: [],
      maxFileBytes: 20971520,
      minIntervalMs: 500,
      scope: { company: '예시공사', category: '인사', subcategory: `크롤_${name}` },
      schedule: { kind: 'MANUAL' },
      auth: { kind: 'NONE' },
      piiMask: true,
      allowRawFileIngest: false,
      rightsConfirmed: true,
    });
    expect(created.status).toBe(201);
    const sourceId = created.body.id;

    const run = await admin<{ runId: string }>('POST', `/kb-sources/${sourceId}/runs`, { kind: 'PREVIEW' });
    expect(run.status).toBe(202);
    const runId = run.body.runId;

    await tickUntil(async () => {
      const r = await admin<{ status: string }>('GET', `/kb-sources/${sourceId}/runs/${runId}`);
      return r.body.status === 'SUCCEEDED' || r.body.status === 'FAILED';
    });

    return sourceId;
  }

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'chatbot-kb-redirect-test-'));
    const dbPath = join(tmpDir, 'test.db').replace(/\\/g, '/');
    const testDatabaseUrl = `file:${dbPath}`;

    mockSite = await startMockSiteServer(siteState);

    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.DEPLOY_SCHEDULE_ENABLED = 'false';
    process.env.WIDGET_BASE_URL = process.env.WIDGET_BASE_URL ?? 'http://localhost:5174';
    process.env.PUBLIC_API_BASE_URL = process.env.PUBLIC_API_BASE_URL ?? 'http://localhost:3000/api/v1';
    delete process.env.EMBEDDING_BASE_URL;

    process.env.KB_SYNC_ENABLED = 'true';
    process.env.KB_INGEST_TRANSPORT_ACK = 'INTERNAL_NETWORK';
    process.env.RAG_BASE_URL = 'http://127.0.0.1:1'; // 이 시험은 크롤(PREVIEW)만 다루므로 적재 호출 없음.
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

  it('① 같은 호스트 안의 302는 최대 3회까지 따라가 최종 본문을 얻는다', async () => {
    const sourceId = await registerAndPreview('redir3', '/redir3/hop0', '/redir3/');

    expect(siteState.requestLog).toEqual(expect.arrayContaining(['/redir3/hop0', '/redir3/hop1', '/redir3/hop2', '/redir3/hop3']));

    // [pass 6 · RG-16] 최종 URL(hop3)로 문서를 기록한다 — 원래 URL(hop0)은 방문 표시만(적재 후보 아님).
    const docs = await admin<{ items: Array<{ displayUrl: string; title: string | null; state: string; observedChange: string | null }> }>('GET', `/kb-sources/${sourceId}/documents`);
    expect(docs.body.items.length).toBe(2);
    const finalDoc = docs.body.items.find((d) => d.displayUrl.endsWith('/redir3/hop3'));
    const originDoc = docs.body.items.find((d) => d.displayUrl.endsWith('/redir3/hop0'));
    expect(finalDoc?.title).toBe('최종 페이지');
    expect(finalDoc?.state).toBe('ACTIVE');
    expect(finalDoc?.observedChange).toBe('NEW');
    expect(originDoc?.state).toBe('ACTIVE');
    expect(originDoc?.observedChange).toBeNull();
  }, 20_000);

  it('② 같은 호스트라도 4번째 hop은 따라가지 않는다 — 최종 목적지는 절대 요청되지 않는다', async () => {
    const before = siteState.requestLog.length;
    const sourceId = await registerAndPreview('redir4', '/redir4/hop0', '/redir4/');

    const requestedAfter = siteState.requestLog.slice(before);
    expect(requestedAfter).toEqual(expect.arrayContaining(['/redir4/hop0', '/redir4/hop1', '/redir4/hop2', '/redir4/hop3']));
    expect(requestedAfter).not.toContain('/redir4/hop4'); // ★ 4번째 hop 목적지는 절대 요청되지 않는다.

    const docs = await admin<{ items: Array<{ title: string | null; state: string; observedChange: string | null }> }>('GET', `/kb-sources/${sourceId}/documents`);
    expect(docs.body.items.length).toBe(1);
    expect(docs.body.items[0].title).toBeNull(); // 방문 성공한 적이 없다.
    expect(docs.body.items[0].observedChange).not.toBe('NEW');
    expect(docs.body.items[0].state).toBe('EXCLUDED'); // [pass 6 · RG-16] 4번째 hop = 제외(REDIRECT_OUT_OF_SCOPE) — 일시 오류가 아니다.
  }, 20_000);

  it('③ 302 대상이 다른 호스트면(범위 밖) 그 요청 자체가 나가지 않는다', async () => {
    const before = siteState.requestLog.length;
    const sourceId = await registerAndPreview('redir-cross', '/redir-cross/start', '/redir-cross/');

    const requestedAfter = siteState.requestLog.slice(before);
    expect(requestedAfter).toEqual(expect.arrayContaining(['/redir-cross/start']));
    expect(requestedAfter).not.toContain('/cross-host-target'); // ★ 범위 밖 호스트로는 요청 자체가 나가지 않는다.

    const docs = await admin<{ items: Array<{ title: string | null; state: string }> }>('GET', `/kb-sources/${sourceId}/documents`);
    expect(docs.body.items.length).toBe(1);
    expect(docs.body.items[0].title).toBeNull();
    expect(docs.body.items[0].state).toBe('EXCLUDED'); // [pass 6 · RG-16] 범위 밖 호스트로의 리다이렉트 = 제외(REDIRECT_OUT_OF_SCOPE).
  }, 20_000);
});
