import { execSync } from 'node:child_process';
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
  headers: http.IncomingHttpHeaders;
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
        headers: {
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
          ...headers,
        },
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

/**
 * [신규 No.40 — test-automation 보강, 2026-09-25] AC-EN1-1 · FR-0-150 "환경 모드가 꺼진 챗봇의 공개
 * 대화 경로는 추가 DB 조회가 0건"을 **실제로 계측**한다. 기존 통합 시험(`environment-separation.
 * integration.spec.ts` A절)은 응답 바이트가 같음만 확인했고 Prisma 쿼리 수는 재지 않았다.
 *
 * 제품 코드(`PrismaService`)는 건드리지 않는다 — 테스트 전용 `PrismaClient` 서브클래스를
 * `log: [{ emit: 'event', level: 'query' }]`로 생성해 `.overrideProvider(PrismaService)`로만
 * 주입한다(다른 통합 시험이 이미 쓰는 `.overrideProvider(CLOCK)` 패턴과 동일).
 *
 * 비교 대상: (A) 환경 분리 기능을 한 번도 건드리지 않은 챗봇 vs (B) 켜기→끄기(KEEP_PROD)를
 * 거친 뒤 다시 꺼진 챗봇. 같은 모양의 공개 대화 요청(신규 세션 1턴)에서 두 쪽의 쿼리 수가
 * **완전히 같아야** "환경 분리 기능을 한 번이라도 사용한 이력이 꺼진 챗봇의 공개 경로에 흔적을
 * 남기지 않는다"(FR-0-150)는 주장이 성립한다.
 */
class QueryCountingPrismaClient extends PrismaClient {
  queries: string[] = [];

  constructor(datasourceUrl: string) {
    super({ datasources: { db: { url: datasourceUrl } }, log: [{ emit: 'event', level: 'query' }] });
    // Prisma 5의 이벤트 오버로드는 `log: [{ emit: 'event' }]`가 있을 때만 타입에 노출된다 — 런타임은 안전하다.
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

describe('환경 분리 / 버전 관리(No.40) — 공개 대화 경로 Prisma 쿼리 수 계측(AC-EN1-1 · FR-0-150)', () => {
  let app: NestExpressApplication;
  let baseUrl: string;
  let tmpDir: string;
  let prismaCounter: QueryCountingPrismaClient;
  let adminCookie = '';

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'environment-query-count-test-'));
    const dbPath = join(tmpDir, 'test.db').replace(/\\/g, '/');
    const testDatabaseUrl = `file:${dbPath}`;

    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.DEPLOY_SCHEDULE_ENABLED = 'false';
    process.env.WIDGET_BASE_URL = process.env.WIDGET_BASE_URL ?? 'http://localhost:5174';
    process.env.PUBLIC_API_BASE_URL = process.env.PUBLIC_API_BASE_URL ?? 'http://localhost:3000/api/v1';
    delete process.env.EMBEDDING_BASE_URL;

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

    await seedTestUsers(prismaCounter as unknown as import('../prisma/prisma.service').PrismaService);
    adminCookie = await loginAs(baseUrl, 'ADMIN');
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

  async function createChatbotWithSlug(namePrefix: string): Promise<{ id: string; slug: string }> {
    const groupRes = await admin<{ id: string }>('POST', '/chatbot-groups', { name: `${namePrefix} 그룹` });
    const suffix = Math.random().toString(36).slice(2, 10);
    const slug = `envq-${suffix}`;
    const res = await admin<{ id: string }>('POST', '/chatbots', { groupId: groupRes.body.id, name: `${namePrefix}-${suffix}`, slug });
    return { id: res.body.id, slug };
  }

  async function activate(chatbotId: string): Promise<void> {
    await admin('PATCH', `/chatbots/${chatbotId}/status`, { status: 'ACTIVE' });
    await admin('PATCH', `/chatbots/${chatbotId}/channels/WEB`, { enabled: true, config: { allowedOrigins: [] } });
  }

  async function createKeyword(chatbotId: string, name: string): Promise<string> {
    const res = await admin<{ id: string }>('POST', `/chatbots/${chatbotId}/keywords`, { name, synonyms: [] });
    expect(res.status).toBe(201);
    return res.body.id;
  }

  async function createKeywordNode(chatbotId: string, keywordId: string, text: string): Promise<void> {
    const res = await admin('POST', `/chatbots/${chatbotId}/dialog-nodes`, {
      name: `노드-${text}`,
      nodeType: 'NORMAL',
      keywordIds: [keywordId],
      outputs: [{ type: 'TEXT', payload: { text } }],
    });
    expect(res.status).toBe(201);
  }

  let sessionCounter = 0;
  function sessionUuid(): string {
    sessionCounter += 1;
    const hex = sessionCounter.toString(16).padStart(12, '0');
    return `20000000-0000-4000-8000-${hex}`;
  }

  /** fire-and-forget 로그 적재(CLAUDE.md 규약)가 끝났는지를 **추가 DB 조회 없이** 확인한다 — 계측
   * 중인 `prismaCounter.queries` 배열 자체에서 `INSERT INTO "conversation_logs"`가 나타났는지만
   * 메모리에서 검사한다(폴링이 계측 창에 쿼리를 더하지 않는다). */
  async function waitForLogInsert(timeoutMs = 3000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (prismaCounter.queries.some((q) => /insert into[\s\S]*conversation_logs/i.test(q))) return true;
      if (Date.now() > deadline) return false;
      await new Promise((r) => setTimeout(r, 20));
    }
  }

  /** 신규 세션 1턴 공개 메시지의 전체 처리(요청~fire-and-forget 로그 적재 완료까지) 동안 발생한
   * Prisma 쿼리 수를 잰다. */
  async function measurePublicTurnQueryCount(slug: string, _chatbotId: string, message: string): Promise<{ queryCount: number; status: number }> {
    const sessionId = sessionUuid();
    prismaCounter.queries.length = 0;
    const res = await pub<{ outputs: Array<{ payload?: { text?: string } }> }>('POST', `/public/chatbots/${slug}/messages`, { sessionId, message });
    const found = await waitForLogInsert();
    expect(found).toBe(true);
    return { queryCount: prismaCounter.queries.length, status: res.status };
  }

  /** 활성화된 웹 채널 · 키워드 1개 · 그 키워드로 답하는 노드 1개를 가진 챗봇을 만든다(측정 대상 형태 통일). */
  async function createMeasuredChatbot(namePrefix: string): Promise<{ id: string; slug: string }> {
    const chatbot = await createChatbotWithSlug(namePrefix);
    await activate(chatbot.id);
    const kw = await createKeyword(chatbot.id, `쿼리수-${chatbot.id.slice(0, 6)}`);
    await createKeywordNode(chatbot.id, kw, '응답-A');
    return chatbot;
  }

  it('AC-EN1-1 — 환경 분리를 한 번도 쓰지 않은 챗봇과, 켜기→끄기(KEEP_PROD)를 거쳐 다시 꺼진 챗봇의 "첫 공개 턴" 쿼리 수가 완전히 같다', async () => {
    // 금지어 사전 캐시(No.12D `InMemoryBannedWordCache`, 이 그룹과 무관 · TTL 60초 · 전역 단일 슬롯)와
    // 챗봇별 대화 번들 캐시(`DialogueBundleService.getCached`, TTL 60초)는 "그 프로세스에서 이 챗봇에게
    // 온 첫 턴"만 원본 조회 쿼리가 붙는 콜드 스타트 비용을 진다. 두 캐시 다 챗봇마다(또는 프로세스
    // 전역) 독립이므로, A/B를 공정하게 비교하려면 "각 챗봇의 첫 턴"끼리 비교해야 한다 — 같은 챗봇에
    // 두 번째 턴을 보내면 번들 캐시 적중으로 쿼리 수가 뚝 떨어져(약 17개 → 5개) A/B 비교와는 다른
    // 것을 재게 된다(시험 작성 중 실제로 관측 — No.40 결함이 아니라 기존 캐시 계층 때문).
    //
    // 그래서: (0) 금지어 캐시만 별도 챗봇으로 미리 데운다 → (A) 환경 분리를 전혀 쓰지 않은 챗봇의
    // 첫 턴 → (B) 켜기→끄기(KEEP_PROD)를 거쳐 다시 꺼진 챗봇의 첫 턴 → (A′) A와 구조가 같은 "또
    // 다른 미사용 챗봇"의 첫 턴(대조군 — 우연한 일치가 아님을 이중 확인) 순서로 잰다.
    const warmup = await createMeasuredChatbot('쿼리수-캐시예열');
    await measurePublicTurnQueryCount(warmup.slug, warmup.id, `쿼리수-${warmup.id.slice(0, 6)} 문의`);

    // (A) 환경 분리 기능을 전혀 건드리지 않은 챗봇.
    const chatbotA = await createMeasuredChatbot('쿼리수-미사용');

    // (B) 켜기 → 끄기(KEEP_PROD, 초안 무변경이라 복원 불필요)를 거쳐 다시 꺼진 챗봇.
    const chatbotB = await createMeasuredChatbot('쿼리수-사용이력');
    const preview = await admin<{ draftContentHash: string }>('POST', `/chatbots/${chatbotB.id}/environment/enable/preview`);
    expect(preview.status).toBe(200);
    const enableRes = await admin<{ prod: { versionId: string } }>('POST', `/chatbots/${chatbotB.id}/environment/enable`, { expectedDraftHash: preview.body.draftContentHash });
    expect(enableRes.status).toBe(201);
    const disablePreview = await admin<{ prod: { versionId: string }; draftContentHash: string; draftDiffersFromProd: boolean }>(
      'POST',
      `/chatbots/${chatbotB.id}/environment/disable/preview`,
    );
    expect(disablePreview.status).toBe(200);
    expect(disablePreview.body.draftDiffersFromProd).toBe(false); // 켜기 직후 무변경 — 복원 없이 바로 끌 수 있다.
    const disableRes = await admin('POST', `/chatbots/${chatbotB.id}/environment/disable`, {
      mode: 'KEEP_PROD',
      expectedProdVersionId: disablePreview.body.prod.versionId,
      expectedDraftHash: disablePreview.body.draftContentHash,
    });
    expect(disableRes.status).toBe(201);

    // (A′) 대조군 — A와 같은 모양이지만 별개인 "또 다른 미사용" 챗봇.
    const chatbotA2 = await createMeasuredChatbot('쿼리수-미사용대조군');

    const resultA = await measurePublicTurnQueryCount(chatbotA.slug, chatbotA.id, `쿼리수-${chatbotA.id.slice(0, 6)} 문의`);
    const resultB = await measurePublicTurnQueryCount(chatbotB.slug, chatbotB.id, `쿼리수-${chatbotB.id.slice(0, 6)} 문의`);
    const resultA2 = await measurePublicTurnQueryCount(chatbotA2.slug, chatbotA2.id, `쿼리수-${chatbotA2.id.slice(0, 6)} 문의`);

    expect(resultA.status).toBe(200);
    expect(resultB.status).toBe(200);
    expect(resultA2.status).toBe(200);
    expect(resultA.queryCount).toBeGreaterThan(0); // 계측 자체가 살아있는지 확인(0이면 이벤트가 안 잡힌 것).
    expect(resultB.queryCount).toBe(resultA.queryCount); // 핵심 단언 — AC-EN1-1 · FR-0-150.
    expect(resultA2.queryCount).toBe(resultA.queryCount); // 대조군 — 우연한 일치가 아님을 재확인.
  }, 30_000);
});
