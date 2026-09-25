import { execSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import * as http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { INestApplication, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { normalizeEmail, toKstDayBucket } from '@chat-bot/shared-types';
import { AppModule } from '../app.module';
import { AllExceptionsFilter } from '../common/all-exceptions.filter';
import { PrismaService } from '../prisma/prisma.service';
import { HandoffSweeperService } from '../handoff/handoff-sweeper.service';
import { HandoffHintsService } from '../handoff/handoff-hints.service';
import { hashPassword } from '../common/auth/lib/password-hash';
import { loginAs, seedTestUsers, TEST_PASSWORD } from './helpers/auth.helper';

const API_ROOT = join(__dirname, '..', '..');
const HANDOFF_SESSION_HEADER = 'x-cb-session-id';
const HANDOFF_TOKEN_HEADER = 'x-cb-handoff-token';
const RAW_MARKER = 'CS-RAW-7f2b';
const RAW_PHONE = '010-1234-5678';

/**
 * 하이브리드 CS(No.24) 보강 통합 시험 — `hybrid-cs-설계.md` §22(시험 설계 포인트) 대비
 * `hybrid-cs.integration.spec.ts`(1차, 약 12건)가 다루지 않은 우선순위 시나리오를 채운다.
 * 원본 스펙을 건드리지 않고 별도 파일로 분리했다. 이 파일은 1~3·5~12절(기본 env·단일 앱)만
 * 담는다 — 4절(레이트리밋 K-1, 낮은 상한 필요)·3-b절(다중 인스턴스 경합)은 `ConfigModule`
 * 스냅샷이 "테스트 파일이 AppModule을 처음 require하는 시점"에 고정되는 성질 때문에(주석 §22
 * 참고) 각각 `hybrid-cs-hardening-ratelimit.integration.spec.ts`·
 * `hybrid-cs-hardening-multi-instance.integration.spec.ts`로 분리했다(No.28 multi-instance 선례).
 */

async function safeCleanupTmpDir(dir: string): Promise<void> {
  await new Promise((r) => setTimeout(r, 300));
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {
    // 정리 실패는 테스트 판정에 영향 없음(Windows 파일 핸들 지연 — 기존 선례와 동일).
  }
}

interface ApiResponse<T = unknown> {
  status: number;
  body: T;
  headers: http.IncomingHttpHeaders;
}

function jsonRequest<T = unknown>(method: string, url: string, body?: unknown, opts: { cookie?: string; headers?: Record<string, string> } = {}): Promise<ApiResponse<T>> {
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
          ...(opts.cookie ? { Cookie: opts.cookie } : {}),
          ...(opts.headers ?? {}),
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
          resolve({ status: res.statusCode ?? 0, body: parsed as T, headers: res.headers });
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/** 응답 본문(JSON 트리) 전체를 문자열로 직렬화해 원문 마커가 어디에도 없는지 검사할 때 쓴다. */
function bodyContains(body: unknown, needle: string): boolean {
  return JSON.stringify(body).includes(needle);
}

const DEFAULT_SETTINGS = {
  enabled: true,
  cautionThreshold: 2,
  warningThreshold: 3,
  activeWindowMinutes: 10,
  userIdleMinutes: 10,
  agentNoReplyMinutes: 5,
  connectNotice: '상담원이 연결되었어요.',
  endNotice: '상담이 종료되었어요.',
  failNotice: '연결이 어려워요.',
};

/* ============================================================================================
 * 1~3, 5~12절 — 단일 앱(기본 레이트리밋·기본 sweeper-off) 공용 하네스
 * ========================================================================================== */
describe('하이브리드 CS(No.24) 보강 통합 시험 — 1~3·5~12절', () => {
  let app: INestApplication;
  let baseUrl: string;
  let tmpDir: string;
  let dbPath: string;
  let prisma: PrismaService;
  let sweeper: HandoffSweeperService;
  let hintsService: HandoffHintsService;

  let adminCookie = '';
  let editorCookie = '';
  let viewerCookie = '';
  let agentCookie = '';
  let agent2Cookie = '';
  let agent2Id = '';

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'chatbot-handoff-hardening-'));
    dbPath = join(tmpDir, 'test.db').replace(/\\/g, '/');
    const testDatabaseUrl = `file:${dbPath}`;

    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.DEPLOY_SCHEDULE_ENABLED = 'false';
    process.env.WIDGET_BASE_URL = process.env.WIDGET_BASE_URL ?? 'http://localhost:5174';
    process.env.PUBLIC_API_BASE_URL = process.env.PUBLIC_API_BASE_URL ?? 'http://localhost:3000/api/v1';

    execSync('pnpm exec prisma migrate deploy', {
      cwd: API_ROOT,
      env: { ...process.env, DATABASE_URL: testDatabaseUrl },
      stdio: 'pipe',
    });

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalFilters(new AllExceptionsFilter());
    prisma = moduleRef.get(PrismaService);
    sweeper = moduleRef.get(HandoffSweeperService);
    hintsService = moduleRef.get(HandoffHintsService);
    // db push는 schema.prisma에 선언 불가능한 부분 유니크 인덱스(마이그레이션 전용 raw SQL)를
    // 만들지 않는다 — 3절(배정 경합) 시험을 위해 마이그레이션과 동일한 인덱스를 직접 적용한다.
    await prisma.$executeRawUnsafe(
      'CREATE UNIQUE INDEX IF NOT EXISTS "handoff_sessions_active_key" ON "handoff_sessions"("chatbotId", "sessionId") WHERE "status" IN (\'CONNECTING\', \'CONNECTED\')',
    );

    await app.listen(0);
    const server = app.getHttpServer() as http.Server;
    const address = server.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;
    baseUrl = `http://127.0.0.1:${port}/api/v1`;

    await seedTestUsers(prisma);
    adminCookie = await loginAs(baseUrl, 'ADMIN');
    editorCookie = await loginAs(baseUrl, 'EDITOR');
    viewerCookie = await loginAs(baseUrl, 'VIEWER');
    agentCookie = await loginAs(baseUrl, 'AGENT');

    // 두 번째 상담원 — 배정 경합·강제 인수 시나리오 전용(auth.helper의 고정 4역할 맵을 건드리지 않는다).
    const agent2Email = normalizeEmail('integration-test-agent2@chat-bot.local');
    const passwordHash = await hashPassword(TEST_PASSWORD);
    const agent2 = await prisma.user.upsert({
      where: { email: agent2Email },
      update: {},
      create: { email: agent2Email, name: '테스트 AGENT2', role: 'AGENT', passwordHash, mustChangePassword: false, status: 'ACTIVE' },
    });
    agent2Id = agent2.id;
    const loginRes = await jsonRequest<Record<string, unknown>>('POST', `${baseUrl}/auth/login`, { email: agent2Email, password: TEST_PASSWORD });
    const setCookie = loginRes.headers['set-cookie'];
    agent2Cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie)!.split(';')[0];
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await safeCleanupTmpDir(tmpDir);
  });

  async function createGroup(): Promise<string> {
    const res = await jsonRequest<Record<string, unknown>>('POST', `${baseUrl}/chatbot-groups`, { name: `상담 보강시험 그룹 ${Math.random().toString(36).slice(2, 8)}` }, { cookie: adminCookie });
    return res.body.id as string;
  }

  /** 상담이 켜진 공개 챗봇 하나를 만든다. */
  async function setupHandoffChatbot(settingsOverride: Partial<typeof DEFAULT_SETTINGS> = {}): Promise<{ chatbotId: string; slug: string }> {
    const groupId = await createGroup();
    const suffix = Math.random().toString(36).slice(2, 10);
    const slug = `cs-hard-${suffix}`;
    const createRes = await jsonRequest<Record<string, unknown>>('POST', `${baseUrl}/chatbots`, { groupId, name: '상담 보강시험봇', slug }, { cookie: adminCookie });
    const chatbotId = createRes.body.id as string;
    await jsonRequest('PATCH', `${baseUrl}/chatbots/${chatbotId}/status`, { status: 'ACTIVE' }, { cookie: adminCookie });
    await jsonRequest('PATCH', `${baseUrl}/chatbots/${chatbotId}/channels/WEB`, { enabled: true, config: { allowedOrigins: [], greetingMessage: '안녕하세요' } }, { cookie: adminCookie });
    await jsonRequest('PUT', `${baseUrl}/chatbots/${chatbotId}/handoff-settings`, { ...DEFAULT_SETTINGS, ...settingsOverride }, { cookie: adminCookie });
    return { chatbotId, slug };
  }

  /**
   * [버그 수정 — 간헐 실패 #1] 세션 생성 직후(공개 메시지 POST 응답 후) 목록을 바로 조회하면
   * live-sessions 적재가 아직 반영되지 않아 items가 비어 items[0]이 undefined인 채로 접근해
   * 간헐적으로 실패했다(재현: 부하가 걸린 CI에서 수 회에 1회). items.length > 0이 될 때까지
   * 짧게 폴링한다(최대 3초, 100ms 간격) — 그래도 없으면 원인을 알 수 있는 오류로 실패시킨다.
   */
  async function getSessionRef(chatbotId: string): Promise<string> {
    const deadline = Date.now() + 3000;
    for (;;) {
      const listRes = await jsonRequest<{ items: Array<{ sessionRef: string }> }>('GET', `${baseUrl}/chatbots/${chatbotId}/live-sessions`, undefined, { cookie: adminCookie });
      if (listRes.body.items.length > 0) return listRes.body.items[0].sessionRef;
      if (Date.now() >= deadline) {
        throw new Error(`getSessionRef: chatbotId=${chatbotId}의 live-sessions가 3초 안에 채워지지 않았습니다(items.length=0).`);
      }
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  /** 개입(AGENT) → 첫 접촉(모던) → 원문이 남는 발화까지 만들어 CONNECTED 상태로 만든다. */
  async function connectHandoffWithRawMessage(
    chatbotId: string,
    slug: string,
    opts: { text?: string } = {},
  ): Promise<{ sessionId: string; sessionRef: string; handoffId: string; token: string }> {
    const sessionId = randomUUID();
    await jsonRequest('POST', `${baseUrl}/public/chatbots/${slug}/messages`, { sessionId, message: '이해할 수 없는 질문입니다' });
    const sessionRef = await getSessionRef(chatbotId);
    const intervened = await jsonRequest<{ id: string }>('POST', `${baseUrl}/chatbots/${chatbotId}/live-sessions/${sessionRef}/handoff`, {}, { cookie: agentCookie });
    const handoffId = intervened.body.id;

    const firstContact = await jsonRequest<{ handoff?: { token?: string } }>('POST', `${baseUrl}/public/chatbots/${slug}/messages`, {
      sessionId,
      message: opts.text ?? `제 번호는 ${RAW_PHONE}이고 표식은 ${RAW_MARKER}입니다`,
      features: ['handoff-v1'],
    });
    const token = firstContact.body.handoff?.token as string;
    // 상담 구간 첫 접촉 턴의 ConversationLog 적재는 fire-and-forget이다(§1.2.6) — 짧게 대기한다
    // (stats-learning.integration.spec.ts·survey-management.integration.spec.ts 선례와 동일).
    await new Promise((r) => setTimeout(r, 200));
    return { sessionId, sessionRef, handoffId, token };
  }

  /* ==========================================================================================
   * 1. 원문(P-9) 전수 누출 검사
   * ======================================================================================== */
  describe('1. 원문(P-9) 전수 누출 검사', () => {
    it('R-A: EDITOR는 대화 보기에서 includeRaw=true여도 200이지만 rawVisible=false·rawText 키가 없다(마스킹만)', async () => {
      const { chatbotId, slug } = await setupHandoffChatbot();
      const { sessionRef } = await connectHandoffWithRawMessage(chatbotId, slug);

      const res = await jsonRequest<{ rawVisible: boolean; entries: Array<{ rawText?: string }> }>(
        'GET',
        `${baseUrl}/chatbots/${chatbotId}/live-sessions/${sessionRef}/transcript?includeRaw=true`,
        undefined,
        { cookie: editorCookie },
      );
      expect(res.status).toBe(200);
      expect(res.body.rawVisible).toBe(false);
      expect(res.body.entries.every((e) => e.rawText === undefined)).toBe(true);
      expect(bodyContains(res.body, RAW_PHONE)).toBe(false);
    });

    it('R-B: 비담당 AGENT(agent2)는 cs:write는 있지만 담당자가 아니므로 includeRaw=true에서도 마스킹본만 본다', async () => {
      const { chatbotId, slug } = await setupHandoffChatbot();
      const { sessionRef } = await connectHandoffWithRawMessage(chatbotId, slug);

      const res = await jsonRequest<{ rawVisible: boolean }>(
        'GET',
        `${baseUrl}/chatbots/${chatbotId}/live-sessions/${sessionRef}/transcript?includeRaw=true`,
        undefined,
        { cookie: agent2Cookie },
      );
      expect(res.status).toBe(200);
      expect(res.body.rawVisible).toBe(false);
      expect(bodyContains(res.body, RAW_PHONE)).toBe(false);
    });

    it('R-C: ADMIN(비담당)은 includeRaw=true에서 원문을 볼 수 있고 RAW_VIEW 감사가 담당자와 별도로 1건씩 남는다', async () => {
      const { chatbotId, slug } = await setupHandoffChatbot();
      const { sessionRef, handoffId } = await connectHandoffWithRawMessage(chatbotId, slug);

      // 담당자(AGENT)가 먼저 열람.
      await jsonRequest('GET', `${baseUrl}/chatbots/${chatbotId}/live-sessions/${sessionRef}/transcript?includeRaw=true`, undefined, { cookie: agentCookie });
      // ADMIN도 열람.
      const adminRes = await jsonRequest<{ rawVisible: boolean; entries: Array<{ rawText?: string }> }>(
        'GET',
        `${baseUrl}/chatbots/${chatbotId}/live-sessions/${sessionRef}/transcript?includeRaw=true`,
        undefined,
        { cookie: adminCookie },
      );
      expect(adminRes.body.rawVisible).toBe(true);
      expect(adminRes.body.entries.some((e) => e.rawText?.includes(RAW_PHONE))).toBe(true);

      const rawViewCount = await prisma.auditLog.count({ where: { action: 'RAW_VIEW', targetId: handoffId } });
      expect(rawViewCount).toBe(2); // 담당자 1 + ADMIN 1 — (상담, 열람자)당 1건.
    });

    it('R-D: 종료 직후 같은 트랜잭션에서 rawText가 전부 NULL이고, 이후에는 담당자도 원문을 볼 수 없다', async () => {
      const { chatbotId, slug } = await setupHandoffChatbot();
      const { sessionRef, handoffId } = await connectHandoffWithRawMessage(chatbotId, slug);

      await jsonRequest('POST', `${baseUrl}/chatbots/${chatbotId}/handoffs/${handoffId}/end`, {}, { cookie: agentCookie });
      const rows = await prisma.handoffMessage.findMany({ where: { handoffSessionId: handoffId, rawText: { not: null } } });
      expect(rows).toHaveLength(0);

      const after = await jsonRequest<{ rawVisible: boolean }>(
        'GET',
        `${baseUrl}/chatbots/${chatbotId}/live-sessions/${sessionRef}/transcript?includeRaw=true`,
        undefined,
        { cookie: agentCookie },
      );
      expect(after.body.rawVisible).toBe(false);
    });

    it('R-E(R-9 변형): 종료·정리 루프 이후 서버 응답 전수·ConversationLog·SQLite 파일 바이트에서 원문 문자열이 0건이다', async () => {
      // describe 1의 다른 it()들과 같은 DB 파일을 공유하므로(형제 테스트가 만든 아직 활성인 세션의
      // rawText와 섞이지 않도록) 이 테스트 전용 전화번호를 쓴다 — 파일 전체 grep이 "R-E 자신의
      // 원문 파기"만 검증하게 한다.
      const R_E_PHONE = '010-2468-1357';
      const { chatbotId, slug } = await setupHandoffChatbot();
      const { sessionId, sessionRef, handoffId, token } = await connectHandoffWithRawMessage(chatbotId, slug, { text: `제 번호는 ${R_E_PHONE}이고 표식은 ${RAW_MARKER}입니다` });

      // 상담원 발신 메시지도 원문 섞임 여부를 함께 검사(마스킹 유지 확인, §9.5).
      await jsonRequest('POST', `${baseUrl}/chatbots/${chatbotId}/handoffs/${handoffId}/messages`, { text: `연락처는 ${R_E_PHONE} 입니다` }, { cookie: agentCookie });

      // 공개 폴링(마스킹본).
      const pollRes = await jsonRequest(
        'GET',
        `${baseUrl}/public/chatbots/${slug}/handoff?after=0`,
        undefined,
        { headers: { [HANDOFF_SESSION_HEADER]: sessionId, [HANDOFF_TOKEN_HEADER]: token } },
      );
      expect(bodyContains(pollRes.body, R_E_PHONE)).toBe(false);

      // 힌트.
      const hintsRes = await jsonRequest('GET', `${baseUrl}/chatbots/${chatbotId}/live-sessions/${sessionRef}/hints`, undefined, { cookie: agentCookie });
      expect(bodyContains(hintsRes.body, R_E_PHONE)).toBe(false);

      // 목록·이력 목록·이력 요약·이력 상세.
      const liveList = await jsonRequest('GET', `${baseUrl}/chatbots/${chatbotId}/live-sessions`, undefined, { cookie: adminCookie });
      expect(bodyContains(liveList.body, R_E_PHONE)).toBe(false);

      await jsonRequest('POST', `${baseUrl}/chatbots/${chatbotId}/handoffs/${handoffId}/end`, {}, { cookie: agentCookie });
      const today = toKstDayBucket(new Date()); // 이력 기간은 KST 일 기준 — UTC로 자르면 KST 새벽에 빈 목록이 되어 누출 검사가 무의미해진다
      const histList = await jsonRequest('GET', `${baseUrl}/chatbots/${chatbotId}/handoffs?from=${today}&to=${today}`, undefined, { cookie: adminCookie });
      expect(bodyContains(histList.body, R_E_PHONE)).toBe(false);
      const histSummary = await jsonRequest('GET', `${baseUrl}/chatbots/${chatbotId}/handoffs/summary?from=${today}&to=${today}`, undefined, { cookie: adminCookie });
      expect(bodyContains(histSummary.body, R_E_PHONE)).toBe(false);
      const histDetail = await jsonRequest('GET', `${baseUrl}/chatbots/${chatbotId}/handoffs/${handoffId}`, undefined, { cookie: adminCookie });
      expect(bodyContains(histDetail.body, R_E_PHONE)).toBe(false);

      // 감사 로그(요약문에도 원문이 없어야 한다).
      const auditList = await jsonRequest('GET', `${baseUrl}/audit-logs?targetType=HandoffSession`, undefined, { cookie: adminCookie });
      expect(bodyContains(auditList.body, R_E_PHONE)).toBe(false);

      // ConversationLog — 상담 구간 사용자 턴(handoffTurn=true)도 저장 지점에서 마스킹됐어야 한다.
      const handoffTurnLogs = await prisma.conversationLog.findMany({ where: { chatbotId, handoffTurn: true } });
      for (const row of handoffTurnLogs) {
        expect(row.userMessage.includes(R_E_PHONE)).toBe(false);
        expect(row.botResponse.includes(R_E_PHONE)).toBe(false);
      }

      // 정리 루프(멱등 재실행) — 만료분이 없어도 예외 없이 통과.
      await sweeper.tick();

      // DB 파일 바이트 직접 grep — secure_delete로 옛 페이지 값까지 덮어썼는지 최종 확인(R-9).
      // 이 테스트 전용 번호만 검사한다(형제 테스트의 아직 활성인 세션과 섞이지 않도록).
      const fileBytes = readFileSync(dbPath, 'latin1');
      expect(fileBytes.includes(R_E_PHONE)).toBe(false);
      // RAW_MARKER(비 PII 표식)는 마스킹본 text 컬럼에 영구히 남는 것이 정상이다 — 누출 판정 대상은
      // RAW_PHONE(PII)뿐이다.
    });

    it('R-F(R-7): 상담 60분 초과 메시지는 읽기 즉시 원문이 보이지 않고, sweeper.tick() 후 NULL로 파기된다', async () => {
      const { chatbotId, slug } = await setupHandoffChatbot();
      const { sessionRef, handoffId } = await connectHandoffWithRawMessage(chatbotId, slug);

      const rawRow = await prisma.handoffMessage.findFirst({ where: { handoffSessionId: handoffId, rawText: { not: null } } });
      expect(rawRow).not.toBeNull();
      // 60분 상한을 넘긴 것처럼 만료 시각을 과거로 되돌린다(§9.1 절대 상한).
      await prisma.handoffMessage.update({ where: { id: rawRow!.id }, data: { rawExpiresAt: new Date(Date.now() - 1000) } });

      const transcriptRes = await jsonRequest<{ entries: Array<{ rawText?: string }> }>(
        'GET',
        `${baseUrl}/chatbots/${chatbotId}/live-sessions/${sessionRef}/transcript?includeRaw=true`,
        undefined,
        { cookie: agentCookie },
      );
      // 상한을 넘긴 개별 메시지는 읽기 시점에도 마스킹본으로 되돌아간다(K-5).
      expect(transcriptRes.body.entries.some((e) => e.rawText?.includes(RAW_PHONE))).toBe(false);

      await sweeper.tick();
      const after = await prisma.handoffMessage.findUnique({ where: { id: rawRow!.id } });
      expect(after?.rawText).toBeNull();
    });

    it('R-G: PII가 없는 발화는 애초에 rawText를 저장하지 않는다(rawText=null, K-5 최소 보관)', async () => {
      const { chatbotId, slug } = await setupHandoffChatbot();
      const sessionId = randomUUID();
      await jsonRequest('POST', `${baseUrl}/public/chatbots/${slug}/messages`, { sessionId, message: '이해할 수 없는 질문입니다' });
      const sessionRef = await getSessionRef(chatbotId);
      const intervened = await jsonRequest<{ id: string }>('POST', `${baseUrl}/chatbots/${chatbotId}/live-sessions/${sessionRef}/handoff`, {}, { cookie: agentCookie });
      await jsonRequest('POST', `${baseUrl}/public/chatbots/${slug}/messages`, { sessionId, message: '안녕하세요 그냥 인사만 드려요', features: ['handoff-v1'] });

      const rows = await prisma.handoffMessage.findMany({ where: { handoffSessionId: intervened.body.id, sender: 'USER' } });
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.rawText === null)).toBe(true);
    });
  });

  /* ==========================================================================================
   * 2. 토큰·세션 가장
   * ======================================================================================== */
  describe('2. 토큰·세션 가장', () => {
    it('토큰 헤더 없이 폴링하면(CONNECTED 상태) 활성 상담의 존재 자체가 드러나지 않는다(status=NONE)', async () => {
      const { chatbotId, slug } = await setupHandoffChatbot();
      const { sessionId } = await connectHandoffWithRawMessage(chatbotId, slug);

      const res = await jsonRequest<{ status: string; messages: unknown[] }>('GET', `${baseUrl}/public/chatbots/${slug}/handoff?after=0`, undefined, {
        headers: { [HANDOFF_SESSION_HEADER]: sessionId },
      });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('NONE');
      expect(res.body.messages).toEqual([]);
    });

    it('잘못된(위조) 토큰으로 폴링하면 404 HANDOFF_NOT_FOUND다', async () => {
      const { chatbotId, slug } = await setupHandoffChatbot();
      const { sessionId } = await connectHandoffWithRawMessage(chatbotId, slug);

      const res = await jsonRequest('GET', `${baseUrl}/public/chatbots/${slug}/handoff?after=0`, undefined, {
        headers: { [HANDOFF_SESSION_HEADER]: sessionId, [HANDOFF_TOKEN_HEADER]: 'forged-token-value-0000000000000000' },
      });
      expect(res.status).toBe(404);
    });

    it('타인의(실재하지 않는) sessionId로 폴링해도 상담 존재를 드러내지 않고 NONE을 반환한다(세션 가장 방어)', async () => {
      const { slug } = await setupHandoffChatbot();
      const strangerSessionId = randomUUID();
      const res = await jsonRequest<{ status: string }>('GET', `${baseUrl}/public/chatbots/${slug}/handoff?after=0`, undefined, {
        headers: { [HANDOFF_SESSION_HEADER]: strangerSessionId },
      });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('NONE');
    });

    it('모던 토큰은 최초 1회만 발급된다 — 동시 폴링 2건 경합 시 한쪽만 토큰을 받는다', async () => {
      const { chatbotId, slug } = await setupHandoffChatbot();
      const sessionId = randomUUID();
      await jsonRequest('POST', `${baseUrl}/public/chatbots/${slug}/messages`, { sessionId, message: '이해할 수 없는 질문입니다' });
      const sessionRef = await getSessionRef(chatbotId);
      await jsonRequest('POST', `${baseUrl}/chatbots/${chatbotId}/live-sessions/${sessionRef}/handoff`, {}, { cookie: agentCookie });

      const [pollA, pollB] = await Promise.all([
        jsonRequest<{ token?: string; status: string }>('GET', `${baseUrl}/public/chatbots/${slug}/handoff?after=0`, undefined, { headers: { [HANDOFF_SESSION_HEADER]: sessionId } }),
        jsonRequest<{ token?: string; status: string }>('GET', `${baseUrl}/public/chatbots/${slug}/handoff?after=0`, undefined, { headers: { [HANDOFF_SESSION_HEADER]: sessionId } }),
      ]);
      const tokens = [pollA.body.token, pollB.body.token].filter((t): t is string => !!t);
      expect(tokens).toHaveLength(1);

      const session = await prisma.handoffSession.findFirst({ where: { chatbotId, sessionId } });
      expect(session?.clientMode).toBe('MODERN');
    });

    it('레거시(토큰 없는) 편승 경로 — features 선언 없이 보내면 handoff 키 없이 동작해 구버전과 바이트 동일하다', async () => {
      const { chatbotId, slug } = await setupHandoffChatbot();
      const sessionId = randomUUID();
      await jsonRequest('POST', `${baseUrl}/public/chatbots/${slug}/messages`, { sessionId, message: '이해할 수 없는 질문입니다' });
      const sessionRef = await getSessionRef(chatbotId);
      await jsonRequest('POST', `${baseUrl}/chatbots/${chatbotId}/live-sessions/${sessionRef}/handoff`, {}, { cookie: agentCookie });

      const legacyTurn = await jsonRequest<Record<string, unknown>>('POST', `${baseUrl}/public/chatbots/${slug}/messages`, { sessionId, message: '안녕하세요' });
      expect(legacyTurn.status).toBe(200);
      expect('handoff' in legacyTurn.body).toBe(false);
    });
  });

  /* ==========================================================================================
   * 3. 배정 경합
   * ======================================================================================== */
  describe('3. 배정 경합', () => {
    it('두 상담원이 같은 세션에 동시에 개입하면 1명만 201이고 나머지는 409 HANDOFF_ALREADY_ASSIGNED다', async () => {
      const { chatbotId, slug } = await setupHandoffChatbot();
      const sessionId = randomUUID();
      await jsonRequest('POST', `${baseUrl}/public/chatbots/${slug}/messages`, { sessionId, message: '이해할 수 없는 질문입니다' });
      const sessionRef = await getSessionRef(chatbotId);

      const [resA, resB] = await Promise.all([
        jsonRequest<{ id?: string }>('POST', `${baseUrl}/chatbots/${chatbotId}/live-sessions/${sessionRef}/handoff`, {}, { cookie: agentCookie }),
        jsonRequest<{ id?: string }>('POST', `${baseUrl}/chatbots/${chatbotId}/live-sessions/${sessionRef}/handoff`, {}, { cookie: agent2Cookie }),
      ]);
      const statuses = [resA.status, resB.status].sort();
      expect(statuses).toEqual([201, 409]);

      const active = await prisma.handoffSession.findMany({ where: { chatbotId, sessionId, status: { in: ['CONNECTING', 'CONNECTED'] } } });
      expect(active).toHaveLength(1);
    });

    it('ADMIN 강제 인수 후 이전 담당자가 메시지를 보내면 403 HANDOFF_NOT_ASSIGNEE, isMine도 뒤집힌다', async () => {
      const { chatbotId, slug } = await setupHandoffChatbot();
      const { handoffId } = await connectHandoffWithRawMessage(chatbotId, slug);

      const takeoverRes = await jsonRequest<{ isMine: boolean }>('POST', `${baseUrl}/chatbots/${chatbotId}/handoffs/${handoffId}/takeover`, { reason: '업무 인계' }, { cookie: adminCookie });
      expect(takeoverRes.status).toBe(201);
      expect(takeoverRes.body.isMine).toBe(true); // 인수한 ADMIN 본인 화면 기준.

      const oldAgentSend = await jsonRequest('POST', `${baseUrl}/chatbots/${chatbotId}/handoffs/${handoffId}/messages`, { text: '아직 제가 담당인 줄 알았어요' }, { cookie: agentCookie });
      expect(oldAgentSend.status).toBe(403);
      const body = oldAgentSend.body as { code?: string };
      expect(body.code).toBe('HANDOFF_NOT_ASSIGNEE');

      const newAgentAsViewer = await jsonRequest<{ handoff: { isMine: boolean } | null }>(
        'GET',
        `${baseUrl}/chatbots/${chatbotId}/live-sessions/${await getSessionRef(chatbotId)}/transcript`,
        undefined,
        { cookie: agentCookie },
      );
      expect(newAgentAsViewer.body.handoff?.isMine).toBe(false); // 옛 담당자 화면에서는 더 이상 내 상담이 아니다.
    });

    it('AGENT의 강제 인수 시도는 역할 자체가 ADMIN이 아니라서 403이다(관리자 전용)', async () => {
      const { chatbotId, slug } = await setupHandoffChatbot();
      const { handoffId } = await connectHandoffWithRawMessage(chatbotId, slug);
      const res = await jsonRequest('POST', `${baseUrl}/chatbots/${chatbotId}/handoffs/${handoffId}/takeover`, { reason: '시도' }, { cookie: agent2Cookie });
      expect(res.status).toBe(403);
    });

    it('ADMIN도 담당자가 아니면 메시지 전송은 403이다 — 종료(end)만 ADMIN 예외가 있다(설계 §26 D-?, 담당자∨ADMIN)', async () => {
      const { chatbotId, slug } = await setupHandoffChatbot();
      const { handoffId } = await connectHandoffWithRawMessage(chatbotId, slug);

      const sendAsAdmin = await jsonRequest('POST', `${baseUrl}/chatbots/${chatbotId}/handoffs/${handoffId}/messages`, { text: '담당자 아닌 ADMIN' }, { cookie: adminCookie });
      expect(sendAsAdmin.status).toBe(403);

      const endAsAdmin = await jsonRequest('POST', `${baseUrl}/chatbots/${chatbotId}/handoffs/${handoffId}/end`, {}, { cookie: adminCookie });
      expect(endAsAdmin.status).toBe(201); // 종료는 담당자가 아니어도 ADMIN이면 허용된다.
    });
  });

  /* ==========================================================================================
   * 5. 기존 경로 바이트 동일
   * ======================================================================================== */
  describe('5. 기존 경로 바이트 동일', () => {
    it('상담이 꺼진 챗봇 + 토큰 헤더 없음은 handoff 키가 없다(회귀, AC-CS1-1 재확인)', async () => {
      const groupId = await createGroup();
      const slug = `cs-hard-off-${Math.random().toString(36).slice(2, 8)}`;
      const create = await jsonRequest<{ id: string }>('POST', `${baseUrl}/chatbots`, { groupId, name: '상담꺼짐봇', slug }, { cookie: adminCookie });
      await jsonRequest('PATCH', `${baseUrl}/chatbots/${create.body.id}/status`, { status: 'ACTIVE' }, { cookie: adminCookie });
      await jsonRequest('PATCH', `${baseUrl}/chatbots/${create.body.id}/channels/WEB`, { enabled: true, config: { allowedOrigins: [], greetingMessage: 'hi' } }, { cookie: adminCookie });

      const res = await jsonRequest<Record<string, unknown>>('POST', `${baseUrl}/public/chatbots/${slug}/messages`, { sessionId: randomUUID(), message: '안녕' });
      expect(res.status).toBe(200);
      expect('handoff' in res.body).toBe(false);
    });

    it('금지어 BLOCK 경로는 상담이 켜진 챗봇에서도 불변이다(handoff 게이트보다 먼저 처리, handoff 키 없음)', async () => {
      const { slug } = await setupHandoffChatbot();
      await jsonRequest('POST', `${baseUrl}/banned-words`, { word: `금지어히든${Math.random().toString(36).slice(2, 6)}`, matchType: 'CONTAINS', policy: 'BLOCK' }, { cookie: adminCookie });
      const wordListRes = await jsonRequest<{ items: Array<{ word: string }> }>('GET', `${baseUrl}/banned-words`, undefined, { cookie: adminCookie });
      const word = wordListRes.body.items[wordListRes.body.items.length - 1].word;

      const res = await jsonRequest<{ outputs: Array<{ payload: { text: string } }> }>('POST', `${baseUrl}/public/chatbots/${slug}/messages`, {
        sessionId: randomUUID(),
        message: `${word} 포함 메시지`,
        features: ['handoff-v1'],
      });
      expect(res.status).toBe(200);
      expect('handoff' in res.body).toBe(false);
    });
  });

  /* ==========================================================================================
   * 6. 연속 미응답 경고
   * ======================================================================================== */
  describe('6. 연속 미응답 경고', () => {
    it('미응답이 임계값(주의 2 · 경고 3)까지 쌓이면 진행 중 목록의 alertLevel이 단계별로 올라간다', async () => {
      const { chatbotId, slug } = await setupHandoffChatbot({ cautionThreshold: 2, warningThreshold: 3 });
      const sessionId = randomUUID();

      // 대화로그 적재가 응답과 비동기라 병렬 부하에서 직전 턴이 늦게 보일 수 있다 — 기대 단계까지 짧게 폴링(최대 3초).
      const alertAfterLogs = async (expected: string): Promise<string | undefined> => {
        let level: string | undefined;
        for (let i = 0; i < 30; i += 1) {
          const res = await jsonRequest<{ items: Array<{ alertLevel: string }> }>('GET', `${baseUrl}/chatbots/${chatbotId}/live-sessions`, undefined, { cookie: adminCookie });
          level = res.body.items?.[0]?.alertLevel;
          if (level === expected) return level;
          await new Promise((r) => setTimeout(r, 100));
        }
        return level;
      };

      await jsonRequest('POST', `${baseUrl}/public/chatbots/${slug}/messages`, { sessionId, message: '이해할 수 없는 질문 1' });
      expect(await alertAfterLogs('NORMAL')).toBe('NORMAL');

      await jsonRequest('POST', `${baseUrl}/public/chatbots/${slug}/messages`, { sessionId, message: '이해할 수 없는 질문 2' });
      expect(await alertAfterLogs('CAUTION')).toBe('CAUTION');

      await jsonRequest('POST', `${baseUrl}/public/chatbots/${slug}/messages`, { sessionId, message: '이해할 수 없는 질문 3' });
      expect(await alertAfterLogs('WARNING')).toBe('WARNING');
    });

    it('금지어 BLOCK 턴은 연속 미응답을 끊지도 늘리지도 않는다(중립) — 경고 유지', async () => {
      const { chatbotId, slug } = await setupHandoffChatbot({ cautionThreshold: 1, warningThreshold: 3 });
      const sessionId = randomUUID();
      await jsonRequest('POST', `${baseUrl}/banned-words`, { word: `중립금지어${Math.random().toString(36).slice(2, 6)}`, matchType: 'CONTAINS', policy: 'BLOCK' }, { cookie: adminCookie });
      const wordListRes = await jsonRequest<{ items: Array<{ word: string }> }>('GET', `${baseUrl}/banned-words`, undefined, { cookie: adminCookie });
      const word = wordListRes.body.items[wordListRes.body.items.length - 1].word;

      await jsonRequest('POST', `${baseUrl}/public/chatbots/${slug}/messages`, { sessionId, message: '이해할 수 없는 질문 1' });
      await jsonRequest('POST', `${baseUrl}/public/chatbots/${slug}/messages`, { sessionId, message: '이해할 수 없는 질문 2' });
      await jsonRequest('POST', `${baseUrl}/public/chatbots/${slug}/messages`, { sessionId, message: `${word} 포함` });
      await jsonRequest('POST', `${baseUrl}/public/chatbots/${slug}/messages`, { sessionId, message: '이해할 수 없는 질문 3' });

      // 대화로그 적재가 응답과 비동기(fire-and-forget)라 병렬 부하에서는 마지막 턴이 늦게 보일 수 있다 —
      // 기대 상태가 될 때까지 짧게 폴링한다(최대 3초). 끝까지 안 되면 마지막 응답으로 아래 단언이 실패한다.
      type Row = { alertLevel: string; consecutiveUnanswered: number; blockedCount: number };
      let list = await jsonRequest<{ items: Row[] }>('GET', `${baseUrl}/chatbots/${chatbotId}/live-sessions`, undefined, { cookie: adminCookie });
      for (let i = 0; i < 30; i += 1) {
        const row = list.body.items?.[0];
        if (row && row.blockedCount === 1 && row.consecutiveUnanswered === 3) break;
        await new Promise((r) => setTimeout(r, 100));
        list = await jsonRequest<{ items: Row[] }>('GET', `${baseUrl}/chatbots/${chatbotId}/live-sessions`, undefined, { cookie: adminCookie });
      }
      // BLOCK 턴 1건은 세지도 끊지도 않는다 — 미응답 3건(1,2,3)이 연속으로 인정돼 WARNING까지 오른다.
      expect(list.body.items[0].consecutiveUnanswered).toBe(3);
      expect(list.body.items[0].blockedCount).toBe(1);
      expect(list.body.items[0].alertLevel).toBe('WARNING');
    });
  });

  /* ==========================================================================================
   * 7. 타임아웃·종료
   * ======================================================================================== */
  describe('7. 타임아웃·종료', () => {
    it('상담원 무응답 5분(첫 응답 전) — 조회 시점 판정(GET 폴링)과 sweeper.tick() 결과가 일치한다', async () => {
      const { chatbotId, slug } = await setupHandoffChatbot({ agentNoReplyMinutes: 5 });
      const { sessionId, handoffId } = await connectHandoffWithRawMessage(chatbotId, slug);

      const longAgo = new Date(Date.now() - 6 * 60_000);
      // AGENT_NO_REPLY 판정은 connectedAt이 아니라 startedAt 기준이다(handoff-expiry.ts `nowMs - row.startedAt`).
      await prisma.handoffSession.update({ where: { id: handoffId }, data: { startedAt: longAgo, connectedAt: longAgo, firstAgentReplyAt: null } });

      // 조회(공개 폴링)가 먼저 종료를 판정한다.
      const pollRes = await jsonRequest<{ status: string }>('GET', `${baseUrl}/public/chatbots/${slug}/handoff?after=0`, undefined, { headers: { [HANDOFF_SESSION_HEADER]: sessionId } });
      expect(pollRes.status).toBe(200);

      const afterPoll = await prisma.handoffSession.findUniqueOrThrow({ where: { id: handoffId } });
      expect(afterPoll.status).toBe('ENDED');
      expect(afterPoll.endReason).toBe('AGENT_NO_REPLY');

      // sweeper를 다시 돌려도 같은 결과(멱등, 이미 ENDED라 재판정하지 않는다).
      await sweeper.tick();
      const afterSweep = await prisma.handoffSession.findUniqueOrThrow({ where: { id: handoffId } });
      expect(afterSweep.status).toBe('ENDED');
      expect(afterSweep.endReason).toBe('AGENT_NO_REPLY');
    });

    it('종료된 상담에 다시 전송·종료를 시도하면 409 HANDOFF_NOT_ACTIVE다(중복 종료 방지)', async () => {
      const { chatbotId, slug } = await setupHandoffChatbot();
      const { handoffId } = await connectHandoffWithRawMessage(chatbotId, slug);
      await jsonRequest('POST', `${baseUrl}/chatbots/${chatbotId}/handoffs/${handoffId}/end`, {}, { cookie: agentCookie });

      const endAgain = await jsonRequest('POST', `${baseUrl}/chatbots/${chatbotId}/handoffs/${handoffId}/end`, {}, { cookie: agentCookie });
      expect(endAgain.status).toBe(409);
      const sendAfterEnd = await jsonRequest('POST', `${baseUrl}/chatbots/${chatbotId}/handoffs/${handoffId}/messages`, { text: '이미 끝났는데' }, { cookie: agentCookie });
      expect(sendAfterEnd.status).toBe(409);
    });

    it('종료 후 대화 보기의 endButtonLabel/endButtonNodeId가 지정돼 있으면 위젯이 이동 노드로 쓸 라벨을 그대로 돌려준다', async () => {
      const { chatbotId, slug } = await setupHandoffChatbot();
      const nodeRes = await jsonRequest<{ id: string }>('POST', `${baseUrl}/chatbots/${chatbotId}/dialog-nodes`, {
        name: '만족도 설문 노드',
        nodeType: 'START',
        outputs: [{ type: 'TEXT', payload: { text: '설문 시작' } }],
      }, { cookie: adminCookie });
      await jsonRequest('PUT', `${baseUrl}/chatbots/${chatbotId}/handoff-settings`, { ...DEFAULT_SETTINGS, endButtonLabel: '설문 참여', endButtonNodeId: nodeRes.body.id }, { cookie: adminCookie });

      const { handoffId } = await connectHandoffWithRawMessage(chatbotId, slug);
      const endRes = await jsonRequest<{ endButtonLabel: string | null }>('POST', `${baseUrl}/chatbots/${chatbotId}/handoffs/${handoffId}/end`, {}, { cookie: agentCookie });
      expect(endRes.body.endButtonLabel).toBe('설문 참여');
    });
  });

  /* ==========================================================================================
   * 8. 통계 격리
   * ======================================================================================== */
  describe('8. 통계 격리', () => {
    it('상담 구간 사용자 턴(handoffTurn=true)은 질문 순위(/stats/questions)에서 제외된다', async () => {
      const { chatbotId, slug } = await setupHandoffChatbot();
      const uniquePhrase = `상담중전용문장${Math.random().toString(36).slice(2, 8)}`;
      const { sessionId } = await connectHandoffWithRawMessage(chatbotId, slug, { text: uniquePhrase });

      // 상담 중 문장이 실제로 handoffTurn=true로 적재됐는지 먼저 확인.
      const handoffLog = await prisma.conversationLog.findFirst({ where: { chatbotId, handoffTurn: true } });
      expect(handoffLog).not.toBeNull();

      const res = await jsonRequest<{ topQuestions: Array<{ question: string }> }>('GET', `${baseUrl}/stats/questions?chatbotId=${chatbotId}&topN=50`, undefined, { cookie: adminCookie });
      expect(res.status).toBe(200);
      expect(res.body.topQuestions.some((i) => i.question.includes(uniquePhrase))).toBe(false);
      void sessionId;
    });

    it('상담 이력 요약(summary)의 건수·평균 첫 응답·평균 상담시간이 실제 고정 픽스처와 일치한다', async () => {
      const { chatbotId, slug } = await setupHandoffChatbot();
      const { handoffId } = await connectHandoffWithRawMessage(chatbotId, slug);

      // 첫 응답까지 30초, 상담 지속 60초가 되도록 시각을 고정한다.
      const connectedAt = new Date(Date.now() - 120_000);
      const firstAgentReplyAt = new Date(connectedAt.getTime() + 30_000);
      const endedAt = new Date(connectedAt.getTime() + 60_000);
      await prisma.handoffSession.update({
        where: { id: handoffId },
        data: { connectedAt, firstAgentReplyAt, status: 'ENDED', endedAt, endReason: 'AGENT_ENDED' },
      });

      // 로컬 UTC "오늘"이 아니라 실제 적재된 dayBucket(KST)을 그대로 쓴다 — UTC/KST 자정 경계에서
      // 어긋나 요약이 0건으로 나오는 것을 방지한다.
      const savedRow = await prisma.handoffSession.findUniqueOrThrow({ where: { id: handoffId } });
      const today = savedRow.dayBucket;
      const summaryRes = await jsonRequest<{ count: number; connectedCount: number; avgFirstResponseSec: number | null; avgDurationSec: number | null }>(
        'GET',
        `${baseUrl}/chatbots/${chatbotId}/handoffs/summary?from=${today}&to=${today}`,
        undefined,
        { cookie: adminCookie },
      );
      expect(summaryRes.status).toBe(200);
      expect(summaryRes.body.count).toBeGreaterThanOrEqual(1);
      expect(summaryRes.body.connectedCount).toBeGreaterThanOrEqual(1);
      expect(summaryRes.body.avgFirstResponseSec).toBeCloseTo(30, 0);
      expect(summaryRes.body.avgDurationSec).toBeCloseTo(60, 0);
    });
  });

  /* ==========================================================================================
   * 9. 권한 매트릭스 — 관리자 API 21개 중 관리자 스코프 20개 전수(공개 폴링 1개는 별도 절에서 검증)
   * ======================================================================================== */
  describe('9. 권한 매트릭스', () => {
    it('비로그인은 모든 상담 API에서 401이다', async () => {
      const { chatbotId } = await setupHandoffChatbot();
      const targets: Array<[string, string]> = [
        ['GET', `${baseUrl}/chatbots/${chatbotId}/live-sessions`],
        ['GET', `${baseUrl}/chatbots/${chatbotId}/handoff-settings`],
        ['GET', `${baseUrl}/chatbots/${chatbotId}/canned-responses`],
        ['GET', `${baseUrl}/handoff-console/chatbots`],
      ];
      for (const [method, url] of targets) {
        const res = await jsonRequest(method, url, undefined, { cookie: '' });
        expect({ url, status: res.status }).toEqual({ url, status: 401 });
      }
    });

    it('읽기 전용 cs:read 8경로 — VIEWER는 전부 403, EDITOR·AGENT·ADMIN은 403이 아니다', async () => {
      const { chatbotId, slug } = await setupHandoffChatbot();
      const { sessionRef, handoffId } = await connectHandoffWithRawMessage(chatbotId, slug);
      const today = toKstDayBucket(new Date()); // 이력 기간은 KST 일 기준 — UTC로 자르면 KST 새벽에 빈 목록이 되어 누출 검사가 무의미해진다

      const csReadTargets: Array<[string, string]> = [
        ['GET', `${baseUrl}/chatbots/${chatbotId}/live-sessions`],
        ['GET', `${baseUrl}/chatbots/${chatbotId}/live-sessions/${sessionRef}/transcript`],
        ['GET', `${baseUrl}/chatbots/${chatbotId}/live-sessions/${sessionRef}/hints`],
        ['GET', `${baseUrl}/chatbots/${chatbotId}/handoffs?from=${today}&to=${today}`],
        ['GET', `${baseUrl}/chatbots/${chatbotId}/handoffs/summary?from=${today}&to=${today}`],
        ['GET', `${baseUrl}/chatbots/${chatbotId}/handoffs/canned-responses`],
        ['GET', `${baseUrl}/chatbots/${chatbotId}/handoffs/${handoffId}`],
        ['GET', `${baseUrl}/handoff-console/chatbots`],
      ];
      for (const [method, url] of csReadTargets) {
        const viewerRes = await jsonRequest(method, url, undefined, { cookie: viewerCookie });
        expect({ url, status: viewerRes.status }).toEqual({ url, status: 403 });
        for (const [role, cookie] of [['EDITOR', editorCookie], ['AGENT', agent2Cookie], ['ADMIN', adminCookie]] as const) {
          const res = await jsonRequest(method, url, undefined, { cookie });
          expect({ url, role, status: res.status }).not.toEqual({ url, role, status: 403 });
        }
      }
    });

    it('cs:write 필요 경로(마스킹 미리보기) — VIEWER·EDITOR는 403, AGENT·ADMIN은 통과한다', async () => {
      const { chatbotId } = await setupHandoffChatbot();
      const url = `${baseUrl}/chatbots/${chatbotId}/handoffs/mask-preview`;
      const viewerRes = await jsonRequest('POST', url, { text: '테스트' }, { cookie: viewerCookie });
      expect(viewerRes.status).toBe(403);
      const editorRes = await jsonRequest('POST', url, { text: '테스트' }, { cookie: editorCookie });
      expect(editorRes.status).toBe(403);
      const agentRes = await jsonRequest('POST', url, { text: '테스트' }, { cookie: agentCookie });
      expect(agentRes.status).toBe(200);
      const adminRes = await jsonRequest('POST', url, { text: '테스트' }, { cookie: adminCookie });
      expect(adminRes.status).toBe(200);
    });

    it('자주 쓰는 문장 — 조회(dialogue:read)는 VIEWER·EDITOR·ADMIN ○/AGENT 403, 쓰기(dialogue:write)는 EDITOR·ADMIN만 ○', async () => {
      const { chatbotId } = await setupHandoffChatbot();
      const listUrl = `${baseUrl}/chatbots/${chatbotId}/canned-responses`;
      expect((await jsonRequest('GET', listUrl, undefined, { cookie: viewerCookie })).status).not.toBe(403);
      expect((await jsonRequest('GET', listUrl, undefined, { cookie: editorCookie })).status).not.toBe(403);
      expect((await jsonRequest('GET', listUrl, undefined, { cookie: adminCookie })).status).not.toBe(403);
      expect((await jsonRequest('GET', listUrl, undefined, { cookie: agentCookie })).status).toBe(403);

      const createBody = { title: '인사', body: '안녕하세요, 무엇을 도와드릴까요?' };
      expect((await jsonRequest('POST', listUrl, createBody, { cookie: viewerCookie })).status).toBe(403);
      expect((await jsonRequest('POST', listUrl, createBody, { cookie: agentCookie })).status).toBe(403);
      const created = await jsonRequest<{ id: string }>('POST', listUrl, createBody, { cookie: editorCookie });
      expect(created.status).toBe(201);

      const patchUrl = `${listUrl}/${created.body.id}`;
      expect((await jsonRequest('PATCH', patchUrl, { title: '변경' }, { cookie: viewerCookie })).status).toBe(403);
      expect((await jsonRequest('PATCH', patchUrl, { title: '변경' }, { cookie: editorCookie })).status).toBe(200);

      expect((await jsonRequest('POST', `${patchUrl}/move`, { direction: 'UP' }, { cookie: viewerCookie })).status).toBe(403);
      expect((await jsonRequest('DELETE', patchUrl, undefined, { cookie: viewerCookie })).status).toBe(403);
      expect((await jsonRequest('DELETE', patchUrl, undefined, { cookie: editorCookie })).status).toBe(204);
    });

    it('상담 설정 — 조회는 chatbot:read(VIEWER 포함 전원 ○), 저장은 chatbot:write(EDITOR·ADMIN만 ○)', async () => {
      const { chatbotId } = await setupHandoffChatbot();
      const getUrl = `${baseUrl}/chatbots/${chatbotId}/handoff-settings`;
      expect((await jsonRequest('GET', getUrl, undefined, { cookie: viewerCookie })).status).toBe(200);
      expect((await jsonRequest('GET', getUrl, undefined, { cookie: agentCookie })).status).toBe(200);

      expect((await jsonRequest('PUT', getUrl, DEFAULT_SETTINGS, { cookie: viewerCookie })).status).toBe(403);
      expect((await jsonRequest('PUT', getUrl, DEFAULT_SETTINGS, { cookie: agentCookie })).status).toBe(403);
      expect((await jsonRequest('PUT', getUrl, DEFAULT_SETTINGS, { cookie: editorCookie })).status).toBe(200);
    });
  });

  /* ==========================================================================================
   * 10. 응답 힌트
   * ======================================================================================== */
  describe('10. 응답 힌트', () => {
    it('임베딩이 꺼져 있으면(semanticEnabled 기본 false) 문자 유사도(LEXICAL) 폴백으로 FAQ·자주 쓰는 문장이 상위 3개까지 나온다', async () => {
      const { chatbotId, slug } = await setupHandoffChatbot();
      await jsonRequest('POST', `${baseUrl}/chatbots/${chatbotId}/faqs`, { category: 'FAQ', question: '주문 조회 방법을 알려주세요', answer: '주문 조회는 마이페이지에서 가능합니다.' }, { cookie: adminCookie });
      await jsonRequest('POST', `${baseUrl}/chatbots/${chatbotId}/canned-responses`, { title: '주문조회안내', body: '주문 조회는 마이페이지 > 주문내역에서 확인하실 수 있습니다.' }, { cookie: editorCookie });

      const sessionId = randomUUID();
      await jsonRequest('POST', `${baseUrl}/public/chatbots/${slug}/messages`, { sessionId, message: '주문 조회 방법 알려주세요' });
      const sessionRef = await getSessionRef(chatbotId);
      await jsonRequest('POST', `${baseUrl}/chatbots/${chatbotId}/live-sessions/${sessionRef}/handoff`, {}, { cookie: agentCookie });

      const hintsRes = await jsonRequest<{ mode: string; answers: unknown[]; canned: unknown[] }>('GET', `${baseUrl}/chatbots/${chatbotId}/live-sessions/${sessionRef}/hints`, undefined, {
        cookie: agentCookie,
      });
      expect(hintsRes.status).toBe(200);
      expect(hintsRes.body.mode).toBe('LEXICAL');
      expect(hintsRes.body.answers.length).toBeGreaterThan(0);
      expect(hintsRes.body.answers.length).toBeLessThanOrEqual(3);
      expect(hintsRes.body.canned.length).toBeGreaterThan(0);
      expect(hintsRes.body.canned.length).toBeLessThanOrEqual(3);
    });

    it('같은 발화에 대한 반복 조회는 캐시로 응답하고 추가 DB 조회(cannedResponse.findMany)를 만들지 않는다', async () => {
      const { chatbotId, slug } = await setupHandoffChatbot();
      await jsonRequest('POST', `${baseUrl}/chatbots/${chatbotId}/canned-responses`, { title: '안내', body: '안녕하세요 무엇을 도와드릴까요' }, { cookie: editorCookie });

      const sessionId = randomUUID();
      await jsonRequest('POST', `${baseUrl}/public/chatbots/${slug}/messages`, { sessionId, message: '문의드립니다' });
      const sessionRef = await getSessionRef(chatbotId);
      await jsonRequest('POST', `${baseUrl}/chatbots/${chatbotId}/live-sessions/${sessionRef}/handoff`, {}, { cookie: agentCookie });

      const spy = jest.spyOn(prisma.cannedResponse, 'findMany');
      const url = `${baseUrl}/chatbots/${chatbotId}/live-sessions/${sessionRef}/hints`;
      await jsonRequest('GET', url, undefined, { cookie: agentCookie });
      const callsAfterFirst = spy.mock.calls.length;
      expect(callsAfterFirst).toBeGreaterThan(0);
      await jsonRequest('GET', url, undefined, { cookie: agentCookie });
      expect(spy.mock.calls.length).toBe(callsAfterFirst); // 2번째 호출은 메모 캐시 적중 — 추가 조회 0.
      spy.mockRestore();
      void hintsService;
    });
  });

  /* ==========================================================================================
   * 11. 영구삭제 사전검사 13종 · 12. 챗봇 복사 · 버전 스냅샷 제외
   * ======================================================================================== */
  describe('11~12. 영구삭제 사전검사·복사·버전 스냅샷', () => {
    it('영구삭제 사전검사는 13종 전부를 본다 — 상담·자주 쓰는 문장만 있어도 409 상세에 각각 라벨이 뜬다', async () => {
      const { chatbotId, slug } = await setupHandoffChatbot();
      await jsonRequest('POST', `${baseUrl}/chatbots/${chatbotId}/canned-responses`, { title: '안내', body: '안내문' }, { cookie: editorCookie });
      await connectHandoffWithRawMessage(chatbotId, slug);

      await jsonRequest('PATCH', `${baseUrl}/chatbots/${chatbotId}/status`, { status: 'ARCHIVED' }, { cookie: adminCookie });
      const chatbotRes = await jsonRequest<{ name: string }>('GET', `${baseUrl}/chatbots/${chatbotId}`, undefined, { cookie: adminCookie });
      const purgeRes = await jsonRequest<{ message?: string }>('POST', `${baseUrl}/chatbots/${chatbotId}/permanent-delete`, { confirmName: chatbotRes.body.name }, { cookie: adminCookie });
      expect(purgeRes.status).toBe(409);
      expect(purgeRes.body.message).toMatch(/상담/);
      expect(purgeRes.body.message).toMatch(/자주 쓰는 문장/);
    });

    it('챗봇 영구삭제 시 handoffSession·handoffMessage·cannedResponse 삭제는 0행이지만 chatbotHandoffSetting은 함께 삭제된다', async () => {
      const { chatbotId, slug } = await setupHandoffChatbot();
      const { handoffId } = await connectHandoffWithRawMessage(chatbotId, slug);
      await jsonRequest('POST', `${baseUrl}/chatbots/${chatbotId}/handoffs/${handoffId}/end`, {}, { cookie: agentCookie });

      // 상담 기록이 있으므로 사전검사로 막힌다 — 원천 기록이 영구삭제로 소실되지 않는다(H-1/H-8).
      await jsonRequest('PATCH', `${baseUrl}/chatbots/${chatbotId}/status`, { status: 'ARCHIVED' }, { cookie: adminCookie });
      const chatbotRes = await jsonRequest<{ name: string }>('GET', `${baseUrl}/chatbots/${chatbotId}`, undefined, { cookie: adminCookie });
      const purgeRes = await jsonRequest('POST', `${baseUrl}/chatbots/${chatbotId}/permanent-delete`, { confirmName: chatbotRes.body.name }, { cookie: adminCookie });
      expect(purgeRes.status).toBe(409);
      const stillThere = await prisma.handoffSession.findUnique({ where: { id: handoffId } });
      expect(stillThere).not.toBeNull();
    });

    it('챗봇 복사는 자주 쓰는 문장을 복사하지 않는다(원본에만 존재, 복사본은 0건)', async () => {
      const { chatbotId } = await setupHandoffChatbot();
      await jsonRequest('POST', `${baseUrl}/chatbots/${chatbotId}/canned-responses`, { title: '복사안됨문장', body: '이 문장은 복사되지 않아야 한다' }, { cookie: editorCookie });

      const copyRes = await jsonRequest<{ id: string }>('POST', `${baseUrl}/chatbots/${chatbotId}/copy`, {}, { cookie: adminCookie });
      expect(copyRes.status).toBe(201);
      const copiedCanned = await prisma.cannedResponse.count({ where: { chatbotId: copyRes.body.id } });
      expect(copiedCanned).toBe(0);
    });

    it('버전 스냅샷 diff는 상담 설정 변경을 "변경 없음"으로 본다(스냅샷 대상 아님) — 실제 콘텐츠 변경을 곁들인 복원도 상담 설정은 건드리지 않는다', async () => {
      const { chatbotId } = await setupHandoffChatbot({ warningThreshold: 7, cautionThreshold: 4 });
      const beforeSettings = await jsonRequest<{ warningThreshold: number }>('GET', `${baseUrl}/chatbots/${chatbotId}/handoff-settings`, undefined, { cookie: adminCookie });
      expect(beforeSettings.body.warningThreshold).toBe(7);

      const captureRes = await jsonRequest<{ unchanged: boolean; version?: { id: string } }>('POST', `${baseUrl}/chatbots/${chatbotId}/versions`, { label: '상담설정 회귀 스냅샷' }, { cookie: editorCookie });
      expect(captureRes.status).toBe(201);
      const versionId = captureRes.body.version!.id;

      // 캡처 직후 상담 설정만 바꾸면 diff가 "변경 없음"(identical)이다 — 스냅샷 대상이 아니라는
      // 직접 증거다(디버그 확인: blockers=[{code:'NO_CHANGES'}], restorable=false).
      await jsonRequest('PUT', `${baseUrl}/chatbots/${chatbotId}/handoff-settings`, { ...DEFAULT_SETTINGS, warningThreshold: 9, cautionThreshold: 8 }, { cookie: adminCookie });
      const settingsOnlyPreview = await jsonRequest<{ diffSummary: { identical: boolean }; restorable: boolean; blockers: Array<{ code: string }> }>(
        'POST',
        `${baseUrl}/chatbots/${chatbotId}/versions/${versionId}/restore/preview`,
        {},
        { cookie: editorCookie },
      );
      expect(settingsOnlyPreview.status).toBe(200);
      expect(settingsOnlyPreview.body.diffSummary.identical).toBe(true);
      expect(settingsOnlyPreview.body.restorable).toBe(false);
      expect(settingsOnlyPreview.body.blockers.some((b) => b.code === 'NO_CHANGES')).toBe(true);

      // 이제 실제 콘텐츠(FAQ)도 바꿔 diff가 실질적으로 생기게 하고, 복원이 정말 실행되게 한다.
      await jsonRequest('POST', `${baseUrl}/chatbots/${chatbotId}/faqs`, { category: 'FAQ', question: '스냅샷 이후 추가된 질문', answer: '복원되면 사라져야 하는 답' }, { cookie: adminCookie });

      const preview = await jsonRequest<{ currentContentHash: string; diffSummary: { identical: boolean }; restorable: boolean }>(
        'POST',
        `${baseUrl}/chatbots/${chatbotId}/versions/${versionId}/restore/preview`,
        {},
        { cookie: editorCookie },
      );
      expect(preview.status).toBe(200);
      expect(preview.body.diffSummary.identical).toBe(false);
      expect(preview.body.restorable).toBe(true);

      // 운영 중(ACTIVE)인 챗봇 복원은 영향 확인 체크(acknowledgeActive)가 필요하다.
      const restoreRes = await jsonRequest(
        'POST',
        `${baseUrl}/chatbots/${chatbotId}/versions/${versionId}/restore`,
        { expectedCurrentHash: preview.body.currentContentHash, acknowledgeActive: true },
        { cookie: editorCookie },
      );
      expect(restoreRes.status).toBe(200);

      // FAQ(실제 콘텐츠)는 복원으로 사라졌어야 한다 — 복원이 실제로 실행됐다는 증거.
      const faqsAfter = await jsonRequest<{ items: Array<{ question: string }> }>('GET', `${baseUrl}/chatbots/${chatbotId}/faqs`, undefined, { cookie: adminCookie });
      expect(faqsAfter.body.items.some((f) => f.question === '스냅샷 이후 추가된 질문')).toBe(false);

      // 그러나 상담 설정(warningThreshold=9)은 스냅샷 시점(7)으로 되돌아가지 않는다(범위 밖 — §9).
      const afterSettings = await jsonRequest<{ warningThreshold: number }>('GET', `${baseUrl}/chatbots/${chatbotId}/handoff-settings`, undefined, { cookie: adminCookie });
      expect(afterSettings.body.warningThreshold).toBe(9);
    });
  });
});
