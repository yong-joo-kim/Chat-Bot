import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import * as http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import { VersioningType } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import type { AppModule as AppModuleType } from '../app.module';
import { AllExceptionsFilter } from '../common/all-exceptions.filter';
import { PrismaService } from '../prisma/prisma.service';
import { loginAs, seedTestUsers } from './helpers/auth.helper';
import { KB_DNS_RESOLVER, KB_TRANSPORT } from '../kb-sync/crawl/kb-crawl-http.fetcher';
import { KB_EXTRACTOR } from '../kb-sync/extract/kb-extractor.port';
import { InProcessExtractor } from '../kb-sync/extract/in-process.extractor';
import type { LegacyDnsResolver, LegacyTransport, LegacyTransportRequest, LegacyTransportResult } from '../legacy-api/transport/legacy-transport.port';
import { CLOCK } from '../common/polling/clock';
import type { Clock } from '../common/polling/clock';

/**
 * 지식베이스 자동 크롤링/동기화(No.43) — 적재(ingest) 결과 판정 경로 통합 시험.
 *
 * `kb-crawling-설계.md` §17.1 "필수 10종" 중 리뷰에서 확인 안 된 공백을 메운다:
 * ★ AC-KB4-2(completed + "실패." → FAILED, 성공 오판 0) · ★ AC-KB4-3(not_found → 1회 재전송 →
 * 두 번째도 not_found면 FAILED) · AC-KB4-4(vLLM 미연결 → 적재 요청 0) · ★ AC-KB4-5(429 3회 백오프 후
 * FAILED · 400은 재시도 0) · ★ AC-KB6-1(PII 마스킹 — 적재 파일(DOCX)을 실제로 풀어 확인).
 *
 * pass 4 보강: ★ AC-KB4-1(직렬 — 슬롯은 완료까지 유지, 인스턴스 2개 시뮬레이션) · 작업 조회 5xx = 재조회(재전송 아님) ·
 * 작업 조회 429 = 상태 불변 + 조회 미룸 · BULK 시간창 · 크롤 카운터 · `configVersion` 실제 변경 판정.
 *
 * `CLOCK` 포트를 `FakeClock`으로 오버라이드해 1분·5분·30분 백오프를 실제로 기다리지 않고
 * 상대 시각 이동만으로 재현한다(scheduled-deploy 통합 시험과 동일한 기법 — CLAUDE.md 상대 시각 규약).
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

class FakeClock implements Clock {
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

/* ------------------------------------------------------------------------------------------
 * 로컬 목 "사내 사이트" — 경로마다 고정 HTML 1장(링크 없음 — 소스당 문서 1개로 단순화).
 * ------------------------------------------------------------------------------------------ */
/** `/flaky/*` 경로는 처음 `flakyOkHits`번만 200이고 그 뒤로는 503 — 크롤(미리보기·승인 재크롤)은 통과시키고 적재 때 재수집만 실패시킨다. */
const flakyState = { hits: 0, okHits: 2 };

function startMockSiteServer(): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const parsed = new URL(req.url ?? '/', 'http://intra.example.invalid');
      if (parsed.pathname.startsWith('/flaky/')) {
        flakyState.hits += 1;
        if (flakyState.hits > flakyState.okHits) {
          res.writeHead(503, { 'Content-Type': 'text/plain' });
          res.end('busy');
          return;
        }
      }
      if (parsed.pathname === '/robots.txt') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('User-agent: *\nAllow: /\n');
        return;
      }
      if (parsed.pathname === '/pii/contact') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><head><title>연락처 안내</title></head><body><main><p>담당자 연락처: 010-1234-5678 입니다.</p><p>' + FILLER + '</p></main></body></html>');
        return;
      }
      // 직렬 시험용 — 색인 1장이 자식 2장을 가리킨다(소스 1개 = 문서 3개).
      if (parsed.pathname === '/multi/index') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><head><title>색인</title></head><body><main><p>색인 본문</p><a href="/multi/a">A</a><a href="/multi/b">B</a><a href="https://other.example.invalid/x">밖</a><p>' + FILLER + '</p></main></body></html>');
        return;
      }
      // 그 밖의 모든 경로 — 일반 페이지(내용은 경로마다 달라 소스별 해시가 겹치지 않는다).
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<html><head><title>일반 페이지 ${parsed.pathname}</title></head><body><main><p>본문 ${parsed.pathname}</p><p>${FILLER}</p></main></body></html>`);
    });
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      resolve({ url: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(() => r())) });
    });
  });
}

/* ------------------------------------------------------------------------------------------
 * 로컬 목 "외부 RAG" — 호출마다 큐에서 다음 행동을 꺼내 응답한다(behaviors 큐가 비면 기본 성공).
 * ------------------------------------------------------------------------------------------ */
type IngestBehavior = 'ACCEPT' | 'SUCCESS' | 'HTTP_400' | 'HTTP_429';
type TaskStatusBehavior = 'RUNNING' | 'COMPLETED_SUCCESS' | 'COMPLETED_FAILURE' | 'NOT_FOUND' | 'HTTP_500' | 'HTTP_429';

interface CapturedIngest {
  fileName: string;
  fileBytes: Buffer;
  company: string;
  category: string;
  subcategory: string;
}

interface RagState {
  vllmStatus: 'connected' | 'degraded';
  ingestQueue: IngestBehavior[];
  taskStatusQueue: TaskStatusBehavior[];
  ingestCalls: number;
  statusCalls: number;
  taskStatusCalls: number;
  lastIngest: CapturedIngest | null;
  /** 접수(ACCEPT)됐지만 아직 완료·소실로 끝나지 않은 외부 작업 수와 그 최댓값 — AC-KB4-1(동시 진행 1건) 판정용. */
  inFlight: number;
  maxInFlight: number;
  /** 접수 순서대로 받은 파일 이름 — 직렬 처리 순서 확인용. */
  acceptedFileNames: string[];
}

function makeRagState(): RagState {
  return { vllmStatus: 'connected', ingestQueue: [], taskStatusQueue: [], ingestCalls: 0, statusCalls: 0, taskStatusCalls: 0, lastIngest: null, inFlight: 0, maxInFlight: 0, acceptedFileNames: [] };
}

/** `multipart/form-data` 본문을 최소 파싱한다(fetch의 FormData가 만든 표준 형태 전용 — 시험 전용 헬퍼). */
function parseMultipart(buffer: Buffer, contentType: string): Record<string, { filename?: string; data: Buffer }> {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  const boundary = match ? match[1] ?? match[2] : '';
  const boundaryBuf = Buffer.from(`--${boundary}`);
  const parts: Record<string, { filename?: string; data: Buffer }> = {};
  let start = buffer.indexOf(boundaryBuf);
  while (start !== -1) {
    const afterBoundary = start + boundaryBuf.length;
    if (buffer.slice(afterBoundary, afterBoundary + 2).toString() === '--') break;
    const nextStart = buffer.indexOf(boundaryBuf, afterBoundary);
    if (nextStart === -1) break;
    const partBuf = buffer.slice(afterBoundary + 2, nextStart - 2);
    const headerEnd = partBuf.indexOf('\r\n\r\n');
    if (headerEnd === -1) {
      start = nextStart;
      continue;
    }
    const headerText = partBuf.slice(0, headerEnd).toString('utf8');
    const body = partBuf.slice(headerEnd + 4);
    const nameMatch = /name="([^"]+)"/.exec(headerText);
    const filenameMatch = /filename="([^"]+)"/.exec(headerText);
    if (nameMatch) parts[nameMatch[1]] = { filename: filenameMatch?.[1], data: body };
    start = nextStart;
  }
  return parts;
}

function startMockRagServer(state: RagState): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const parsed = new URL(req.url ?? '/', 'http://rag.local');

      if (parsed.pathname === '/api/status') {
        state.statusCalls += 1;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        // `API_RAG.md` §0-5 응답 모양 그대로 — 준비 여부는 최상위 `vllm_ready`다(`services.vllm.status`는 보조).
        const connected = state.vllmStatus === 'connected';
        res.end(
          JSON.stringify({
            status: connected ? 'healthy' : 'degraded',
            vllm_ready: connected,
            uptime: 100,
            services: { vllm: connected ? { status: 'connected', model: 'm' } : { status: 'disconnected', error: 'Connection refused' }, neo4j: { status: 'connected' } },
          }),
        );
        return;
      }

      if (parsed.pathname === '/api/documents/ingest' && req.method === 'POST') {
        let raw = Buffer.alloc(0);
        req.on('data', (c) => (raw = Buffer.concat([raw, c])));
        req.on('end', () => {
          state.ingestCalls += 1;
          const contentType = req.headers['content-type'] ?? '';
          const parts = parseMultipart(raw, contentType);
          if (parts.file) {
            state.lastIngest = {
              fileName: parts.file.filename ?? '',
              fileBytes: parts.file.data,
              company: parts.company?.data.toString('utf8') ?? '',
              category: parts.category?.data.toString('utf8') ?? '',
              subcategory: parts.subcategory?.data.toString('utf8') ?? '',
            };
          }
          const behavior = state.ingestQueue.shift() ?? 'SUCCESS';
          if (behavior === 'ACCEPT') {
            state.inFlight += 1;
            state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
            state.acceptedFileNames.push(parts.file?.filename ?? '');
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'async_started', task_id: '11111111-1111-4111-8111-111111111111' }));
            return;
          }
          if (behavior === 'HTTP_400') {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ detail: 'company/category/subcategory required' }));
            return;
          }
          if (behavior === 'HTTP_429') {
            res.writeHead(429, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ detail: 'rate limited' }));
            return;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ result: 'RAG Vector DB 추가 성공.' }));
        });
        return;
      }

      if (parsed.pathname.startsWith('/api/async_task_status/') && req.method === 'GET') {
        state.taskStatusCalls += 1;
        const behavior = state.taskStatusQueue.shift() ?? 'RUNNING';
        if (behavior === 'RUNNING') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ task_info: { status: 'running' } }));
          return;
        }
        if (behavior === 'HTTP_500') {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: '내부 오류' }));
          return;
        }
        if (behavior === 'HTTP_429') {
          res.writeHead(429, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ detail: 'rate limited' }));
          return;
        }
        // 이하는 외부 작업이 끝나는 응답 — 진행 중 작업 수에서 뺀다(재시작으로 사라진 `not_found`도 끝난 것이다).
        state.inFlight = Math.max(0, state.inFlight - 1);
        if (behavior === 'NOT_FOUND') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ task_info: { status: 'not_found' } }));
          return;
        }
        if (behavior === 'COMPLETED_FAILURE') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ task_info: { status: 'completed', result: 'RAG Vector DB 추가 실패.' } }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ task_info: { status: 'completed', result: 'RAG Vector DB 추가 성공.' } }));
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

describe('지식베이스 자동 크롤링/동기화(No.43) — 적재 결과 판정(AC-KB4-2·3·4·5 · AC-KB6-1)', () => {
  let app: NestExpressApplication;
  let baseUrl: string;
  let tmpDir: string;
  let prisma: PrismaService;
  let mockSite: { url: string; close: () => Promise<void> };
  let mockRag: { url: string; close: () => Promise<void> };
  let ragState: RagState;
  let clock: FakeClock;
  let moduleRefForTest: TestingModule;

  let adminCookie = '';
  let kbSyncJob: { tick: () => Promise<void> };

  async function admin<T = unknown>(method: string, path: string, body?: unknown): Promise<ApiResponse<T>> {
    return jsonRequest(method, `${baseUrl}${path}`, body, { Cookie: adminCookie });
  }

  /** 조건이 될 때까지 tick()을 반복한다 — 실시간 대기가 필요하면(백오프 등) 호출부가 먼저 clock.advance()한다. */
  async function tickUntil(predicate: () => Promise<boolean>, maxIterations = 40): Promise<void> {
    for (let i = 0; i < maxIterations; i += 1) {
      await kbSyncJob.tick();
      if (await predicate()) return;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error('tickUntil: 조건이 충족되지 않았습니다(타임아웃)');
  }

  /**
   * 소스 등록 → 미리보기 → 승인까지 진행하고, 승인 실행(SYNC)의 적재 작업이 `expectedJobs`개 만들어질 때까지 tick한다.
   *
   * ★ 주의: 크롤이 끝나는 tick은 같은 tick 안에서 적재 첫 제출까지 한다 — 그래서 **외부 RAG 목의 응답 큐
   * (`ingestQueue`·`taskStatusQueue`)는 이 함수를 부르기 _전에_ 채워야 한다**(부른 뒤에 채우면 이미 기본 응답으로
   * 제출·완료된 뒤다).
   */
  async function registerApprovedSource(
    name: string,
    seedPath: string,
    opts: { expectedJobs?: number; pathPrefix?: string; maxDepth?: number } = {},
  ): Promise<{ sourceId: string; documentId: string; syncRunId: string }> {
    const expectedJobs = opts.expectedJobs ?? 1;
    const created = await admin<{ id: string }>('POST', '/kb-sources', {
      name: `${name}-${Date.now()}`,
      seedUrls: [`https://intra.example.invalid${seedPath}`],
      sitemapUrls: [],
      pathPrefixes: [opts.pathPrefix ?? seedPath],
      excludePatterns: [],
      noisePatterns: [],
      allowQueryUrls: false,
      maxDepth: opts.maxDepth ?? 1,
      maxPages: 10,
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

    const preview = await admin<{ runId: string }>('POST', `/kb-sources/${sourceId}/runs`, { kind: 'PREVIEW' });
    expect(preview.status).toBe(202);
    const previewRunId = preview.body.runId;
    await tickUntil(async () => {
      const r = await admin<{ status: string }>('GET', `/kb-sources/${sourceId}/runs/${previewRunId}`);
      return r.body.status === 'SUCCEEDED' || r.body.status === 'FAILED';
    });

    const approve = await admin<{ runId: string }>('POST', `/kb-sources/${sourceId}/approve-ingest`, { previewRunId });
    expect(approve.status).toBe(202);
    const syncRunId = approve.body.runId;

    // 적재 작업(job)이 만들어질 때까지 — 크롤 완료 후 일괄 생성(R-9)이라 크롤 조각이 먼저 끝나야 한다.
    let documentId = '';
    await tickUntil(async () => {
      const docs = await admin<{ items: Array<{ id: string }> }>('GET', `/kb-sources/${sourceId}/documents`);
      if (docs.body.items.length > 0) {
        documentId = docs.body.items[0].id;
        return (await prisma.kbIngestJob.count({ where: { runId: syncRunId } })) >= expectedJobs;
      }
      return false;
    }, expectedJobs > 1 ? 120 : 40);

    return { sourceId, documentId, syncRunId };
  }

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'chatbot-kb-ingest-outcomes-test-'));
    const dbPath = join(tmpDir, 'test.db').replace(/\\/g, '/');
    const testDatabaseUrl = `file:${dbPath}`;

    mockSite = await startMockSiteServer();
    ragState = makeRagState();
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
    process.env.KB_INGEST_POLL_MS = '10000';

    try {
      execSync('pnpm exec prisma migrate deploy', { cwd: API_ROOT, env: { ...process.env, DATABASE_URL: testDatabaseUrl }, stdio: 'pipe' });
    } catch (e) {
      const err = e as { stdout?: Buffer; stderr?: Buffer };
      throw new Error(`prisma migrate deploy 실패:\n${err.stdout?.toString()}\n${err.stderr?.toString()}`);
    }

    const { AppModule } = (await import('../app.module')) as { AppModule: typeof AppModuleType };
    clock = new FakeClock(new Date());
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(KB_DNS_RESOLVER)
      .useValue(makeFakeDnsResolver())
      .overrideProvider(KB_TRANSPORT)
      .useValue(makeFakeTransport(() => mockSite.url))
      .overrideProvider(KB_EXTRACTOR)
      .useClass(InProcessExtractor)
      .overrideProvider(CLOCK)
      .useValue(clock)
      .compile();

    moduleRefForTest = moduleRef;
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

  beforeEach(() => {
    ragState.ingestQueue = [];
    ragState.taskStatusQueue = [];
    ragState.vllmStatus = 'connected';
  });

  const jobOf = (documentId: string) => prisma.kbIngestJob.findFirst({ where: { documentId } });

  it('★ AC-KB6-1: HTML 속 휴대전화 번호가 마스킹되어 DOCX 본문에 실린다(원문 0)', async () => {
    ragState.ingestQueue = ['SUCCESS'];
    const { documentId } = await registerApprovedSource('pii', '/pii/contact');

    await tickUntil(async () => {
      const job = await prisma.kbIngestJob.findFirst({ where: { documentId } });
      return job?.status === 'SUCCEEDED';
    });

    expect(ragState.lastIngest).not.toBeNull();
    const captured = ragState.lastIngest!;
    expect(captured.fileName).toMatch(/^kb_[0-9a-f]{8}_[0-9a-f]{16}\.docx$/);
    const entries = unzipSync(captured.fileBytes);
    const documentXml = strFromU8(entries['word/document.xml']);
    expect(documentXml).not.toContain('010-1234-5678'); // 원문이 그대로 실리면 안 된다.
    expect(documentXml).toContain('010-****-5678'); // 부분 마스킹 형식(FR-11-23).

    const docs = await admin<{ items: Array<{ id: string; observedPiiMasked: number | null }> }>('GET', `/kb-sources`);
    void docs; // (문서 목록 API는 소스별 조회이므로 아래에서 다시 조회)
    const detail = await prisma.kbDocument.findUnique({ where: { id: documentId } });
    expect(detail?.observedPiiMasked ?? 0).toBeGreaterThanOrEqual(1);
  }, 20_000);

  it('★ AC-KB4-2: 작업 조회가 completed + "실패."를 반복하면(재시도 소진) FAILED다(성공 오판 0)', async () => {
    // 4회 시도(1·5·30분 백오프 뒤 소진) — 매번 접수(ACCEPT) 후 폴링에서 "완료 + 실패."를 받는다.
    ragState.ingestQueue.push('ACCEPT');
    ragState.taskStatusQueue.push('COMPLETED_FAILURE');
    const { documentId, sourceId, syncRunId } = await registerApprovedSource('completed-failure', '/general/a');

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      expect((await jobOf(documentId))?.status).toBe('SUBMITTED'); // 이번 시도는 접수돼 조회 대기 중.
      clock.advance(11_000); // KB_INGEST_POLL_MS(10000ms) 경과 — 조회가 즉시 걸리게.
      await tickUntil(async () => {
        const job = await jobOf(documentId);
        return job?.status === 'PENDING' || job?.status === 'FAILED';
      });
      const job = await jobOf(documentId);
      if (job?.status === 'FAILED') break;
      expect(job?.status).toBe('PENDING'); // 성공으로 오판하지 않고 백오프 재시도로 돌아간다.
      expect(job?.resultCode).toBe('RAG_REPORTED_FAILURE');
      ragState.ingestQueue.push('ACCEPT');
      ragState.taskStatusQueue.push('COMPLETED_FAILURE');
      clock.advance(31 * 60_000); // 가장 긴 백오프(30분)보다 넉넉히 이동 — 다음 시도가 바로 되도록.
      await tickUntil(async () => (await jobOf(documentId))?.status === 'SUBMITTED');
    }

    const finalJob = await jobOf(documentId);
    expect(finalJob?.status).toBe('FAILED');
    expect(finalJob?.resultCode).toBe('RAG_REPORTED_FAILURE');
    expect(finalJob?.attemptCount).toBe(4);
    expect(ragState.ingestCalls).toBeGreaterThanOrEqual(4);

    await tickUntil(async () => {
      const run = await admin<{ status: string }>('GET', `/kb-sources/${sourceId}/runs/${syncRunId}`);
      return run.body.status === 'PARTIAL' || run.body.status === 'FAILED';
    });
    // 실패한 문서는 성공 적재 실적이 없다(contentHash 미갱신 → 다음 실행이 다시 "바뀜"으로 잡는다).
    const doc = await prisma.kbDocument.findUnique({ where: { id: documentId } });
    expect(doc?.lastIngestedAt).toBeNull();
    expect(doc?.consecutiveIngestFailures).toBe(1);
  }, 40_000);

  it('★ AC-KB4-3: not_found는 1회 재전송하고, 두 번째도 not_found면 FAILED(TASK_LOST)다(결과 불명 → 재확인 후 재전송)', async () => {
    ragState.ingestQueue.push('ACCEPT', 'ACCEPT');
    ragState.taskStatusQueue.push('NOT_FOUND', 'NOT_FOUND');
    const { documentId } = await registerApprovedSource('not-found', '/general/b');
    expect((await jobOf(documentId))?.status).toBe('SUBMITTED');
    expect(ragState.ingestCalls).toBeGreaterThanOrEqual(1);
    const callsAfterFirstSubmit = ragState.ingestCalls;

    // 1회차 not_found — 실패가 아니라 재전송 대상이다. 같은 tick 안에서 바로 다시 제출되므로(백오프 없음)
    // 중간의 PENDING을 잡으려 하지 않고 "재전송 표식이 켜진 채 다시 SUBMITTED"를 기다린다.
    clock.advance(11_000);
    await tickUntil(async () => {
      const job = await jobOf(documentId);
      return job?.notFoundResubmitted === true && job.status === 'SUBMITTED';
    });
    expect(ragState.ingestCalls).toBe(callsAfterFirstSubmit + 1); // 재전송 정확히 1회.
    expect((await jobOf(documentId))?.attemptCount).toBe(2);

    // 재전송 뒤에도 not_found — 무한 반복하지 않고 TASK_LOST로 끝낸다.
    clock.advance(11_000);
    await tickUntil(async () => (await jobOf(documentId))?.status === 'FAILED');
    const finalJob = await jobOf(documentId);
    expect(finalJob?.resultCode).toBe('TASK_LOST');
    expect(ragState.ingestCalls).toBe(callsAfterFirstSubmit + 1); // 더 보내지 않았다.
  }, 30_000);

  it('AC-KB4-4: 외부 RAG의 vLLM이 연결되지 않았으면 적재 요청 자체를 보내지 않고 PENDING을 유지한다(실행 화면 "외부 RAG 준비 안 됨")', async () => {
    ragState.vllmStatus = 'degraded';
    // 직전 시험이 남긴 "준비됨" 판정은 60초 동안 캐시된다(설계 §5.8) — 캐시가 만료된 뒤의 판정을 시험한다.
    clock.advance(61_000);
    const before = ragState.ingestCalls;
    const { documentId, sourceId, syncRunId } = await registerApprovedSource('vllm-degraded', '/general/c');

    for (let i = 0; i < 5; i += 1) await kbSyncJob.tick();
    expect(ragState.ingestCalls).toBe(before); // 늘지 않았다 — 제출 시도 자체가 없었다.
    const job = await jobOf(documentId);
    expect(job?.status).toBe('PENDING');
    expect(job?.attemptCount).toBe(0); // "시도"로 치지 않는다(시도 수 미산입).

    const run = await admin<{ status: string; waitingReason: string | null }>('GET', `/kb-sources/${sourceId}/runs/${syncRunId}`);
    expect(run.body.status).toBe('INGESTING');
    expect(run.body.waitingReason).toBe('RAG_NOT_READY');
    const meta = await admin<{ ragReady: boolean | null; ragCheckedAt: string | null }>('GET', '/kb-sources/meta');
    expect(meta.body.ragReady).toBe(false);
    expect(meta.body.ragCheckedAt).not.toBeNull();

    // 회복 — 60초 캐시 만료까지 시계 이동 후 정상 처리.
    ragState.vllmStatus = 'connected';
    ragState.ingestQueue.push('SUCCESS');
    clock.advance(61_000);
    await tickUntil(async () => (await jobOf(documentId))?.status === 'SUCCEEDED');
  }, 20_000);

  it('★ AC-KB4-5: 429는 3회 백오프 뒤 FAILED, 400은 재시도 없이 즉시 FAILED다', async () => {
    // (a) 429 — 접수 단계에서 바로 거부되므로(폴링 불필요) 백오프만으로 4회 만에 소진된다.
    ragState.ingestQueue.push('HTTP_429', 'HTTP_429', 'HTTP_429', 'HTTP_429');
    const callsBefore = ragState.ingestCalls;
    const rate = await registerApprovedSource('rate-limited', '/general/d');
    for (let attempt = 1; attempt <= 6; attempt += 1) {
      const job = await jobOf(rate.documentId);
      if (job?.status === 'FAILED') break;
      expect(job?.status).toBe('PENDING'); // 백오프 대기(1분 → 5분 → 30분).
      clock.advance(31 * 60_000);
      await kbSyncJob.tick();
    }
    const rateFinal = await jobOf(rate.documentId);
    expect(rateFinal?.status).toBe('FAILED');
    expect(rateFinal?.resultCode).toBe('RATE_LIMITED');
    expect(rateFinal?.attemptCount).toBe(4); // 첫 시도 + 재시도 3회.
    expect(ragState.ingestCalls - callsBefore).toBe(4);

    // (b) 400 — 재시도 없이 첫 시도에서 바로 FAILED.
    ragState.ingestQueue.push('HTTP_400');
    const bad = await registerApprovedSource('bad-request', '/general/e');
    await tickUntil(async () => (await jobOf(bad.documentId))?.status === 'FAILED');
    const badFinal = await jobOf(bad.documentId);
    expect(badFinal?.resultCode).toBe('HTTP_400');
    expect(badFinal?.attemptCount).toBe(1); // 재시도 0회 — 첫 시도에서 바로 종결.
  }, 30_000);

  it('★ 작업 조회의 5xx는 재조회다 — 재전송(재적재)을 유발하지 않는다(설계 §5.6: 재전송은 not_found뿐)', async () => {
    ragState.ingestQueue.push('ACCEPT');
    ragState.taskStatusQueue.push('HTTP_500', 'HTTP_500', 'COMPLETED_SUCCESS');
    const { documentId } = await registerApprovedSource('poll-5xx', '/general/f');
    const submitted = await jobOf(documentId);
    expect(submitted?.status).toBe('SUBMITTED');
    const callsAfterSubmit = ragState.ingestCalls;
    const pollsBefore = ragState.taskStatusCalls;

    for (let i = 1; i <= 2; i += 1) {
      clock.advance(11_000);
      await kbSyncJob.tick();
      const job = await jobOf(documentId);
      expect(ragState.taskStatusCalls).toBe(pollsBefore + i); // 조회는 했고
      expect(job?.status).toBe('SUBMITTED'); // 상태는 그대로이며
      expect(job?.attemptCount).toBe(1); // 시도 수도 늘지 않았고
      expect(ragState.ingestCalls).toBe(callsAfterSubmit); // 다시 보내지 않았다.
    }
    clock.advance(11_000);
    await tickUntil(async () => (await jobOf(documentId))?.status === 'SUCCEEDED');
    expect(ragState.ingestCalls).toBe(callsAfterSubmit); // 끝까지 제출은 1번뿐.
  }, 30_000);

  it('작업 조회의 429는 작업 상태를 바꾸지 않고 다음 조회를 KB_INGEST_POLL_MS × 2로 미룬다', async () => {
    ragState.ingestQueue.push('ACCEPT');
    ragState.taskStatusQueue.push('HTTP_429', 'COMPLETED_SUCCESS');
    const { documentId } = await registerApprovedSource('poll-429', '/general/g');
    const pollsBefore = ragState.taskStatusCalls;

    clock.advance(11_000);
    await kbSyncJob.tick(); // 429
    expect(ragState.taskStatusCalls).toBe(pollsBefore + 1);
    expect((await jobOf(documentId))?.status).toBe('SUBMITTED');
    expect((await jobOf(documentId))?.attemptCount).toBe(1);

    clock.advance(11_000); // 10초 간격이면 조회했겠지만 × 2(20초)로 미뤘으므로 아직이다.
    await kbSyncJob.tick();
    expect(ragState.taskStatusCalls).toBe(pollsBefore + 1);

    clock.advance(10_000); // 이제 20초 경과.
    await tickUntil(async () => (await jobOf(documentId))?.status === 'SUCCEEDED');
    expect(ragState.taskStatusCalls).toBe(pollsBefore + 2);
  }, 30_000);

  it('★ AC-KB4-1: 적재는 전역 직렬이다 — 진행 중인 외부 작업이 항상 1개이고 순서대로 완료된다(슬롯은 완료까지 유지 · 인스턴스 2개 시뮬레이션)', async () => {
    // 작업 3건: 첫 작업은 두 번 "running" 뒤 완료, 둘째는 한 번 "running" 뒤 완료, 셋째는 바로 완료.
    ragState.ingestQueue.push('ACCEPT', 'ACCEPT', 'ACCEPT');
    ragState.taskStatusQueue.push('RUNNING', 'RUNNING', 'COMPLETED_SUCCESS', 'RUNNING', 'COMPLETED_SUCCESS', 'COMPLETED_SUCCESS');
    ragState.maxInFlight = 0;
    ragState.inFlight = 0;
    ragState.acceptedFileNames = [];
    const callsBefore = ragState.ingestCalls;
    const { sourceId, syncRunId } = await registerApprovedSource('serial', '/multi/index', { expectedJobs: 3, pathPrefix: '/multi', maxDepth: 1 });

    // 두 번째 "인스턴스" — 같은 DB·같은 외부 RAG를 보는 별도의 적재기(호출 한도 버킷도 따로).
    const { KbIngestRunner } = await import('../kb-sync/engine/kb-ingest.runner');
    const { KbRunStore } = await import('../kb-sync/core/kb-run.store');
    const { KbSourcesService } = await import('../kb-sync/kb-sources.service');
    const { RagHttpClient } = await import('../rag/rag-http.client');
    const { KbCrawlHttpFetcher } = await import('../kb-sync/crawl/kb-crawl-http.fetcher');
    const { KbSecretResolver } = await import('../kb-sync/crawl/kb-secret.resolver');
    const { KbRagCallLimiter } = await import('../kb-sync/lib/kb-rag-call-limiter');
    const otherInstance = new KbIngestRunner(
      moduleRefForTest.get(KbRunStore),
      moduleRefForTest.get(KbSourcesService),
      prisma,
      moduleRefForTest.get(RagHttpClient),
      moduleRefForTest.get(KbCrawlHttpFetcher),
      moduleRefForTest.get(KbSecretResolver),
      moduleRefForTest.get(ConfigService),
      new InProcessExtractor(),
      new KbRagCallLimiter(30),
    );

    const jobs = () => prisma.kbIngestJob.findMany({ where: { runId: syncRunId }, orderBy: { createdAt: 'asc' } });
    const inFlightJobs = async () => (await jobs()).filter((j) => j.status === 'SUBMITTING' || j.status === 'SUBMITTED').length;
    const slotRow = () => prisma.kbJobLease.findUnique({ where: { name: 'INGEST_SLOT_0' } });

    // 첫 작업은 이미 제출돼 조회 대기 중이다 — 그동안 슬롯은 그 작업이 쥐고 있어야 한다(제출 직후 해제되면 안 된다).
    expect(await inFlightJobs()).toBe(1);
    expect((await slotRow())?.claimToken).not.toBeNull();
    expect(ragState.ingestCalls - callsBefore).toBe(1);

    for (let i = 0; i < 40; i += 1) {
      const all = await jobs();
      if (all.every((j) => j.status === 'SUCCEEDED')) break;
      clock.advance(11_000);
      await kbSyncJob.tick();
      await otherInstance.runFragment(clock.now()); // 다른 인스턴스가 끼어들어도 동시 진행은 1건이다.
      expect(await inFlightJobs()).toBeLessThanOrEqual(1);
      expect(ragState.inFlight).toBeLessThanOrEqual(1);
    }

    const finalJobs = await jobs();
    expect(finalJobs.map((j) => j.status)).toEqual(['SUCCEEDED', 'SUCCEEDED', 'SUCCEEDED']);
    expect(ragState.maxInFlight).toBe(1); // 외부 RAG가 본 동시 진행 작업 수의 최댓값.
    expect(ragState.ingestCalls - callsBefore).toBe(3); // 중복 제출 0.
    // 접수 순서 = 작업 생성 순서 — 순서대로 완료된다.
    const docs = await prisma.kbDocument.findMany({ where: { id: { in: finalJobs.map((j) => j.documentId) } } });
    const nameById = new Map(docs.map((d) => [d.id, d.externalFileName]));
    expect(ragState.acceptedFileNames).toEqual(finalJobs.map((j) => nameById.get(j.documentId)));
    // 모두 끝나면 슬롯이 놓인다.
    expect((await slotRow())?.claimToken).toBeNull();

    // 종결 실행 요약 — 예전에는 종결 집계가 전부 0으로 덮였다(discovered·visited·outOfScopeLinks 등).
    await tickUntil(async () => {
      const run = await admin<{ status: string }>('GET', `/kb-sources/${sourceId}/runs/${syncRunId}`);
      return run.body.status === 'SUCCEEDED';
    });
    const run = await admin<{ crawl: { discovered: number; visited: number; added: number; changed: number; unchanged: number; outOfScopeLinks: number; excluded: Record<string, number> } }>(
      'GET',
      `/kb-sources/${sourceId}/runs/${syncRunId}`,
    );
    expect(run.body.crawl.discovered).toBe(3);
    expect(run.body.crawl.visited).toBe(3);
    expect(run.body.crawl.added).toBe(3);
    expect(run.body.crawl.outOfScopeLinks).toBe(1); // 색인이 가리킨 다른 호스트 링크 1개.
  }, 60_000);

  it('적재 시점의 재수집이 계속 실패하면(사이트 장애) 백오프 3회 뒤 FAILED다 — 제한 없는 고정 재시도로 PENDING에 영원히 머물지 않는다', async () => {
    flakyState.hits = 0;
    flakyState.okHits = 2; // 미리보기 크롤 1 + 승인 재크롤 1 — 그다음(적재 재수집)부터 503.
    const callsBefore = ragState.ingestCalls;
    const { documentId } = await registerApprovedSource('flaky-site', '/flaky/x');

    for (let attempt = 1; attempt <= 6; attempt += 1) {
      const job = await jobOf(documentId);
      if (job?.status === 'FAILED') break;
      expect(job?.status).toBe('PENDING');
      clock.advance(31 * 60_000);
      await kbSyncJob.tick();
    }
    const finalJob = await jobOf(documentId);
    expect(finalJob?.status).toBe('FAILED');
    expect(finalJob?.resultCode).toBe('UPSTREAM_ERROR');
    expect(finalJob?.attemptCount).toBe(4);
    expect(ragState.ingestCalls).toBe(callsBefore); // 외부 RAG에는 한 번도 보내지 않았다.
    expect((await prisma.kbJobLease.findUnique({ where: { name: 'INGEST_SLOT_0' } }))?.claimToken).toBeNull();
  }, 30_000);

  describe('실행 수준 실패(설계 §5.7 · §6.9)', () => {
    const body = (name: string, seedPath: string, extra: Record<string, unknown> = {}) => ({
      name: `${name}-${Date.now()}`,
      seedUrls: [`https://intra.example.invalid${seedPath}`],
      sitemapUrls: [],
      pathPrefixes: [seedPath],
      excludePatterns: [],
      noisePatterns: [],
      allowQueryUrls: false,
      maxDepth: 1,
      maxPages: 10,
      fileTypes: [],
      maxFileBytes: 20971520,
      minIntervalMs: 500,
      scope: { company: '예시공사', category: '인사', subcategory: `크롤_${name}` },
      schedule: { kind: 'MANUAL' },
      auth: { kind: 'NONE' },
      piiMask: true,
      allowRawFileIngest: false,
      rightsConfirmed: true,
      ...extra,
    });
    const runStatus = async (sourceId: string, runId: string) => (await admin<{ status: string; failureCode: string | null }>('GET', `/kb-sources/${sourceId}/runs/${runId}`)).body;

    it('고정 헤더 인증인데 비밀 값이 없으면 실행이 FAILED(SECRET_MISSING)로 끝나고 소스 선점이 풀린다(기동 실패 아님)', async () => {
      const created = await admin<{ id: string }>('POST', '/kb-sources', body('no-secret', '/general/s1', { auth: { kind: 'STATIC_HEADER', headerName: 'X-Api-Key', secretRef: 'NOSUCHREF' } }));
      expect(created.status).toBe(201);
      const preview = await admin<{ runId: string }>('POST', `/kb-sources/${created.body.id}/runs`, { kind: 'PREVIEW' });
      await tickUntil(async () => (await runStatus(created.body.id, preview.body.runId)).status === 'FAILED');
      expect((await runStatus(created.body.id, preview.body.runId)).failureCode).toBe('SECRET_MISSING');
      const source = await prisma.kbSource.findUnique({ where: { id: created.body.id } });
      expect(source?.activeRunId).toBeNull();
      expect(source?.lastRunStatus).toBe('FAILED');
      expect(await prisma.kbDocument.count({ where: { sourceId: created.body.id, visitState: 'VISITED' } })).toBe(0); // 헤더 없이 긁어 오지 않았다.
    });

    it('★ 승인된 소스의 SYNC 실행이라도 적재 전제(ACK)가 사라졌으면 적재 단계를 만들지 않고 FAILED(INGEST_NOT_ACKNOWLEDGED)로 끝난다 — INGESTING에 머물지 않는다', async () => {
      const created = await admin<{ id: string }>('POST', '/kb-sources', body('ack-removed', '/general/s2'));
      const sourceId = created.body.id;
      const preview = await admin<{ runId: string }>('POST', `/kb-sources/${sourceId}/runs`, { kind: 'PREVIEW' });
      await tickUntil(async () => (await runStatus(sourceId, preview.body.runId)).status === 'SUCCEEDED');
      const approve = await admin<{ runId: string }>('POST', `/kb-sources/${sourceId}/approve-ingest`, { previewRunId: preview.body.runId });
      expect(approve.status).toBe(202);

      // 승인 뒤에 운영자가 ACK 설정을 지운 상황.
      const configService = moduleRefForTest.get(ConfigService);
      const originalGet = configService.get.bind(configService);
      const spy = jest.spyOn(configService, 'get').mockImplementation(((key: string, ...rest: unknown[]) => (key === 'KB_INGEST_TRANSPORT_ACK' ? undefined : (originalGet as (k: string, ...r: unknown[]) => unknown)(key, ...rest))) as never);
      try {
        const callsBefore = ragState.ingestCalls;
        await tickUntil(async () => (await runStatus(sourceId, approve.body.runId)).status === 'FAILED');
        expect((await runStatus(sourceId, approve.body.runId)).failureCode).toBe('INGEST_NOT_ACKNOWLEDGED');
        expect(await prisma.kbIngestJob.count({ where: { runId: approve.body.runId } })).toBe(0); // 대기 작업을 만들지 않았다.
        expect(ragState.ingestCalls).toBe(callsBefore);
        const source = await prisma.kbSource.findUnique({ where: { id: sourceId } });
        expect(source?.activeRunId).toBeNull();
        expect(source?.lastRunStatus).toBe('FAILED');
        // 크롤 결과는 남지만 적재 실적(해시)은 갱신되지 않는다 — 다음 실행이 다시 "바뀜"으로 잡는다.
        const docs = await prisma.kbDocument.findMany({ where: { sourceId } });
        expect(docs.length).toBeGreaterThan(0);
        expect(docs.every((d) => d.lastIngestedAt === null && d.contentHash === null)).toBe(true);
      } finally {
        spy.mockRestore();
      }
    });
  });

  it('BULK 레인은 KB_INGEST_BULK_WINDOW 시간창 밖에서는 고르지 않는다(실행 화면 대기 사유 BULK_WINDOW) — 창 안에 들어오면 처리한다', async () => {
    // 지금(KST)으로부터 2시간 뒤에 시작하는 1시간짜리 창 — 첫 적재는 BULK 레인이라 지금은 대기해야 한다.
    const kst = new Date(clock.now().getTime() + 9 * 3_600_000);
    const startMin = (kst.getUTCHours() * 60 + kst.getUTCMinutes() + 120) % 1440;
    const endMin = (startMin + 60) % 1440;
    const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    const window = `${hhmm(startMin)}-${hhmm(endMin)}`;
    const configService = moduleRefForTest.get(ConfigService);
    const originalGet = configService.get.bind(configService);
    const spy = jest.spyOn(configService, 'get').mockImplementation(((key: string, ...rest: unknown[]) => (key === 'KB_INGEST_BULK_WINDOW' ? window : (originalGet as (k: string, ...r: unknown[]) => unknown)(key, ...rest))) as never);
    try {
      ragState.ingestQueue.push('SUCCESS');
      const before = ragState.ingestCalls;
      const { documentId, sourceId, syncRunId } = await registerApprovedSource('bulk-window', '/general/h');
      for (let i = 0; i < 3; i += 1) await kbSyncJob.tick();
      expect(ragState.ingestCalls).toBe(before); // 창 밖 — 제출 0.
      const job = await jobOf(documentId);
      expect(job?.lane).toBe('BULK');
      expect(job?.status).toBe('PENDING');
      const run = await admin<{ waitingReason: string | null }>('GET', `/kb-sources/${sourceId}/runs/${syncRunId}`);
      expect(run.body.waitingReason).toBe('BULK_WINDOW');

      clock.advance(2 * 3_600_000 + 10 * 60_000); // 창 안으로.
      await tickUntil(async () => (await jobOf(documentId))?.status === 'SUCCEEDED');
      expect(ragState.ingestCalls).toBe(before + 1);
    } finally {
      spy.mockRestore();
    }
  }, 30_000);
});
