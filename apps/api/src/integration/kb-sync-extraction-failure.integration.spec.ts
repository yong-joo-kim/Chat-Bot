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
import { KB_EXTRACTOR, WorkerEntryMissingError } from '../kb-sync/extract/kb-extractor.port';
import type { KbExtractRequest, KbExtractResult, KbExtractorPort } from '../kb-sync/extract/kb-extractor.port';
import type { LegacyDnsResolver, LegacyTransport, LegacyTransportRequest, LegacyTransportResult } from '../legacy-api/transport/legacy-transport.port';

/**
 * 지식베이스 자동 크롤링/동기화(No.43) R1 리뷰 H-2 — 추출 실패 격리 시험.
 *
 * 가짜 추출기(`KB_EXTRACTOR` override)를 심어 문서 본문에 박아 둔 표식(marker)에 따라 타임아웃·
 * 크래시·워커 진입점 부재를 재현한다 — 실제 `worker_threads`를 띄우지 않아도 "추출이 실패했을 때
 * 크롤러·적재기가 어떻게 반응하는가"만 결정론적으로 검증할 수 있다.
 */

const API_ROOT = join(__dirname, '..', '..');
const TIMEOUT_MARKER = 'TIMEOUT_MARKER_9f3a';
const CRASH_MARKER = 'CRASH_MARKER_7c1e';
const MISSING_ENTRY_MARKER = 'MISSING_ENTRY_MARKER_2b8d';

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
      const parsed = new URL(req.url ?? '/', 'http://intra.example.invalid');
      const path = parsed.pathname;
      const page = (title: string, body: string, links: string[] = []): string =>
        `<html><body><main><h1>${title}</h1><p>${body}</p>${links.map((l) => `<a href="${l}">link</a>`).join('')}</main></body></html>`;

      if (path === '/robots.txt') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('User-agent: *\nAllow: /\n');
        return;
      }
      if (path === '/mix/') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(page('루트', '정상', ['/mix/normal-child', '/mix/timeout-child']));
        return;
      }
      if (path === '/mix/normal-child') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(page('정상 자식', '정상 본문입니다.'));
        return;
      }
      if (path === '/mix/timeout-child') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(page('타임아웃 자식', TIMEOUT_MARKER));
        return;
      }
      if (path === '/mix2/') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(page('루트2', '정상', ['/mix2/normal-child2', '/mix2/crash-child']));
        return;
      }
      if (path === '/mix2/normal-child2') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(page('정상 자식2', '정상 본문입니다.'));
        return;
      }
      if (path === '/mix2/crash-child') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(page('크래시 자식', CRASH_MARKER));
        return;
      }
      if (path === '/missing-entry/') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(page('전역 오류 페이지', MISSING_ENTRY_MARKER));
        return;
      }
      if (path === '/happy/') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(page('정상 소스', '이 소스는 다른 소스의 전역 오류와 무관하게 끝까지 진행돼야 한다.'));
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

/** [H-2] 문서 본문에 박힌 표식에 따라 타임아웃·크래시·워커 진입점 부재를 재현하는 가짜 추출기. */
class MarkerBasedFakeExtractor implements KbExtractorPort {
  calls: string[] = [];
  async extract(req: KbExtractRequest): Promise<KbExtractResult> {
    if (req.kind !== 'HTML') return { ok: true, normalizedText: '', text: '', piiMaskedCount: 0, flags: [] };
    this.calls.push(req.html);
    if (req.html.includes(TIMEOUT_MARKER)) throw new Error('FILE_UNSAFE_TIMEOUT');
    if (req.html.includes(CRASH_MARKER)) throw new Error('WORKER_CRASHED: JS heap out of memory');
    if (req.html.includes(MISSING_ENTRY_MARKER)) throw new WorkerEntryMissingError('extract.worker.js 빌드 산출물이 없습니다(시험용).');
    const title = /<h1>(.*?)<\/h1>/.exec(req.html)?.[1] ?? null;
    const links = [...req.html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    return { ok: true, normalizedText: req.html, text: req.html, piiMaskedCount: 0, title, links, noindex: false, nofollow: false, flags: [] };
  }
}

describe('지식베이스 자동 크롤링/동기화(No.43) R1 리뷰 H-2 — 추출 실패 격리', () => {
  let app: NestExpressApplication;
  let baseUrl: string;
  let tmpDir: string;
  let prisma: PrismaService;
  let mockSite: { url: string; close: () => Promise<void> };
  let adminCookie = '';
  let fakeExtractor: MarkerBasedFakeExtractor;
  let kbSyncJob: { tick: () => Promise<void> };

  async function admin<T = unknown>(method: string, path: string, body?: unknown): Promise<ApiResponse<T>> {
    return jsonRequest(method, `${baseUrl}${path}`, body, { Cookie: adminCookie });
  }

  /**
   * 조건이 충족될 때까지 tick을 돈다. 반복 **횟수**가 아니라 벽시계 마감(기본 15초 — 시험 제한 20초 안)으로 끝낸다 — 부하로 tick 하나가
   * 느려지면 같은 횟수가 훨씬 짧은 시간이 되어(호스트 간격 500ms는 시간 기준이다) 조건 충족 전에 횟수가 먼저 바닥나 간헐 실패했다.
   */
  async function tickUntil(predicate: () => Promise<boolean>, timeoutMs = 15_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await kbSyncJob.tick();
      if (await predicate()) return;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error('tickUntil: 조건이 충족되지 않았습니다(타임아웃)');
  }

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'chatbot-kb-extraction-failure-test-'));
    const dbPath = join(tmpDir, 'test.db').replace(/\\/g, '/');
    const testDatabaseUrl = `file:${dbPath}`;

    mockSite = await startMockSiteServer();

    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.DEPLOY_SCHEDULE_ENABLED = 'false';
    process.env.WIDGET_BASE_URL = process.env.WIDGET_BASE_URL ?? 'http://localhost:5174';
    process.env.PUBLIC_API_BASE_URL = process.env.PUBLIC_API_BASE_URL ?? 'http://localhost:3000/api/v1';
    delete process.env.EMBEDDING_BASE_URL;
    process.env.KB_SYNC_ENABLED = 'true';
    process.env.KB_SYNC_MAX_PARALLEL_SOURCES = '4';

    try {
      execSync('pnpm exec prisma migrate deploy', { cwd: API_ROOT, env: { ...process.env, DATABASE_URL: testDatabaseUrl }, stdio: 'pipe' });
    } catch (e) {
      const err = e as { stdout?: Buffer; stderr?: Buffer };
      throw new Error(`prisma migrate deploy 실패:\n${err.stdout?.toString()}\n${err.stderr?.toString()}`);
    }

    fakeExtractor = new MarkerBasedFakeExtractor();
    const { AppModule } = (await import('../app.module')) as { AppModule: typeof AppModuleType };
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(KB_DNS_RESOLVER)
      .useValue(makeFakeDnsResolver())
      .overrideProvider(KB_TRANSPORT)
      .useValue(makeFakeTransport(() => mockSite.url))
      .overrideProvider(KB_EXTRACTOR)
      .useValue(fakeExtractor)
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

  /**
   * `host`를 다르게 주면 호스트 페이서(호스트당 동시 1 · 간격 500ms)를 공유하지 않는다. 같은 tick에서 두 실행이 한 호스트를 두고 겨루면
   * 실행 순서상 앞선 실행이 매번 페이서를 먼저 잡아 뒤의 실행이 굶는다(운 나쁘면 수십 tick) — "다른 소스가 막히지 않는다"를 보는 시험은
   * 그 경쟁이 결과에 섞이지 않도록 소스마다 호스트를 나눈다.
   */
  async function createSource(seedPath: string, pathPrefix: string, name: string, host = 'intra.example.invalid'): Promise<string> {
    const res = await admin<{ id: string }>('POST', '/kb-sources', {
      name,
      seedUrls: [`https://${host}${seedPath}`],
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
      scope: { company: '예시공사', category: '테스트', subcategory: name },
      schedule: { kind: 'MANUAL' },
      auth: { kind: 'NONE' },
      piiMask: false,
      allowRawFileIngest: false,
      rightsConfirmed: true,
    });
    expect(res.status).toBe(201);
    return res.body.id;
  }

  it('★ 타임아웃(FILE_UNSAFE_TIMEOUT) — 실패한 문서만 제외되고 나머지는 정상 진행된다', async () => {
    const sourceId = await createSource('/mix/', '/mix/', `타임아웃-${Date.now()}`);
    const run = await admin<{ runId: string }>('POST', `/kb-sources/${sourceId}/runs`, { kind: 'PREVIEW' });
    expect(run.status).toBe(202);

    await tickUntil(async () => {
      const r = await admin<{ status: string }>('GET', `/kb-sources/${sourceId}/runs/${run.body.runId}`);
      return r.body.status === 'SUCCEEDED' || r.body.status === 'FAILED';
    });
    const runDetail = await admin<{ status: string }>('GET', `/kb-sources/${sourceId}/runs/${run.body.runId}`);
    expect(runDetail.body.status).toBe('SUCCEEDED'); // 실행 자체는 실패한 문서 하나 때문에 죽지 않는다.

    const docs = await prisma.kbDocument.findMany({ where: { sourceId } });
    const timeoutDoc = docs.find((d) => d.url.endsWith('/timeout-child'));
    const normalDoc = docs.find((d) => d.url.endsWith('/normal-child'));
    expect(timeoutDoc?.state).toBe('EXCLUDED');
    expect(timeoutDoc?.excludeReason).toBe('FILE_UNSAFE');
    expect(timeoutDoc?.visitState).toBe('VISITED'); // 방문 처리는 됐다(무한 재시도 아님).
    expect(normalDoc?.state).toBe('ACTIVE'); // 다른 문서는 정상 진행됐다.
    expect(normalDoc?.observedChange).toBe('NEW');
  }, 20_000);

  it('★ 크래시(WORKER_CRASHED) — 실패한 문서만 제외되고 나머지는 정상 진행된다', async () => {
    const sourceId = await createSource('/mix2/', '/mix2/', `크래시-${Date.now()}`);
    const run = await admin<{ runId: string }>('POST', `/kb-sources/${sourceId}/runs`, { kind: 'PREVIEW' });
    expect(run.status).toBe(202);

    await tickUntil(async () => {
      const r = await admin<{ status: string }>('GET', `/kb-sources/${sourceId}/runs/${run.body.runId}`);
      return r.body.status === 'SUCCEEDED' || r.body.status === 'FAILED';
    });
    const runDetail = await admin<{ status: string }>('GET', `/kb-sources/${sourceId}/runs/${run.body.runId}`);
    expect(runDetail.body.status).toBe('SUCCEEDED');

    const docs = await prisma.kbDocument.findMany({ where: { sourceId } });
    const crashDoc = docs.find((d) => d.url.endsWith('/crash-child'));
    const normalDoc = docs.find((d) => d.url.endsWith('/normal-child2'));
    expect(crashDoc?.state).toBe('EXCLUDED');
    expect(crashDoc?.excludeReason).toBe('FILE_UNSAFE');
    expect(normalDoc?.state).toBe('ACTIVE');
  }, 20_000);

  it('★ 워커 진입점 부재(WorkerEntryMissingError) — 전역 설정 오류라 문서를 제외하지 않고, 다른 소스는 같은 tick에 그대로 진행된다', async () => {
    const missingEntrySourceId = await createSource('/missing-entry/', '/missing-entry/', `전역오류-${Date.now()}`, 'intra-a.example.invalid');
    const happySourceId = await createSource('/happy/', '/happy/', `정상격리-${Date.now()}`, 'intra-b.example.invalid');

    const runA = await admin<{ runId: string }>('POST', `/kb-sources/${missingEntrySourceId}/runs`, { kind: 'PREVIEW' });
    const runB = await admin<{ runId: string }>('POST', `/kb-sources/${happySourceId}/runs`, { kind: 'PREVIEW' });
    expect(runA.status).toBe(202);
    expect(runB.status).toBe(202);

    // 같은 tick(들) 안에서 두 실행이 함께 처리된다 — happy 쪽이 먼저 끝나길 기다린다.
    await tickUntil(async () => {
      const r = await admin<{ status: string }>('GET', `/kb-sources/${happySourceId}/runs/${runB.body.runId}`);
      return r.body.status === 'SUCCEEDED' || r.body.status === 'FAILED';
    });
    const happyDetail = await admin<{ status: string }>('GET', `/kb-sources/${happySourceId}/runs/${runB.body.runId}`);
    expect(happyDetail.body.status).toBe('SUCCEEDED'); // 다른 소스의 전역 오류가 이 실행을 막지 못했다.

    // 전역 오류 쪽 실행은 끝나지 못하고 여전히 진행 중(CRAWLING)이다 — "문서를 제외해서 억지로 끝냈다"가 아니다.
    const missingDetail = await admin<{ status: string }>('GET', `/kb-sources/${missingEntrySourceId}/runs/${runA.body.runId}`);
    expect(missingDetail.body.status).toBe('CRAWLING');

    const docs = await prisma.kbDocument.findMany({ where: { sourceId: missingEntrySourceId } });
    const page = docs.find((d) => d.url.endsWith('/missing-entry/'));
    // 문서가 "안전하지 않음"으로 위장되지 않았다 — 여전히 QUEUED(재시도 대상)다.
    expect(page?.state).not.toBe('EXCLUDED');
    expect(page?.visitState).toBe('QUEUED');

    // 정리 — 다음 시험(없음)에 영향 없도록 계속 CRAWLING으로 두어도 무방하지만, 명시적으로 취소해 둔다.
    await admin('POST', `/kb-sources/${missingEntrySourceId}/runs/${runA.body.runId}/cancel`, {});
  }, 20_000);
});

/* ════════════════════════════════════════════════════════════════════════════════════════════
 * R2 리뷰 신규 Medium — 적재(ingest) 단계 추출 실패 시나리오. `submitJob()`의 추출 호출은 크롤 시점과
 * 별도로(재요청 본문에 대해) 다시 일어난다 — 그래서 "크롤은 성공(문서가 적재 대상으로 등록됨) →
 * 적재 시점 재추출만 실패"를 재현하려면, 같은 본문의 **두 번째** 추출 호출부터만 실패하게 만드는
 * 가짜 추출기가 필요하다(문서 표식만으로는 크롤 시점에 이미 걸려 적재 대상 자체가 안 만들어진다).
 * 이 describe는 독립된 앱 인스턴스를 쓴다(위 describe의 공유 가짜 추출기 상태와 섞이지 않기 위해).
 * ════════════════════════════════════════════════════════════════════════════════════════════ */

type IngestFailureMode = 'NONE' | 'TIMEOUT' | 'CRASH' | 'MISSING_ENTRY';

/** 크롤 시점(같은 본문의 첫 호출)은 항상 성공시켜 문서를 적재 대상으로 등록한다 — 적재 시점(그 본문의
 * 두 번째 이후 호출)에서만 `failMode`에 따라 실패를 재현한다. */
class IngestPhaseFakeExtractor implements KbExtractorPort {
  failMode: IngestFailureMode = 'NONE';
  /** 같은 본문의 추출 호출 횟수 — 1회차(미리보기 크롤)·2회차(승인 후 SYNC 실행 자신의 재크롤)는
   * 적재 대상 자체가 만들어져야 하므로 항상 성공시킨다. 3회차(적재 시점 재요청)부터만 `failMode`를
   * 적용한다 — 되돌아간 뒤 재시도해도(4·5·6회차…) 계속 실패하다가 `failMode='NONE'`으로 바뀌면
   * 그다음 호출부터 바로 성공한다. */
  private readonly seenCounts = new Map<string, number>();

  async extract(req: KbExtractRequest): Promise<KbExtractResult> {
    if (req.kind !== 'HTML') return { ok: true, normalizedText: '', text: '', piiMaskedCount: 0, flags: [] };

    const count = (this.seenCounts.get(req.html) ?? 0) + 1;
    this.seenCounts.set(req.html, count);
    if (count <= 2) return this.okResult(req.html);

    switch (this.failMode) {
      case 'TIMEOUT':
        throw new Error('FILE_UNSAFE_TIMEOUT');
      case 'CRASH':
        throw new Error('WORKER_CRASHED: JS heap out of memory');
      case 'MISSING_ENTRY':
        throw new WorkerEntryMissingError('extract.worker.js 빌드 산출물이 없습니다(시험용).');
      default:
        return this.okResult(req.html);
    }
  }

  private okResult(html: string): KbExtractResult {
    const title = /<h1>(.*?)<\/h1>/.exec(html)?.[1] ?? null;
    const links = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    return { ok: true, normalizedText: html, text: html, piiMaskedCount: 0, title, links, noindex: false, nofollow: false, flags: [] };
  }
}

function startIngestPhaseMockSiteServer(): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const parsed = new URL(req.url ?? '/', 'http://ingest-phase.example.invalid');
      if (parsed.pathname === '/robots.txt') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('User-agent: *\nAllow: /\n');
        return;
      }
      if (parsed.pathname.startsWith('/doc-')) {
        // 시험마다 다른 경로를 써서 본문을 고유하게 만든다 — 가짜 추출기가 "본문별 호출 횟수"로
        // 크롤 시점(1·2회차)과 적재 시점(3회차 이후)을 구분하는데, 여러 시험이 완전히 같은 본문을
        // 쓰면 그 카운터가 시험 경계를 넘어 섞인다.
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<html><body><main><h1>적재 단계 시험 문서 ${parsed.pathname}</h1><p>본문입니다.</p></main></body></html>`);
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

/** 동기 성공 문자열로 즉시 응답하는 로컬 목 "외부 RAG"(비동기 폴링 없이 흐름 검증에 집중). */
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

describe('지식베이스 자동 크롤링/동기화(No.43) R2 리뷰 신규 Medium — 적재 단계 추출 실패', () => {
  let app: NestExpressApplication;
  let baseUrl: string;
  let tmpDir: string;
  let prisma: PrismaService;
  let mockSite: { url: string; close: () => Promise<void> };
  let mockRag: { url: string; close: () => Promise<void> };
  let adminCookie = '';
  let fakeExtractor: IngestPhaseFakeExtractor;
  let kbSyncJob: { tick: () => Promise<void> };

  async function admin<T = unknown>(method: string, path: string, body?: unknown): Promise<ApiResponse<T>> {
    return jsonRequest(method, `${baseUrl}${path}`, body, { Cookie: adminCookie });
  }

  /**
   * 조건이 충족될 때까지 tick을 돈다. 반복 **횟수**가 아니라 벽시계 마감(기본 15초 — 시험 제한 20초 안)으로 끝낸다 — 부하로 tick 하나가
   * 느려지면 같은 횟수가 훨씬 짧은 시간이 되어(호스트 간격 500ms는 시간 기준이다) 조건 충족 전에 횟수가 먼저 바닥나 간헐 실패했다.
   */
  async function tickUntil(predicate: () => Promise<boolean>, timeoutMs = 15_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await kbSyncJob.tick();
      if (await predicate()) return;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error('tickUntil: 조건이 충족되지 않았습니다(타임아웃)');
  }

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'chatbot-kb-ingest-extraction-failure-test-'));
    const dbPath = join(tmpDir, 'test.db').replace(/\\/g, '/');
    const testDatabaseUrl = `file:${dbPath}`;

    mockSite = await startIngestPhaseMockSiteServer();
    mockRag = await startMockRagServer();

    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.DEPLOY_SCHEDULE_ENABLED = 'false';
    process.env.WIDGET_BASE_URL = process.env.WIDGET_BASE_URL ?? 'http://localhost:5174';
    process.env.PUBLIC_API_BASE_URL = process.env.PUBLIC_API_BASE_URL ?? 'http://localhost:3000/api/v1';
    delete process.env.EMBEDDING_BASE_URL;
    process.env.KB_SYNC_ENABLED = 'true';
    process.env.KB_INGEST_TRANSPORT_ACK = 'INTERNAL_NETWORK';
    process.env.RAG_BASE_URL = mockRag.url;
    process.env.KB_INGEST_CONCURRENCY = '1';
    process.env.KB_SYNC_LEASE_MS = '600000';

    try {
      execSync('pnpm exec prisma migrate deploy', { cwd: API_ROOT, env: { ...process.env, DATABASE_URL: testDatabaseUrl }, stdio: 'pipe' });
    } catch (e) {
      const err = e as { stdout?: Buffer; stderr?: Buffer };
      throw new Error(`prisma migrate deploy 실패:\n${err.stdout?.toString()}\n${err.stderr?.toString()}`);
    }

    fakeExtractor = new IngestPhaseFakeExtractor();
    const { AppModule } = (await import('../app.module')) as { AppModule: typeof AppModuleType };
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(KB_DNS_RESOLVER)
      .useValue(makeFakeDnsResolver())
      .overrideProvider(KB_TRANSPORT)
      .useValue(makeFakeTransport(() => mockSite.url))
      .overrideProvider(KB_EXTRACTOR)
      .useValue(fakeExtractor)
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

  async function createApprovedSource(name: string, docSlug: string): Promise<{ sourceId: string; runId: string }> {
    const docPath = `/doc-${docSlug}/`;
    const created = await admin<{ id: string }>('POST', '/kb-sources', {
      name,
      seedUrls: [`https://ingest-phase.example.invalid${docPath}`],
      sitemapUrls: [],
      pathPrefixes: [docPath],
      excludePatterns: [],
      noisePatterns: [],
      allowQueryUrls: false,
      maxDepth: 0,
      maxPages: 10,
      fileTypes: [],
      maxFileBytes: 20971520,
      minIntervalMs: 500,
      scope: { company: '예시공사', category: '테스트', subcategory: name },
      schedule: { kind: 'MANUAL' },
      auth: { kind: 'NONE' },
      piiMask: false,
      allowRawFileIngest: false,
      rightsConfirmed: true,
    });
    expect(created.status).toBe(201);
    const sourceId = created.body.id;

    const preview = await admin<{ runId: string }>('POST', `/kb-sources/${sourceId}/runs`, { kind: 'PREVIEW' });
    expect(preview.status).toBe(202);
    await tickUntil(async () => {
      const r = await admin<{ status: string }>('GET', `/kb-sources/${sourceId}/runs/${preview.body.runId}`);
      return r.body.status === 'SUCCEEDED' || r.body.status === 'FAILED';
    });
    const previewDetail = await admin<{ status: string }>('GET', `/kb-sources/${sourceId}/runs/${preview.body.runId}`);
    expect(previewDetail.body.status).toBe('SUCCEEDED'); // 크롤 시점 추출(첫 호출)은 항상 성공한다.

    const approve = await admin<{ runId: string }>('POST', `/kb-sources/${sourceId}/approve-ingest`, { previewRunId: preview.body.runId });
    expect(approve.status).toBe(202);
    return { sourceId, runId: approve.body.runId };
  }

  it('★ 적재 단계 타임아웃(FILE_UNSAFE_TIMEOUT) — 작업이 EXCLUDED_AT_INGEST로 종결된다', async () => {
    fakeExtractor.failMode = 'TIMEOUT';
    const { sourceId, runId } = await createApprovedSource(`적재타임아웃-${Date.now()}`, 'timeout');

    await tickUntil(async () => {
      const r = await admin<{ status: string }>('GET', `/kb-sources/${sourceId}/runs/${runId}`);
      return r.body.status === 'SUCCEEDED' || r.body.status === 'PARTIAL' || r.body.status === 'FAILED';
    });
    const runDetail = await admin<{ status: string }>('GET', `/kb-sources/${sourceId}/runs/${runId}`);
    expect(runDetail.body.status).toBe('SUCCEEDED'); // 작업 하나의 추출 실패가 실행 전체를 실패로 만들지 않는다.

    const job = await prisma.kbIngestJob.findFirst({ where: { runId } });
    expect(job?.status).toBe('SKIPPED');
    expect(job?.resultCode).toBe('EXCLUDED_AT_INGEST');
  }, 20_000);

  it('★ 적재 단계 크래시(WORKER_CRASHED) — 작업이 EXCLUDED_AT_INGEST로 종결된다', async () => {
    fakeExtractor.failMode = 'CRASH';
    const { sourceId, runId } = await createApprovedSource(`적재크래시-${Date.now()}`, 'crash');

    await tickUntil(async () => {
      const r = await admin<{ status: string }>('GET', `/kb-sources/${sourceId}/runs/${runId}`);
      return r.body.status === 'SUCCEEDED' || r.body.status === 'PARTIAL' || r.body.status === 'FAILED';
    });
    const runDetail = await admin<{ status: string }>('GET', `/kb-sources/${sourceId}/runs/${runId}`);
    expect(runDetail.body.status).toBe('SUCCEEDED');

    const job = await prisma.kbIngestJob.findFirst({ where: { runId } });
    expect(job?.status).toBe('SKIPPED');
    expect(job?.resultCode).toBe('EXCLUDED_AT_INGEST');
  }, 20_000);

  it('★ 적재 단계 워커 진입점 부재 — 작업이 PENDING으로 복귀하고(attempt 소모 없음), 엔트리를 복구하면 적재가 완료된다', async () => {
    fakeExtractor.failMode = 'MISSING_ENTRY';
    const { sourceId, runId } = await createApprovedSource(`적재엔트리부재-${Date.now()}`, 'missing-entry');

    // 크롤이 끝나 적재 작업이 만들어질 때까지 먼저 기다린다(그 뒤부터 워커 진입점 부재로 계속 실패한다).
    await tickUntil(async () => (await prisma.kbIngestJob.count({ where: { runId } })) > 0);

    // 진입점 부재 상태로 여러 tick을 더 돌려도(재시도가 반복돼도) 작업은 PENDING으로만 되돌아갈 뿐
    // SUBMITTING에 갇히지 않고, 실행은 여전히 INGESTING(끝나지 못함)이다.
    for (let i = 0; i < 5; i += 1) await kbSyncJob.tick();

    const stuckJob = await prisma.kbIngestJob.findFirst({ where: { runId } });
    expect(stuckJob?.status).toBe('PENDING');
    expect(stuckJob?.slotToken).toBeNull();
    // 클레임(+1)과 되돌리기(-1)가 매 시도마다 짝을 이뤄 순증되지 않는다 — 여러 번 되돌아왔어도 0이다.
    expect(stuckJob?.attemptCount).toBe(0);
    const attemptAfterStuck = stuckJob!.attemptCount;

    const runDetail = await admin<{ status: string }>('GET', `/kb-sources/${sourceId}/runs/${runId}`);
    expect(runDetail.body.status).toBe('INGESTING'); // 문서를 억지로 제외해 끝내지 않았다.

    // 엔트리를 "복구"한다 — 이제 적재 시점 재추출도 정상 성공한다.
    fakeExtractor.failMode = 'NONE';
    await tickUntil(async () => {
      const r = await admin<{ status: string }>('GET', `/kb-sources/${sourceId}/runs/${runId}`);
      return r.body.status === 'SUCCEEDED' || r.body.status === 'PARTIAL' || r.body.status === 'FAILED';
    });
    const finalDetail = await admin<{ status: string; ingest: { succeeded: number } | null }>('GET', `/kb-sources/${sourceId}/runs/${runId}`);
    expect(finalDetail.body.status).toBe('SUCCEEDED');
    expect(finalDetail.body.ingest?.succeeded).toBe(1);

    const finalJob = await prisma.kbIngestJob.findFirst({ where: { runId } });
    expect(finalJob?.status).toBe('SUCCEEDED');
    // attemptCount가 되돌리기 과정(여러 번 반복됐어도)에서 순증되지 않았음을(소모 없음) 최종적으로도
    // 확인한다 — 진짜 "시도"로 친 것은 엔트리 복구 이후의 성공한 제출 1회뿐이다.
    expect(finalJob!.attemptCount).toBe(attemptAfterStuck + 1);
  }, 20_000);
});
