import { execSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
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
          resolve({ status: res.statusCode ?? 0, body: parsed as T });
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/**
 * 데이터 거버넌스(No.45) — 공개 대화 경로 Prisma 쿼리 수 계측(모드 ON — ★ AC-DG1-1의 대조군).
 * `data-governance-query-count-off.integration.spec.ts`(모드 OFF)와 **완전히 같은 모양**의 공개
 * 대화 1턴을 측정해 같은 고정값(`EXPECTED_TURN_QUERY_COUNT`)과 비교한다. 이 파일은 모드 ON +
 * 필드 암호화 ON + 출구 허용 목록 설정 + 전역 보존 정책(무기한 아님)까지 전부 켠 상태다 — 그래도
 * 공개 대화 1턴(상담·설문·감사 열람이 없는 일반 텍스트 턴)의 쿼리 수는 **거버넌스 코드 경로를 전혀
 * 타지 않는다**(대화 로그 저장은 암호화 대상 3필드에 포함되지 않고, 질문 순위 필터의 `textPurgedAt:
 * null` 조건은 기존 쿼리에 조건 1개를 얹을 뿐 쿼리 자체를 늘리지 않는다 — §18).
 */
const EXPECTED_TURN_QUERY_COUNT = 17; // 신규 챗봇 첫 턴(콜드 스타트) 실측값 — 양쪽 파일이 공유(No.40 선례와 우연히 같은 값).

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

describe('데이터 거버넌스(No.45) — 공개 대화 경로 Prisma 쿼리 수 계측(모드 ON, AC-DG1-1 대조군)', () => {
  let app: NestExpressApplication;
  let baseUrl: string;
  let tmpDir: string;
  let prismaCounter: QueryCountingPrismaClient;
  let adminCookie = '';

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'data-governance-query-count-on-test-'));
    const dbPath = join(tmpDir, 'test.db').replace(/\\/g, '/');
    const testDatabaseUrl = `file:${dbPath}`;

    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.DEPLOY_SCHEDULE_ENABLED = 'false';
    process.env.HANDOFF_SWEEPER_ENABLED = 'false';
    process.env.WIDGET_BASE_URL = process.env.WIDGET_BASE_URL ?? 'http://localhost:5174';
    process.env.PUBLIC_API_BASE_URL = process.env.PUBLIC_API_BASE_URL ?? 'http://localhost:3000/api/v1';
    process.env.EMBEDDING_BASE_URL = '';
    process.env.RAG_BASE_URL = '';
    process.env.AUGMENTATION_PROVIDER = 'rule';
    delete process.env.AUGMENTATION_GEMINI_API_KEY;
    delete process.env.AUGMENTATION_LOCAL_BASE_URL;

    process.env.DATA_GOVERNANCE_MODE = 'ON';
    process.env.DATA_ENCRYPTION_ENABLED = 'true';
    process.env.DATA_ENCRYPTION_KEYS = `k1:${randomBytes(32).toString('base64')}`;
    process.env.DATA_EGRESS_ALLOWED_HOSTS = 'ml-worker.internal,rag.internal';
    process.env.DATA_RETENTION_JOB_ENABLED = 'false';
    process.env.DATA_REENCRYPT_JOB_ENABLED = 'false';

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

    // 전역 보존 정책(무기한이 아닌 값)까지 실제로 켜 둔다 — 정책 유무가 랭킹 필터·쿼리 수에 영향이
    // 없어야 한다(질문 순위 필터 `textPurgedAt: null`은 조건 1개일 뿐 쿼리 자체를 늘리지 않는다).
    await prismaCounter.retentionPolicy.upsert({
      where: { scopeKey: 'GLOBAL' },
      create: { scopeKey: 'GLOBAL', days: JSON.stringify({ CONVERSATION_TEXT: 365 }), pending: '{}' },
      update: { days: JSON.stringify({ CONVERSATION_TEXT: 365 }), pending: '{}' },
    });
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await new Promise((r) => setTimeout(r, 200));
    try {
      rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      // 정리 실패는 판정에 영향 없음.
    }
  }, 15_000);

  function admin<T = unknown>(method: string, path: string, body?: unknown): Promise<ApiResponse<T>> {
    return jsonRequest<T>(method, `${baseUrl}${path}`, body, { Cookie: adminCookie });
  }
  function pub<T = unknown>(method: string, path: string, body?: unknown): Promise<ApiResponse<T>> {
    return jsonRequest<T>(method, `${baseUrl}${path}`, body);
  }

  async function createMeasuredChatbot(namePrefix: string): Promise<{ id: string; slug: string }> {
    const groupRes = await admin<{ id: string }>('POST', '/chatbot-groups', { name: `${namePrefix} 그룹` });
    const suffix = Math.random().toString(36).slice(2, 10);
    const slug = `dgq-on-${suffix}`;
    const res = await admin<{ id: string }>('POST', '/chatbots', { groupId: groupRes.body.id, name: `${namePrefix}-${suffix}`, slug });
    const chatbotId = res.body.id;
    await admin('PATCH', `/chatbots/${chatbotId}/status`, { status: 'ACTIVE' });
    await admin('PATCH', `/chatbots/${chatbotId}/channels/WEB`, { enabled: true, config: { allowedOrigins: [] } });
    const kw = await admin<{ id: string }>('POST', `/chatbots/${chatbotId}/keywords`, { name: `쿼리수-${chatbotId.slice(0, 6)}`, synonyms: [] });
    await admin('POST', `/chatbots/${chatbotId}/dialog-nodes`, {
      name: '응답노드',
      nodeType: 'NORMAL',
      keywordIds: [kw.body.id],
      outputs: [{ type: 'TEXT', payload: { text: '응답-A' } }],
    });
    return { id: chatbotId, slug };
  }

  let sessionCounter = 0;
  function sessionUuid(): string {
    sessionCounter += 1;
    const hex = sessionCounter.toString(16).padStart(12, '0');
    return `40000000-0000-4000-8000-${hex}`;
  }

  async function waitForLogInsert(timeoutMs = 3000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (prismaCounter.queries.some((q) => /insert into[\s\S]*conversation_logs/i.test(q))) return true;
      if (Date.now() > deadline) return false;
      await new Promise((r) => setTimeout(r, 20));
    }
  }

  async function measurePublicTurnQueryCount(slug: string, message: string): Promise<{ queryCount: number; status: number; queries: string[] }> {
    const sessionId = sessionUuid();
    prismaCounter.queries.length = 0;
    const res = await pub<{ outputs: Array<{ payload?: { text?: string } }> }>('POST', `/public/chatbots/${slug}/messages`, { sessionId, message });
    const found = await waitForLogInsert();
    expect(found).toBe(true);
    return { queryCount: prismaCounter.queries.length, status: res.status, queries: [...prismaCounter.queries] };
  }

  it('AC-DG1-1: 모드 ON(암호화·출구 허용 목록·보존 정책 전부 켜짐)에서도 공개 대화 1턴의 쿼리 수가 모드 OFF와 완전히 같다', async () => {
    const warmup = await createMeasuredChatbot('쿼리수예열');
    await measurePublicTurnQueryCount(warmup.slug, `쿼리수-${warmup.id.slice(0, 6)} 문의`);

    // 연속된 두 턴을 재는 대신(비동기 잔여 작업이 다음 측정 창으로 새는 레이스가 실제로 관측됨 —
    // 전체 스위트 반복 실행 중 8 → 7로 흔들렸다), No.40 선례와 동일하게 "신규 챗봇의 첫 턴"(콜드
    // 스타트) 1회만 측정한다 — 측정 대상 앞뒤에 다른 측정 창이 없어 레이스 여지가 없다.
    const target = await createMeasuredChatbot('쿼리수측정');
    const { queryCount, status, queries } = await measurePublicTurnQueryCount(target.slug, `쿼리수-${target.id.slice(0, 6)} 문의`);

    expect(status).toBe(200);
    const GOVERNANCE_ONLY_TABLES = ['retention_runs', 'audit_chain_heads', 'audit_chain_anchors', 'governance_job_states'];
    for (const table of GOVERNANCE_ONLY_TABLES) {
      expect(queries.some((q) => q.toLowerCase().includes(table))).toBe(false);
    }
    // ⚠ 의도된 변경 1건(EX): 감사 로그 기록 자체는 이 API 경로에 없다(로그인 등 관리 API에서만 발생) —
    // 공개 턴은 감사 대상이 아니라 이 경로에서 audit_logs 조회/쓰기도 없다(§10.3 record()는 관리 API
    // 전용 흐름에서만 호출된다).
    expect(queryCount).toBe(EXPECTED_TURN_QUERY_COUNT);
  });
});
