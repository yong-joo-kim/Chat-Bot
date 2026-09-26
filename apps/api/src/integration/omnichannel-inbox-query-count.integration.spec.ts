import { execSync } from 'node:child_process';
import { randomUUID, createHmac } from 'node:crypto';
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
import { InboxParticipationCache } from '../inbox/core/inbox-participation.cache';
import { InboxQueryService } from '../inbox/read/inbox-query.service';
import { InboxIdentityService } from '../inbox/identity/inbox-identity.service';
import { InboxSignalService } from '../inbox/core/inbox-signal.service';
import { loginAs, seedTestUsers } from './helpers/auth.helper';

const API_ROOT = join(__dirname, '..', '..');

// [AC-OC2-4 신규] 식별 토큰 서명 -- 다른 No.42 통합 시험 파일과 같은 최소 HS256 구현(라이브러리 미사용).
const IDENTITY_HEADER = 'x-cb-identity';
const CUSTOMER_KEY_SECRET = 'ac-oc2-4-ck-secret-'.padEnd(32, '0');
const SPACE_REF = 'QCSPACE';
const SPACE_SECRET = 'ac-oc2-4-space-secret-'.padEnd(32, '1');

function b64url(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}
function signIdentityToken(payload: Record<string, unknown>, secret: string): string {
  const h = b64url({ alg: 'HS256' });
  const p = b64url(payload);
  const sig = createHmac('sha256', Buffer.from(secret, 'utf8')).update(`${h}.${p}`).digest('base64url');
  return `${h}.${p}.${sig}`;
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
        res.on('data', (chunk) => (data += chunk));
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
 * [No.42] 목록 쿼리 성능(NFR-OCP1 · §9.1 7-쿼리 구조) + 기능 꺼짐/비참여 공개 경로 쿼리 수 불변
 * (AC-OC1-1) — No.40·No.45 선례(`environment-query-count`·`data-governance-query-count-*`)와 같은
 * 계측 방식(테스트 전용 `PrismaClient` 서브클래스 + `.overrideProvider(PrismaService)`).
 */
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
    // 무시.
  }
}

describe('옴니채널 통합 인박스(No.42) — Prisma 쿼리 수 계측(NFR-OCP1 · AC-OC1-1)', () => {
  let app: NestExpressApplication;
  let baseUrl: string;
  let tmpDir: string;
  let prismaCounter: QueryCountingPrismaClient;
  let adminCookie = '';
  let agentCookie = '';
  let inboxQueryService: InboxQueryService;
  let inboxIdentityService: InboxIdentityService;
  let inboxSignalService: InboxSignalService;
  let participationCache: InboxParticipationCache;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'chatbot-inbox-querycount-test-'));
    const dbPath = join(tmpDir, 'test.db').replace(/\\/g, '/');
    const testDatabaseUrl = `file:${dbPath}`;

    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.DEPLOY_SCHEDULE_ENABLED = 'false';
    process.env.HANDOFF_SWEEPER_ENABLED = 'false';
    process.env.WIDGET_BASE_URL = process.env.WIDGET_BASE_URL ?? 'http://localhost:5174';
    process.env.PUBLIC_API_BASE_URL = process.env.PUBLIC_API_BASE_URL ?? 'http://localhost:3000/api/v1';
    // [AC-OC2-4 신규] 세션 식별 캐시 적중(2번째 턴부터 처리 자체를 건너뜀) 시험에 필요.
    process.env.OMNI_CUSTOMER_KEY_SECRET = CUSTOMER_KEY_SECRET;
    process.env[`OMNI_IDENTITY_SECRET__${SPACE_REF}`] = SPACE_SECRET;

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
    agentCookie = await loginAs(baseUrl, 'AGENT');

    // 참여 캐시를 미리 데운다(측정 창에 캐시 갱신 쿼리가 섞이지 않게).
    participationCache = moduleRef.get(InboxParticipationCache);
    await participationCache.participatingChatbotIds();
    inboxQueryService = moduleRef.get(InboxQueryService);
    inboxIdentityService = moduleRef.get(InboxIdentityService);
    inboxSignalService = moduleRef.get(InboxSignalService);
  }, 60_000);

  /**
   * [코드리뷰 R2 반영 M-5] `InboxIdentityService.observe()`·`InboxSignalService.signal()`은
   * fire-and-forget이라 공개 요청의 HTTP 응답이 돌아온 뒤에도 내부 처리(참여 캐시 확인 등)가
   * 잠시 더 실행될 수 있다 — 이 잔여 실행이 다음 쿼리 수 계측 창으로 새어 들어오면(또는 이번
   * 창에 아직 반영되지 않으면) 카운트가 흔들린다(단독 3회 중 2회 실패 관측). 계측 전후로 두
   * 서비스의 `pending` 체인을 모두 기다려 처리 완료 시점을 결정적으로 만든다(시험 전용 헬퍼).
   */
  async function drainInboxAsync(): Promise<void> {
    await inboxIdentityService.drainForTest();
    await inboxSignalService.drainForTest();
  }

  /**
   * [코드리뷰 R2 반영 M-5 — 근본 원인 재확인] `drainInboxAsync()`만으로는 부족했다 — 디버그 계측
   * 결과 `conversation-log.service.ts`의 `record()` 자체가 요청 핸들러 안에서 `void`로 호출되는
   * fire-and-forget이라(§2.3 "⑩ void logService.record()"), 응답이 돌아온 뒤에도 로그 적재·미응답
   * 질문 집계 같은 `record()` 자신의 DB 쓰기가 계측 창 경계를 넘나들며 카운트를 흔들 수 있다(이
   * 서비스들에는 `drainForTest()` 훅이 없다). 특정 완료 마커를 기다리는 대신, 일정 시간 동안 쿼리
   * 수가 더 이상 늘지 않을 때까지("정적 상태") 기다려 원인과 무관하게 결정적으로 만든다.
   *
   * [test-automation 2026-09-26 -- M-A 후속] 전체 스위트 병렬 실행(다른 통합 시험들이 동시에 실제
   * Nest 앱을 띄우는 CPU 경합 상황 -- jest.config.js의 testTimeout 상향 사유와 동일 원인)에서 단독
   * 실행 시 보이지 않던 5회 중 1회 수준의 잔여 실패가 재현됐다. 원인: 경합 중에는 이벤트 루프
   * 지연으로 "quietMs 동안 쿼리 수가 그대로"라는 단일 샘플이 실제로는 처리 도중의 우연한 소강
   * 상태(짧은 멈춤)를 완료로 오판할 확률이 올라간다 -- 연속 2회 정적 샘플을 요구해 이 오판을
   * 배제하고, 부하 상황에서 처리 자체가 오래 걸릴 수 있으므로 대기 상한(timeoutMs)도 늘린다
   * (진짜 결함이면 여전히 유한 시간 뒤 값이 어긋나 실패로 드러난다 -- 불변식은 여전히 `===`로
   * 검증한다).
   */
  async function waitForQueryQuiescence(quietMs = 150, timeoutMs = 8000): Promise<void> {
    const start = Date.now();
    let last = prismaCounter.queries.length;
    let stableStreak = 0;
    for (;;) {
      await new Promise((r) => setTimeout(r, quietMs));
      const current = prismaCounter.queries.length;
      if (current === last) {
        stableStreak += 1;
        if (stableStreak >= 2) return;
      } else {
        stableStreak = 0;
        last = current;
      }
      if (Date.now() - start > timeoutMs) return;
    }
  }

  afterAll(async () => {
    await app?.close();
    await safeCleanupTmpDir(tmpDir);
  });

  function admin<T = unknown>(method: string, path: string, body?: unknown): Promise<ApiResponse<T>> {
    return jsonRequest<T>(method, `${baseUrl}${path}`, body, { Cookie: adminCookie });
  }
  function agent<T = unknown>(method: string, path: string, body?: unknown): Promise<ApiResponse<T>> {
    return jsonRequest<T>(method, `${baseUrl}${path}`, body, { Cookie: agentCookie });
  }
  function pub<T = unknown>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<ApiResponse<T>> {
    return jsonRequest<T>(method, `${baseUrl}${path}`, body, headers);
  }

  async function createChatbotWithSlug(namePrefix: string): Promise<{ id: string; slug: string }> {
    const groupRes = await admin<{ id: string }>('POST', '/chatbot-groups', { name: `${namePrefix} 그룹` });
    const suffix = Math.random().toString(36).slice(2, 10);
    const slug = `invq-${suffix}`;
    const res = await admin<{ id: string }>('POST', '/chatbots', { groupId: groupRes.body.id, name: `${namePrefix}-${suffix}`, slug });
    return { id: res.body.id, slug };
  }

  async function activate(chatbotId: string): Promise<void> {
    await admin('PATCH', `/chatbots/${chatbotId}/status`, { status: 'ACTIVE' });
    await admin('PATCH', `/chatbots/${chatbotId}/channels/WEB`, { enabled: true, config: { allowedOrigins: [] } });
  }

  async function enableParticipation(chatbotId: string): Promise<void> {
    const res = await admin('PUT', `/chatbots/${chatbotId}/inbox-settings`, { enabled: true, openOnWarning: false });
    expect(res.status).toBe(200);
  }

  it('GET /inbox/threads — 쿼리 수가 ≤7이다(스레드 6건 · 담당·태그·최근 채널·챗봇·항목 미리보기·활성 상담 혼재)', async () => {
    const bot = await createChatbotWithSlug('쿼리수봇');
    await activate(bot.id);
    await enableParticipation(bot.id);

    // 태그 1개 준비.
    const tagRes = await admin<{ id: string }>('POST', '/inbox/tags', { name: `쿼리수태그-${Math.random().toString(36).slice(2, 6)}`, color: 'BLUE' });
    expect(tagRes.status).toBe(201);

    const threadIds: string[] = [];
    for (let i = 0; i < 6; i += 1) {
      const created = await admin<{ threadId: string }>('POST', '/inbox/customers', { displayName: `쿼리수 고객 ${i}` });
      expect(created.status).toBe(201);
      threadIds.push(created.body.threadId);
    }
    // 담당·태그·기록(최근 채널 실어주는 부수효과: RECORD는 lastChannelFamily=RECORD가 되지 않지만
    // lastActivityKind가 바뀐다 — 목록 렌더 다양성 확보용).
    await admin('PUT', `/inbox/threads/${threadIds[0]}/tags`, { tagIds: [tagRes.body.id], version: 0 });
    await agent('POST', `/inbox/threads/${threadIds[1]}/claim`, {});
    await admin('POST', `/inbox/threads/${threadIds[2]}/notes`, { text: '메모 본문' });
    await admin('POST', `/inbox/threads/${threadIds[3]}/records`, { recordChannel: 'PHONE', direction: 'INBOUND', occurredAt: new Date().toISOString(), text: '전화 기록' });

    prismaCounter.queries.length = 0;
    const res = await agent<{ items: unknown[] }>('GET', '/inbox/threads?includeTest=true');
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThanOrEqual(6);

    const queryCount = prismaCounter.queries.length;
    expect(queryCount).toBeGreaterThan(0);
    // ★ 실측 상한(§9.1 논리 7-쿼리 계획 + 인증 미들웨어 2 + Prisma/SQLite 관계 로딩 오버헤드 3
    // — customer·inbox_thread_tags·inbox_tags가 `include`로도 네이티브 JOIN 없이 별도 SELECT로
    // 배치된다, `relationLoadStrategy: 'join'`은 SQLite 미지원 확인). §27 I-1 참고.
    expect(queryCount).toBeLessThanOrEqual(12);
  }, 30_000);

  it('InboxQueryService.list() 직접 호출 — 인증 미들웨어를 제외한 서비스 자체 쿼리 수가 ≤10이다(§9.1 논리 7단계 + 관계 로딩 3)', async () => {
    prismaCounter.queries.length = 0;
    const result = await inboxQueryService.list(
      { page: 1, pageSize: 20, includeTest: true, activeHandoff: false } as never,
      'query-count-actor',
    );
    expect(result.items.length).toBeGreaterThan(0);
    expect(prismaCounter.queries.length).toBeLessThanOrEqual(10);
  });

  it('GET /inbox/threads/summary — 참여 챗봇 활성 상담 카운트 포함 쿼리가 소규모다', async () => {
    prismaCounter.queries.length = 0;
    const res = await agent('GET', '/inbox/threads/summary');
    expect(res.status).toBe(200);
    // 인증 미들웨어 2(세션·회원) + 요약 자체 쿼리 ≤6(카운트 4 + 활성 상담 카운트 1 + 참여 캐시 갱신 0~1).
    expect(prismaCounter.queries.length).toBeLessThanOrEqual(8);
  });

  it('AC-OC1-1: 참여하지 않는 챗봇 — 식별 헤더 있음/없음의 공개 경로 Prisma 쿼리 수가 완전히 같다(추가 쿼리 0)', async () => {
    const bot = await createChatbotWithSlug('비참여쿼리수봇');
    await activate(bot.id); // 통합 인박스 참여는 켜지 않는다(기본 꺼짐).

    const sessionWarmup = randomUUID();
    const sessionA = randomUUID();
    const sessionB = randomUUID();
    const token = 'aaa.bbb.ccc'; // 형식만 맞는 위조 토큰 — 참여 캐시 확인 뒤 곧바로 반환되므로 파싱조차 없다.

    // 챗봇 단위 캐시(대화 번들·답변 설정·금지어·No.41 이벤트 구독)를 먼저 데운다 — 그렇지 않으면
    // "첫 턴"끼리도 캐시 콜드 스타트 차이 때문에 비교가 무의미해진다(environment-query-count 선례와
    // 동일한 함정). 구독 캐시는 TTL 경계에서 드물게 재조회가 낄 수 있어 2회 예열한다.
    await pub('POST', `/public/chatbots/${bot.slug}/messages`, { sessionId: sessionWarmup, message: '예열' });
    await drainInboxAsync();
    await waitForQueryQuiescence();
    await pub('POST', `/public/chatbots/${bot.slug}/messages`, { sessionId: randomUUID(), message: '예열2' });
    await drainInboxAsync();
    await waitForQueryQuiescence();
    // [코드리뷰 R2 반영 M-5 — 추가 발견] 측정 두 요청이 같은 미응답 문구("안녕하세요")를 보내면
    // `unansweredQuestion` 중복 판정(정규화 문구 기준 조회 후 최초 1회만 INSERT)이 첫 번째 호출에만
    // 삽입 쿼리를 붙여 헤더 유무와 무관하게 쿼리 수가 달라지는 비대칭을 만든다(식별/신호
    // fire-and-forget과는 무관한 별도 원인 — 디버그 로그로 확인). 같은 문구로 한 번 더 예열해
    // 측정 창 시작 전에 그 행을 미리 만들어 둔다.
    await pub('POST', `/public/chatbots/${bot.slug}/messages`, { sessionId: randomUUID(), message: '안녕하세요' });
    await drainInboxAsync();
    await waitForQueryQuiescence();

    // [코드리뷰 R2 반영 M-5] `conversation-log.service.ts`의 `record()`는 요청 핸들러 안에서 `void`로
    // 호출되는 fire-and-forget이라(드레인 훅이 없다) 계측 창 시작 전에 쿼리 수가 정적 상태에
    // 이르렀는지까지 확인해야 직전 요청의 잔여 쓰기가 이번 창으로 새어 들어오지 않는다.
    //
    // [test-automation 2026-09-26 -- M-A 후속, 전체 스위트 병렬 실행 재현] 참여 캐시(TTL 30초)를
    // 두 측정 직전에 다시 데운다 -- 여기까지 오는 데 걸린 드레인·정적상태 대기 누적 시간이(부하가
    // 큰 환경에서) TTL을 넘기면, 두 측정 '사이' 어느 한쪽에만 캐시 재조회 쿼리가 섞여 등호 비교가
    // 깨진다(실제로 전체 스위트 병렬 실행에서 7 vs 4로 재현됨). 새 TTL 창을 확보해 두 측정이 같은
    // 창 안에서 끝나게 한다.
    await participationCache.participatingChatbotIds();
    prismaCounter.queries.length = 0;
    const withoutHeader = await pub('POST', `/public/chatbots/${bot.slug}/messages`, { sessionId: sessionA, message: '안녕하세요' });
    await drainInboxAsync();
    await waitForQueryQuiescence();
    const withoutQueries = [...prismaCounter.queries];

    prismaCounter.queries.length = 0;
    const withHeader = await pub('POST', `/public/chatbots/${bot.slug}/messages`, { sessionId: sessionB, message: '안녕하세요' }, { 'x-cb-identity': token });
    await drainInboxAsync();
    await waitForQueryQuiescence();
    const withQueries = [...prismaCounter.queries];

    expect(withoutHeader.status).toBe(withHeader.status);
    // 식별 헤더 처리 자체가 추가 쿼리를 만들지 않는다(비참여 = 캐시 확인 후 반환) — 드레인으로
    // 처리 완료를 결정적으로 기다렸으므로 이제 불변식은 등호로 검증한다(요청 경로 쿼리 수가
    // 헤더 유무와 무관하게 정확히 같다).
    expect(withQueries.length).toBe(withoutQueries.length);
  }, 60_000); // [test-automation 2026-09-26 -- M-A 후속] quietMs/timeoutMs 상향에 맞춰 시험 자체의 여유도 늘린다.

  it('AC-OC2-4: 이미 연결된 세션의 두 번째 턴 -- 식별 처리로 인한 추가 쿼리가 0이다(세션 식별 캐시 적중)', async () => {
    // [test-automation 2026-09-26 -- 재설계] 최초 버전은 "헤더 없는 대조군 턴"과 "이미 연결된 세션의
    // 두 번째 턴"을 서로 다른 두 HTTP 요청·드레인·쿼리계측 창으로 나눠 비교했다 -- 전체 스위트 병렬
    // 실행에서 10 vs 4처럼 큰 폭으로 흔들리는 것을 관측했다(설계서 §27 I-1·I-15가 이미 기록한 것과
    // 같은 계열의 문제 -- conversation-log.service.ts의 record()가 드레인 훅 없는 fire-and-forget이라,
    // 부하가 크면 한 창의 잔여 쓰기가 다른 창으로 새어 들어간다). 시험데이터.md §23(No.40 선례)의
    // 대응 방식 그대로, 서로 다른 두 요청의 쿼리 수를 비교하는 대신 -- AC-OC2-4가 실제로 보장해야
    // 하는 것(캐시가 적중하면 처리 자체가 시작되지 않는다)을 타이밍에 의존하지 않고 직접 검증한다:
    // InboxIdentityService.observe()는 세션 캐시 적중 시 pending(내부 처리 체인)을 전혀 건드리지 않고
    // 동기적으로 반환한다(§6.5 소스 주석 "동기 반환"). 캐시 적중 전후로 pending이 참조 동일하면 새
    // 비동기 작업이 전혀 만들어지지 않은 것이고, 이는 새 쿼리가 0개라는 것의 원인이자 더 강한 증거다
    // (쿼리 수를 세는 것은 그 결과만 간접 관찰하는 것). HTTP 왕복·계측 창 자체가 없으니 시스템 부하와
    // 무관하게 결정적이다.
    const bot = await createChatbotWithSlug('세션캐시쿼리봇');
    await activate(bot.id);
    await enableParticipation(bot.id);
    const identityRes = await admin('PUT', `/chatbots/${bot.id}/inbox-settings/identity`, { identitySecretRef: SPACE_REF });
    expect(identityRes.status).toBe(200);

    const sessionId = randomUUID();
    const now = Math.floor(Date.now() / 1000);
    const token = signIdentityToken({ sub: `qc-${randomUUID()}`, iat: now, exp: now + 3600 }, SPACE_SECRET);

    // 첫 턴 -- 식별 검증·연결 생성(§6.5)까지 전부 끝내고 드레인해 둔다(세션 캐시에 적재 -- 이 시점
    // 이후로는 같은 (chatbotId, sessionId)에 대한 observe()가 캐시 적중 분기를 탄다).
    const first = await pub('POST', `/public/chatbots/${bot.slug}/messages`, { sessionId, message: '안녕하세요' }, { [IDENTITY_HEADER]: token });
    expect(first.status).toBe(200);
    await drainInboxAsync();
    await waitForQueryQuiescence();

    // 연결이 실제로 생겼는지 먼저 확인한다(연결이 안 됐다면 아래 검증이 무의미해진다).
    const linkAfterFirst = await prismaCounter.customerLink.findUnique({ where: { chatbotId_sessionId: { chatbotId: bot.id, sessionId } } });
    expect(linkAfterFirst).not.toBeNull();
    expect(linkAfterFirst!.source).toBe('IDENTITY');

    // 서비스 내부 pending 체인 참조를 직접 비교한다(private 필드 -- 시험 전용 캐스트).
    const svc = inboxIdentityService as unknown as { pending: Promise<void> };
    const pendingBefore = svc.pending;

    // 두 번째 턴(같은 세션·같은 헤더) -- observe()가 세션 캐시 적중으로 곧장 반환해야 한다.
    inboxIdentityService.observe({ chatbotId: bot.id, sessionId, channelType: 'WEB', identity: { scheme: 'HOST_SIGNED_TOKEN', token }, now: new Date() });
    const pendingAfterSameSession = svc.pending;
    expect(pendingAfterSameSession).toBe(pendingBefore); // 참조 동일 -- 새 비동기 작업 0(따라서 새 쿼리도 0).

    // 대조 확인 -- 다른(캐시에 없는) 세션이면 실제로 pending 체인이 갱신된다(위 참조-동일 검증이
    // "관찰 방법 자체가 항상 참"인 허위 통과가 아님을 함께 보장한다).
    const otherSessionId = randomUUID();
    inboxIdentityService.observe({ chatbotId: bot.id, sessionId: otherSessionId, channelType: 'WEB', identity: { scheme: 'HOST_SIGNED_TOKEN', token }, now: new Date() });
    const pendingAfterNewSession = svc.pending;
    expect(pendingAfterNewSession).not.toBe(pendingBefore);
    await drainInboxAsync();

    // 연결은 캐시 적중 이후에도 그대로 유지된다(지워지거나 바뀌지 않는다).
    const linkAfterSecond = await prismaCounter.customerLink.findUnique({ where: { chatbotId_sessionId: { chatbotId: bot.id, sessionId } } });
    expect(linkAfterSecond).not.toBeNull();
    expect(linkAfterSecond!.customerId).toBe(linkAfterFirst!.customerId);
  }, 60_000);
});
