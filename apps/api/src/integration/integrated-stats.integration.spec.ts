import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import * as http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VersioningType } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import {
  IntegratedBreakdownSchema,
  IntegratedGroupOptionsSchema,
  IntegratedOverviewSchema,
  IntegratedQuestionsSchema,
  IntegratedSummarySchema,
  IntentStatsSchema,
} from '@chat-bot/shared-types';
import { toKstDayBucket, toKstHourOfDay } from '@chat-bot/shared-types';
import { AppModule } from '../app.module';
import { AllExceptionsFilter } from '../common/all-exceptions.filter';
import { PrismaService } from '../prisma/prisma.service';
import { IntegratedSessionQuery } from '../stats/integrated/integrated-session.query';
import { loginAs, seedTestUsers } from './helpers/auth.helper';
import { createConversationLog } from './helpers/conversation-log.helper';

const API_ROOT = join(__dirname, '..', '..');

let authCookie = '';
let viewerCookie = '';

interface ApiResponse<T = unknown> {
  status: number;
  body: T;
}

/**
 * 기본 4번째 인자는 호출 시점의 관리자 쿠키다(하위 호환 — 기존 2/3-인자 호출은 그대로 ADMIN으로 인증된다).
 * `cookie: null`을 명시하면 비로그인 요청(AC-I6-2)을, 다른 역할 쿠키를 넘기면 그 역할로 요청한다.
 */
function jsonRequest<T = unknown>(
  method: string,
  url: string,
  body?: unknown,
  cookie: string | null = authCookie,
): Promise<ApiResponse<T>> {
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
          ...(cookie ? { Cookie: cookie } : {}),
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
 * No.29 통합 통계 통합 테스트(`integrated-stats-설계.md` §14, ADR-0033). AC-I1(보존)·AC-I2(정의 일치)·
 * AC-I3(귀속)·AC-I4(그룹 보관)·EX-I-2(스코프 검증)·No.29 의도별 매칭 핵심 항목을 HTTP 계약 레벨에서 검증한다.
 * 2026-09-24 회차 — 코드리뷰 통과 후 남은 공백(AC-I2-2/3/5/7·AC-I3-2~4·AC-I4 나머지 6경로·AC-I5-1~6·
 * AC-I6-2/6/7)을 채운다. 원본 8건은 수정하지 않고 그대로 유지한다.
 */
describe('통합 통계(No.29) 통합 테스트', () => {
  let app: NestExpressApplication;
  let baseUrl: string;
  let tmpDir: string;
  let prisma: PrismaService;
  let sessionQuery: IntegratedSessionQuery;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'chatbot-integrated-stats-test-'));
    const dbPath = join(tmpDir, 'test.db').replace(/\\/g, '/');
    const testDatabaseUrl = `file:${dbPath}`;

    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.DEPLOY_SCHEDULE_ENABLED = 'false';
    process.env.WIDGET_BASE_URL = process.env.WIDGET_BASE_URL ?? 'http://localhost:5174';
    process.env.PUBLIC_API_BASE_URL = process.env.PUBLIC_API_BASE_URL ?? 'http://localhost:3000/api/v1';

    try {
      execSync('pnpm exec prisma db push --skip-generate --accept-data-loss', {
        cwd: API_ROOT,
        env: { ...process.env, DATABASE_URL: testDatabaseUrl },
        stdio: 'pipe',
      });
    } catch (e) {
      const err = e as { stdout?: Buffer; stderr?: Buffer };
      throw new Error(`prisma db push 실패:\n${err.stdout?.toString()}\n${err.stderr?.toString()}`);
    }

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    app.enableCors();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalFilters(new AllExceptionsFilter());
    prisma = moduleRef.get(PrismaService);
    sessionQuery = moduleRef.get(IntegratedSessionQuery);

    await app.listen(0);
    const server = app.getHttpServer() as http.Server;
    const address = server.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;
    baseUrl = `http://127.0.0.1:${port}/api/v1`;

    await seedTestUsers(prisma);
    authCookie = await loginAs(baseUrl, 'ADMIN');
    viewerCookie = await loginAs(baseUrl, 'VIEWER');
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  async function createGroup(name: string): Promise<string> {
    const res = await jsonRequest<{ id: string }>('POST', `${baseUrl}/chatbot-groups`, { name });
    expect(res.status).toBe(201);
    return res.body.id;
  }

  async function createChatbot(groupId: string): Promise<string> {
    const slug = `is-bot-${Math.random().toString(36).slice(2, 10)}`;
    const res = await jsonRequest<{ id: string }>('POST', `${baseUrl}/chatbots`, { groupId, name: '통합통계 테스트봇', slug });
    expect(res.status).toBe(201);
    return res.body.id;
  }

  function base(chatbotId: string): string {
    return `${baseUrl}/chatbots/${chatbotId}`;
  }

  async function activateChatbot(chatbotId: string): Promise<void> {
    const res = await jsonRequest('PATCH', `${base(chatbotId)}/status`, { status: 'ACTIVE' });
    expect(res.status).toBe(200);
  }

  /** 공개 대화 API를 실제로 태우기 위한 챗봇(ACTIVE + WEB 채널 활성) — stats-learning 스펙과 같은 패턴. */
  async function setupPublicChatbot(groupId?: string): Promise<{ chatbotId: string; slug: string }> {
    const gid = groupId ?? (await createGroup(`공개대화 테스트 그룹 ${Math.random().toString(36).slice(2, 8)}`));
    const chatbotId = await createChatbot(gid);
    await activateChatbot(chatbotId);
    const channelRes = await jsonRequest('PATCH', `${base(chatbotId)}/channels/WEB`, {
      enabled: true,
      config: { allowedOrigins: [], greetingMessage: '무엇을 도와드릴까요?' },
    });
    expect(channelRes.status).toBe(200);
    const slug = (await jsonRequest<{ slug: string }>('GET', base(chatbotId))).body.slug;
    return { chatbotId, slug };
  }

  function sendPublicMessage(slug: string, sessionId: string, message: string) {
    return jsonRequest('POST', `${baseUrl}/public/chatbots/${slug}/messages`, { sessionId, message });
  }

  async function waitForFireAndForget(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  // ================================================================================================
  // AC-I2-1 — 챗봇 1개 그룹 = 챗봇 수치(세션 원시 SQL 경로 vs 앱 폴딩 경로 동치)
  // ================================================================================================
  it('AC-I2-1: 챗봇 1개뿐인 그룹의 통합 요약 총계는 챗봇 스코프 요약 총계와 정확히 일치한다', async () => {
    const groupId = await createGroup('AC-I2-1 그룹');
    const chatbotId = await createChatbot(groupId);

    for (let i = 0; i < 5; i += 1) {
      await createConversationLog(prisma, {
        chatbotId,
        groupId,
        userMessage: `질문${i}`,
        isAnswered: i % 2 === 0,
        sessionId: `sess-${i % 2}`,
      });
    }

    const chatbotRes = await jsonRequest(`GET`, `${baseUrl}/stats/summary?chatbotId=${chatbotId}&granularity=DAY`);
    const groupRes = await jsonRequest(`GET`, `${baseUrl}/stats/integrated/summary?scope=GROUP&groupId=${groupId}&granularity=DAY`);
    expect(chatbotRes.status).toBe(200);
    expect(groupRes.status).toBe(200);

    const chatbotSummary = chatbotRes.body as { totals: Record<string, unknown> };
    const groupSummary = IntegratedSummarySchema.parse(groupRes.body);
    expect(groupSummary.totals.turnCount).toBe(chatbotSummary.totals.turnCount);
    expect(groupSummary.totals.answeredCount).toBe(chatbotSummary.totals.answeredCount);
    expect(groupSummary.totals.sessionCount).toBe(chatbotSummary.totals.sessionCount);
    expect(groupSummary.scope).toBe('GROUP');
    expect(groupSummary.groupId).toBe(groupId);
    expect(groupSummary.backfillPending).toBe(false);
  });

  // ================================================================================================
  // AC-I1-1 — 챗봇을 보관해도 그룹 누적이 유지된다
  // ================================================================================================
  it('AC-I1-1: 챗봇을 보관해도 그룹 통합 통계 누적(overview)은 변하지 않는다', async () => {
    const groupId = await createGroup('AC-I1-1 그룹');
    const chatbotId = await createChatbot(groupId);
    for (let i = 0; i < 3; i += 1) {
      await createConversationLog(prisma, { chatbotId, groupId, userMessage: `보존질문${i}`, isAnswered: true });
    }

    const before = IntegratedOverviewSchema.parse(
      (await jsonRequest(`GET`, `${baseUrl}/stats/integrated/overview?scope=GROUP&groupId=${groupId}`)).body,
    );

    const archiveRes = await jsonRequest('DELETE', `${baseUrl}/chatbots/${chatbotId}`);
    expect(archiveRes.status).toBe(204);

    const after = IntegratedOverviewSchema.parse(
      (await jsonRequest(`GET`, `${baseUrl}/stats/integrated/overview?scope=GROUP&groupId=${groupId}`)).body,
    );

    expect(after.totals.turnCount).toBe(before.totals.turnCount);
    expect(after.totals.answeredCount).toBe(before.totals.answeredCount);
    expect(after.chatbotCounts.archived).toBe(before.chatbotCounts.archived + 1);
  });

  // ================================================================================================
  // AC-I3-1 — 그룹 이동 전후 귀속(이동 전 로그는 이전 그룹에 남는다)
  // ================================================================================================
  it('AC-I3-1: 챗봇을 다른 그룹으로 이동해도 이동 전 로그는 원래 그룹 통계에 남는다', async () => {
    const groupA = await createGroup('AC-I3-1 그룹A');
    const groupB = await createGroup('AC-I3-1 그룹B');
    const chatbotId = await createChatbot(groupA);

    // 이동 전 로그 — groupA 귀속
    await createConversationLog(prisma, { chatbotId, groupId: groupA, userMessage: '이동 전 질문', isAnswered: true });

    const moveRes = await jsonRequest('PATCH', `${baseUrl}/chatbots/${chatbotId}/group`, { groupId: groupB });
    expect(moveRes.status).toBe(200);

    // 이동 후 로그 — groupB 귀속(적재 시점 스냅샷)
    await createConversationLog(prisma, { chatbotId, groupId: groupB, userMessage: '이동 후 질문', isAnswered: true });

    const overviewA = IntegratedOverviewSchema.parse(
      (await jsonRequest(`GET`, `${baseUrl}/stats/integrated/overview?scope=GROUP&groupId=${groupA}`)).body,
    );
    const overviewB = IntegratedOverviewSchema.parse(
      (await jsonRequest(`GET`, `${baseUrl}/stats/integrated/overview?scope=GROUP&groupId=${groupB}`)).body,
    );

    expect(overviewA.totals.turnCount).toBe(1); // 이동 전 로그만
    expect(overviewB.totals.turnCount).toBe(1); // 이동 후 로그만
  });

  // ================================================================================================
  // AC-I3-1 확장 — 실제 공개 대화 API 경유(record() 실호출)로도 같은 귀속 규칙이 성립한다
  // ================================================================================================
  it('AC-I3-1 확장: 실제 공개 대화 API로 보낸 메시지도 그룹 이동 전후로 각각 대화 당시 그룹에 귀속된다', async () => {
    const { chatbotId, slug } = await setupPublicChatbot();
    const originalGroup = await prisma.chatbot.findUniqueOrThrow({ where: { id: chatbotId }, select: { groupId: true } });
    const newGroupId = await createGroup('AC-I3-1 확장 새 그룹');

    const beforeRes = await sendPublicMessage(slug, randomUUID(), '이동 전 공개 대화 질문');
    expect(beforeRes.status).toBe(200);
    await waitForFireAndForget();

    const moveRes = await jsonRequest('PATCH', `${baseUrl}/chatbots/${chatbotId}/group`, { groupId: newGroupId });
    expect(moveRes.status).toBe(200);

    const afterRes = await sendPublicMessage(slug, randomUUID(), '이동 후 공개 대화 질문');
    expect(afterRes.status).toBe(200);
    await waitForFireAndForget();

    const rows = await prisma.conversationLog.findMany({ where: { chatbotId }, orderBy: { createdAt: 'asc' } });
    expect(rows).toHaveLength(2);
    expect(rows[0].groupId).toBe(originalGroup.groupId);
    expect(rows[1].groupId).toBe(newGroupId);

    const beforeGroupOverview = IntegratedOverviewSchema.parse(
      (await jsonRequest('GET', `${baseUrl}/stats/integrated/overview?scope=GROUP&groupId=${originalGroup.groupId}`)).body,
    );
    expect(beforeGroupOverview.totals.turnCount).toBe(1);
    const newGroupOverview = IntegratedOverviewSchema.parse(
      (await jsonRequest('GET', `${baseUrl}/stats/integrated/overview?scope=GROUP&groupId=${newGroupId}`)).body,
    );
    expect(newGroupOverview.totals.turnCount).toBe(1);
  });

  // ================================================================================================
  // AC-I3-2 — record() 처리 중 ChatbotGroup 테이블 추가 조회가 없다(NFR-IP4)
  // ================================================================================================
  it('AC-I3-2: 공개 대화 처리 중 groupId 기록에 ChatbotGroup 추가 조회가 없다(추가 DB 조회 0건)', async () => {
    const { chatbotId, slug } = await setupPublicChatbot();
    const findUniqueSpy = jest.spyOn(prisma.chatbotGroup, 'findUnique');
    const findFirstSpy = jest.spyOn(prisma.chatbotGroup, 'findFirst');
    findUniqueSpy.mockClear();
    findFirstSpy.mockClear();

    try {
      const res = await sendPublicMessage(slug, randomUUID(), 'AC-I3-2 질문');
      expect(res.status).toBe(200);
      await waitForFireAndForget();

      expect(findUniqueSpy).not.toHaveBeenCalled();
      expect(findFirstSpy).not.toHaveBeenCalled();
    } finally {
      findUniqueSpy.mockRestore();
      findFirstSpy.mockRestore();
    }

    const row = await prisma.conversationLog.findFirst({ where: { chatbotId }, orderBy: { createdAt: 'desc' } });
    expect(row?.groupId).toBeTruthy();
  });

  // ================================================================================================
  // AC-I4 — 이력 있는 그룹 삭제 = 보관(물리 삭제 아님)
  // ================================================================================================
  it('AC-I4: 대화로그가 귀속된 빈 그룹을 삭제하면 물리 삭제 대신 보관되고, 목록에서 제외되며 통합 통계는 계속 조회된다', async () => {
    const groupId = await createGroup('AC-I4 보관 대상 그룹');
    const chatbotId = await createChatbot(groupId);
    await createConversationLog(prisma, { chatbotId, groupId, userMessage: '보관 그룹 질문', isAnswered: true });

    // 그룹을 비우기 위해 챗봇을 다른 그룹으로 이동(로그는 groupId 스냅샷이라 그대로 groupId에 남는다)
    const otherGroupId = await createGroup('AC-I4 이동 대상 그룹');
    await jsonRequest('PATCH', `${baseUrl}/chatbots/${chatbotId}/group`, { groupId: otherGroupId });

    const removeRes = await jsonRequest('DELETE', `${baseUrl}/chatbot-groups/${groupId}`);
    expect(removeRes.status).toBe(204);

    // 목록·단건 조회에서 제외(404)
    const getRes = await jsonRequest('GET', `${baseUrl}/chatbot-groups/${groupId}`);
    expect(getRes.status).toBe(404);

    // 통합 통계 스코프 선택기에는 보관됨과 함께 남는다
    const options = IntegratedGroupOptionsSchema.parse((await jsonRequest('GET', `${baseUrl}/stats/integrated/groups`)).body);
    const archivedOption = options.items.find((g) => g.id === groupId);
    expect(archivedOption).toBeDefined();
    expect(archivedOption?.archivedAt).not.toBeNull();

    // 통합 통계 조회는 여전히 허용된다(보관 그룹도 조회 허용)
    const overviewRes = await jsonRequest('GET', `${baseUrl}/stats/integrated/overview?scope=GROUP&groupId=${groupId}`);
    expect(overviewRes.status).toBe(200);
    const overview = IntegratedOverviewSchema.parse(overviewRes.body);
    expect(overview.totals.turnCount).toBe(1);
    expect(overview.group?.archivedAt).not.toBeNull();

    // 보관된 그룹은 새 챗봇 생성 대상에서 제외된다(404)
    const createRes = await jsonRequest('POST', `${baseUrl}/chatbots`, {
      groupId,
      name: '보관 그룹 대상 생성 시도',
      slug: `is-archived-target-${Math.random().toString(36).slice(2, 8)}`,
    });
    expect(createRes.status).toBe(404);
  });

  // ================================================================================================
  // FR-I2-7 — 보관 그룹 대상 지정 나머지 경로(7경로 중 챗봇 생성 외 6개) 전부 404 / 목록 제외
  // ================================================================================================
  it('AC-I4-3 확장: 보관된 그룹은 챗봇 이동·복사 대상 지정과 그룹 자체의 조회·수정·복사에서도 404다(FR-I2-7)', async () => {
    const archivedGroupId = await createGroup('AC-I4-3 보관 예정 그룹');
    const seedChatbotId = await createChatbot(archivedGroupId);
    await createConversationLog(prisma, { chatbotId: seedChatbotId, groupId: archivedGroupId, userMessage: '보관 예정 그룹 질문', isAnswered: true });

    const elsewhereGroupId = await createGroup('AC-I4-3 이동 대상 그룹');
    const moveAwayRes = await jsonRequest('PATCH', `${baseUrl}/chatbots/${seedChatbotId}/group`, { groupId: elsewhereGroupId });
    expect(moveAwayRes.status).toBe(200);

    const removeRes = await jsonRequest('DELETE', `${baseUrl}/chatbot-groups/${archivedGroupId}`);
    expect(removeRes.status).toBe(204);

    // ① 목록(GET /chatbot-groups)에서 제외된다
    const listRes = await jsonRequest<{ items: Array<{ id: string }> }>('GET', `${baseUrl}/chatbot-groups?pageSize=100`);
    expect(listRes.status).toBe(200);
    expect(listRes.body.items.some((g) => g.id === archivedGroupId)).toBe(false);

    // ② 그룹 단건 조회 404
    expect((await jsonRequest('GET', `${baseUrl}/chatbot-groups/${archivedGroupId}`)).status).toBe(404);

    // ③ 그룹 수정 404
    expect((await jsonRequest('PATCH', `${baseUrl}/chatbot-groups/${archivedGroupId}`, { name: '이름 변경 시도' })).status).toBe(404);

    // ④ 그룹 복사(원본이 보관됨) 404
    expect((await jsonRequest('POST', `${baseUrl}/chatbot-groups/${archivedGroupId}/copy`, {})).status).toBe(404);

    // ⑤ 챗봇 생성 대상 그룹 404는 AC-I4 원본 테스트가 이미 확인했다(중복 생략)

    // ⑥ 챗봇 이동 대상 그룹 404
    expect((await jsonRequest('PATCH', `${baseUrl}/chatbots/${seedChatbotId}/group`, { groupId: archivedGroupId })).status).toBe(404);

    // ⑦ 챗봇 복사 대상 그룹(targetGroupId) 404
    const copyRes = await jsonRequest('POST', `${baseUrl}/chatbots/${seedChatbotId}/copy`, { targetGroupId: archivedGroupId });
    expect(copyRes.status).toBe(404);
  });

  // ================================================================================================
  // EX-I-2 — 스코프 검증(GROUP엔 groupId 필수, ALL엔 groupId 금지)
  // ================================================================================================
  it('EX-I-2: scope=GROUP인데 groupId가 없으면 400, scope=ALL인데 groupId가 있으면 400이다', async () => {
    const missingGroupId = await jsonRequest('GET', `${baseUrl}/stats/integrated/overview?scope=GROUP`);
    expect(missingGroupId.status).toBe(400);

    const someGroupId = await createGroup('EX-I-2 그룹');
    const unexpectedGroupId = await jsonRequest('GET', `${baseUrl}/stats/integrated/overview?scope=ALL&groupId=${someGroupId}`);
    expect(unexpectedGroupId.status).toBe(400);
  });

  it('존재하지 않는 groupId는 404다', async () => {
    const res = await jsonRequest('GET', `${baseUrl}/stats/integrated/overview?scope=GROUP&groupId=00000000-0000-0000-0000-000000000000`);
    expect(res.status).toBe(404);
  });

  // ================================================================================================
  // AC-I2-4 — ALL 스코프 기여 표(그룹별)
  // ================================================================================================
  it('AC-I2-4: ALL 스코프 기여 표는 그룹별 턴 수를 담고 share 합은 1이다', async () => {
    const groupId = await createGroup('ALL breakdown 그룹');
    const chatbotId = await createChatbot(groupId);
    await createConversationLog(prisma, { chatbotId, groupId, userMessage: '전역 기여표 질문', isAnswered: true });

    const res = await jsonRequest('GET', `${baseUrl}/stats/integrated/breakdown?scope=ALL`);
    expect(res.status).toBe(200);
    const breakdown = IntegratedBreakdownSchema.parse(res.body);
    expect(breakdown.shareScale).toBe(10000);
    const row = breakdown.items.find((i) => i.kind === 'GROUP' && i.id === groupId);
    expect(row).toBeDefined();
    expect(row!.turnCount).toBeGreaterThanOrEqual(1);

    const shareUnits = Math.round(
      breakdown.items.reduce((s, i) => s + i.share, 0) * 10000 +
        (breakdown.othersRow?.share ?? 0) * 10000 +
        (breakdown.unassignedRow?.share ?? 0) * 10000,
    );
    // 로그가 하나도 없으면(total=0) allocateShares는 전부 0 — 이 스펙에서는 로그가 있으므로 10000이어야 한다.
    expect(shareUnits).toBe(10000);
  });

  // ================================================================================================
  // AC-I2-2 — 그룹 내 챗봇 A+B 합산 · 세션은 챗봇 간 공유되지 않는다(FR-I3-7)
  // ================================================================================================
  it('AC-I2-2: 그룹 G의 챗봇 A·B 합산이 그룹 요약 총계와 같고, 같은 sessionId 문자열도 챗봇이 다르면 별개 세션으로 계산된다', async () => {
    const groupId = await createGroup('AC-I2-2 그룹');
    const chatbotA = await createChatbot(groupId);
    const chatbotB = await createChatbot(groupId);

    // A·B가 같은 세션ID 문자열('s1')을 함께 쓴다 — 위젯이 챗봇별로 세션을 발급하므로 실제 충돌은
    // 없지만, 집계 로직이 chatbotId를 세션 키에 포함하는지(§5.3)를 이 케이스가 검증한다.
    await createConversationLog(prisma, { chatbotId: chatbotA, groupId, userMessage: 'A1', isAnswered: true, sessionId: 's1' });
    await createConversationLog(prisma, { chatbotId: chatbotA, groupId, userMessage: 'A2', isAnswered: false, sessionId: 's1' });
    await createConversationLog(prisma, { chatbotId: chatbotB, groupId, userMessage: 'B1', isAnswered: true, sessionId: 's1' });
    await createConversationLog(prisma, { chatbotId: chatbotB, groupId, userMessage: 'B2', isAnswered: true, sessionId: 's2' });
    await createConversationLog(prisma, { chatbotId: chatbotB, groupId, userMessage: 'B3', isAnswered: true, sessionId: 's2' });

    const res = await jsonRequest('GET', `${baseUrl}/stats/integrated/summary?scope=GROUP&groupId=${groupId}&granularity=DAY`);
    expect(res.status).toBe(200);
    const summary = IntegratedSummarySchema.parse(res.body);
    expect(summary.totals.turnCount).toBe(5);
    expect(summary.totals.answeredCount).toBe(4);
    // 세션 = A의 's1'(1) + B의 's1','s2'(2) = 3 — 챗봇 간 세션ID 재사용은 별개로 집계된다.
    expect(summary.totals.sessionCount).toBe(3);
  });

  // ================================================================================================
  // AC-I2-3 — 자정을 넘긴 세션은 주 단위 집계에서 1회만 반영된다(DD-61)
  // ================================================================================================
  it('AC-I2-3: 자정을 넘긴 세션 1개는 일 버킷 2곳에 걸치지만 주 단위 요약에서는 세션 1회로 집계된다', async () => {
    const groupId = await createGroup('AC-I2-3 그룹');
    const chatbotId = await createChatbot(groupId);

    // 2026-09-14(월) 23:50 KST = UTC 14:50, 2026-09-15(화) 00:10 KST = UTC(전일) 15:10 — 같은 ISO 주(W38).
    await createConversationLog(prisma, {
      chatbotId,
      groupId,
      userMessage: '자정 전 발화',
      isAnswered: true,
      sessionId: 'midnight-session',
      createdAt: new Date('2026-09-14T14:50:00.000Z'),
    });
    await createConversationLog(prisma, {
      chatbotId,
      groupId,
      userMessage: '자정 후 발화',
      isAnswered: true,
      sessionId: 'midnight-session',
      createdAt: new Date('2026-09-14T15:10:00.000Z'),
    });

    const res = await jsonRequest(
      'GET',
      `${baseUrl}/stats/integrated/summary?scope=GROUP&groupId=${groupId}&granularity=WEEK&from=2026-09-14&to=2026-09-20`,
    );
    expect(res.status).toBe(200);
    const summary = IntegratedSummarySchema.parse(res.body);
    expect(summary.totals.turnCount).toBe(2);
    // 기간 전체 세션 총계 — 1개 세션만 존재(자정을 넘겨도 세션은 1개).
    expect(summary.totals.sessionCount).toBe(1);
    const weekBucket = summary.buckets.find((b) => b.turnCount === 2);
    expect(weekBucket).toBeDefined();
    expect(weekBucket!.sessionCount).toBe(1);
  });

  // ================================================================================================
  // AC-I2-5 — 로그 0건 그룹의 누적 KPI는 오류가 아니라 전부 0이다
  // ================================================================================================
  it('AC-I2-5: 로그 0건 그룹의 누적 KPI는 전부 0이고 firstDayBucket은 null이며 응답률도 0이다(오류 아님)', async () => {
    const groupId = await createGroup('AC-I2-5 빈 그룹');
    const res = await jsonRequest('GET', `${baseUrl}/stats/integrated/overview?scope=GROUP&groupId=${groupId}`);
    expect(res.status).toBe(200);
    const overview = IntegratedOverviewSchema.parse(res.body);
    expect(overview.totals.turnCount).toBe(0);
    expect(overview.totals.responseRate).toBe(0);
    expect(overview.totals.sessionCount).toBe(0);
    expect(overview.firstDayBucket).toBeNull();
    expect(overview.chatbotCounts).toEqual({ active: 0, draft: 0, archived: 0 });
  });

  // ================================================================================================
  // AC-I2-7 — 챗봇 200개 초과 그룹은 상위 200행 + "기타 n개" 합산 행으로 접힌다(turn 합 보존)
  // ================================================================================================
  it(
    'AC-I2-7: 챗봇 205개인 그룹의 기여 표는 200행 + 기타 5개 합산 행이고, 총합은 그룹 전체 턴 수와 같다',
    async () => {
      const groupId = await createGroup('AC-I2-7 대형 그룹');
      const chatbotIds = Array.from({ length: 205 }, () => randomUUID());
      const suffix = Math.random().toString(36).slice(2, 8);

      await prisma.chatbot.createMany({
        data: chatbotIds.map((id, i) => ({ id, groupId, name: `기여봇${i}`, slug: `ac-i2-7-${suffix}-${i}` })),
      });

      const now = new Date();
      await prisma.conversationLog.createMany({
        data: chatbotIds.map((id) => ({
          chatbotId: id,
          groupId,
          channelType: 'WEB',
          userMessage: 'AC-I2-7 질문',
          botResponse: '안내',
          isAnswered: true,
          dayBucket: toKstDayBucket(now),
          hourBucket: toKstHourOfDay(now),
          createdAt: now,
        })),
      });

      const res = await jsonRequest('GET', `${baseUrl}/stats/integrated/breakdown?scope=GROUP&groupId=${groupId}`);
      expect(res.status).toBe(200);
      const breakdown = IntegratedBreakdownSchema.parse(res.body);
      expect(breakdown.items).toHaveLength(200);
      expect(breakdown.othersRow).not.toBeNull();
      expect(breakdown.othersRow!.count).toBe(5);

      const totalTurns = breakdown.items.reduce((s, i) => s + i.turnCount, 0) + (breakdown.othersRow?.turnCount ?? 0);
      expect(totalTurns).toBe(205);
      expect(breakdown.totals.turnCount).toBe(205);
    },
    20_000,
  );

  // ================================================================================================
  // AC-I5-1 — 공백 변형만 다른 같은 질문은 그룹 순위에서 1행으로 병합되고 최다 챗봇이 표시된다
  // ================================================================================================
  it('AC-I5-1: 그룹 내 서로 다른 챗봇에 공백 변형만 다른 같은 질문이 오면 1행으로 병합되고 최다 챗봇이 표시된다', async () => {
    const groupId = await createGroup('AC-I5-1 그룹');
    const chatbotA = await createChatbot(groupId);
    const chatbotB = await createChatbot(groupId);

    await createConversationLog(prisma, { chatbotId: chatbotA, groupId, userMessage: '환불 어떻게 하나요', isAnswered: true });
    await createConversationLog(prisma, { chatbotId: chatbotA, groupId, userMessage: ' 환불 어떻게 하나요 ', isAnswered: true });
    await createConversationLog(prisma, { chatbotId: chatbotA, groupId, userMessage: '환불  어떻게  하나요', isAnswered: true });
    await createConversationLog(prisma, { chatbotId: chatbotB, groupId, userMessage: '환불 어떻게 하나요', isAnswered: true });

    const res = await jsonRequest('GET', `${baseUrl}/stats/integrated/questions?scope=GROUP&groupId=${groupId}`);
    expect(res.status).toBe(200);
    const parsed = IntegratedQuestionsSchema.parse(res.body);
    const merged = parsed.topQuestions.find((q) => q.count === 4);
    expect(merged).toBeDefined();
    expect(merged?.topChatbotId).toBe(chatbotA);
  });

  // ================================================================================================
  // AC-I5-2 — includeArchivedChatbots=false는 질문 순위에만 영향, 누적·요약은 불변(J-9)
  // ================================================================================================
  it('AC-I5-2: includeArchivedChatbots=false는 보관 챗봇 질문을 제외하지만 누적 KPI는 영향받지 않는다', async () => {
    const groupId = await createGroup('AC-I5-2 그룹');
    const activeBot = await createChatbot(groupId);
    const archivedBot = await createChatbot(groupId);
    await createConversationLog(prisma, { chatbotId: activeBot, groupId, userMessage: '운영중 질문', isAnswered: true });
    await createConversationLog(prisma, { chatbotId: archivedBot, groupId, userMessage: '보관챗봇전용질문', isAnswered: true });
    const archiveRes = await jsonRequest('DELETE', `${baseUrl}/chatbots/${archivedBot}`);
    expect(archiveRes.status).toBe(204);

    const includeRes = await jsonRequest('GET', `${baseUrl}/stats/integrated/questions?scope=GROUP&groupId=${groupId}`);
    const includeParsed = IntegratedQuestionsSchema.parse(includeRes.body);
    expect(includeParsed.includeArchivedChatbots).toBe(true);
    expect(includeParsed.topQuestions.some((q) => q.question.includes('보관챗봇전용질문'))).toBe(true);

    const excludeRes = await jsonRequest(
      'GET',
      `${baseUrl}/stats/integrated/questions?scope=GROUP&groupId=${groupId}&includeArchivedChatbots=false`,
    );
    expect(excludeRes.status).toBe(200);
    const excludeParsed = IntegratedQuestionsSchema.parse(excludeRes.body);
    expect(excludeParsed.includeArchivedChatbots).toBe(false);
    expect(excludeParsed.topQuestions.some((q) => q.question.includes('보관챗봇전용질문'))).toBe(false);

    const overview = IntegratedOverviewSchema.parse(
      (await jsonRequest('GET', `${baseUrl}/stats/integrated/overview?scope=GROUP&groupId=${groupId}`)).body,
    );
    expect(overview.totals.turnCount).toBe(2); // 토글과 무관하게 누적 KPI는 그대로(J-9)
  });

  // ================================================================================================
  // AC-I5-3 — 질문 후보가 500건을 넘으면 approximated:true다(ADR-0004 근사 규약)
  // ================================================================================================
  it(
    'AC-I5-3: 질문 후보가 500건을 넘으면 approximated:true다',
    async () => {
      const groupId = await createGroup('AC-I5-3 그룹');
      const chatbotId = await createChatbot(groupId);
      const now = new Date();
      await prisma.conversationLog.createMany({
        data: Array.from({ length: 505 }, (_, i) => ({
          chatbotId,
          groupId,
          channelType: 'WEB',
          userMessage: `AC-I5-3 질문 ${i}`,
          botResponse: '안내',
          isAnswered: true,
          dayBucket: toKstDayBucket(now),
          hourBucket: toKstHourOfDay(now),
          createdAt: now,
        })),
      });

      const res = await jsonRequest('GET', `${baseUrl}/stats/integrated/questions?scope=GROUP&groupId=${groupId}`);
      expect(res.status).toBe(200);
      const parsed = IntegratedQuestionsSchema.parse(res.body);
      expect(parsed.approximated).toBe(true);
      expect(parsed.candidateLimit).toBe(500);
    },
    15_000,
  );

  // ================================================================================================
  // AC-I5-4 — 공개 대화로 들어온 전화번호는 그룹 질문 순위에도 마스킹된 형태로만 나타난다(ADR-0013)
  // ================================================================================================
  it('AC-I5-4: 공개 대화로 들어온 전화번호는 그룹 질문 순위에 마스킹된 형태로만 나타난다', async () => {
    const { chatbotId, slug } = await setupPublicChatbot();
    const groupRow = await prisma.chatbot.findUniqueOrThrow({ where: { id: chatbotId }, select: { groupId: true } });
    const res0 = await sendPublicMessage(slug, randomUUID(), '010-1234-5678 로 연락 주세요');
    expect(res0.status).toBe(200);
    await waitForFireAndForget();

    const res = await jsonRequest('GET', `${baseUrl}/stats/integrated/questions?scope=GROUP&groupId=${groupRow.groupId}`);
    expect(res.status).toBe(200);
    const parsed = IntegratedQuestionsSchema.parse(res.body);
    const found = parsed.topQuestions.find((q) => q.question.includes('로 연락 주세요'));
    expect(found).toBeDefined();
    expect(found?.question).not.toContain('010-1234-5678');
  });

  // ================================================================================================
  // AC-I5-6 — 의도별 통계는 전체 턴 대비·의도 매칭 턴 대비 두 분모를 함께 반환한다(J-13)
  // ================================================================================================
  it('AC-I5-6: 의도 매칭 70턴·비매칭 30턴이면 두 분모의 비율과 unmatchedTurnCount=30을 반환한다', async () => {
    const groupId = await createGroup('AC-I5-6 그룹');
    const chatbotId = await createChatbot(groupId);
    const intentId = randomUUID();
    const now = new Date();

    await prisma.conversationLog.createMany({
      data: [
        ...Array.from({ length: 70 }, (_, i) => ({
          chatbotId,
          groupId,
          channelType: 'WEB',
          userMessage: `매칭질문${i}`,
          botResponse: '안내',
          isAnswered: true,
          matchedIntentId: intentId,
          dayBucket: toKstDayBucket(now),
          hourBucket: toKstHourOfDay(now),
          createdAt: now,
        })),
        ...Array.from({ length: 30 }, (_, i) => ({
          chatbotId,
          groupId,
          channelType: 'WEB',
          userMessage: `비매칭질문${i}`,
          botResponse: '안내',
          isAnswered: false,
          dayBucket: toKstDayBucket(now),
          hourBucket: toKstHourOfDay(now),
          createdAt: now,
        })),
      ],
    });

    const res = await jsonRequest('GET', `${baseUrl}/stats/intents?chatbotId=${chatbotId}`);
    expect(res.status).toBe(200);
    const parsed = IntentStatsSchema.parse(res.body);
    expect(parsed.totalTurnCount).toBe(100);
    expect(parsed.matchedTurnCount).toBe(70);
    expect(parsed.unmatchedTurnCount).toBe(30);
    const item = parsed.items.find((i) => i.intentId === intentId);
    expect(item?.turnCount).toBe(70);
    expect(item?.shareOfAll).toBeCloseTo(0.7, 5);
    expect(item?.shareOfIntentMatched).toBeCloseTo(1.0, 5);
  });

  // ================================================================================================
  // No.29 §6 — 챗봇 스코프 의도별 매칭(삭제된 의도 표시)
  // ================================================================================================
  it('GET /stats/intents: 의도별 턴 수를 집계하고, 매칭되지 않은 의도 id는 삭제된 의도로 표시한다', async () => {
    const groupId = await createGroup('의도별 매칭 그룹');
    const chatbotId = await createChatbot(groupId);
    const deletedIntentId = '11111111-1111-1111-1111-111111111111';

    await createConversationLog(prisma, { chatbotId, groupId, userMessage: 'A', isAnswered: true, matchedIntentId: deletedIntentId });
    await createConversationLog(prisma, { chatbotId, groupId, userMessage: 'B', isAnswered: false });

    const res = await jsonRequest('GET', `${baseUrl}/stats/intents?chatbotId=${chatbotId}`);
    expect(res.status).toBe(200);
    const parsed = IntentStatsSchema.parse(res.body);
    expect(parsed.totalTurnCount).toBe(2);
    expect(parsed.unmatchedTurnCount).toBe(1);
    expect(parsed.matchedTurnCount).toBe(1);
    const item = parsed.items.find((i) => i.intentId === deletedIntentId);
    expect(item?.deleted).toBe(true);
    expect(item?.name).toBeNull();
  });

  // ================================================================================================
  // AC-I6-2 — 권한: VIEWER는 조회 200, 비로그인은 401(통합 통계 6종 + /stats/intents)
  // ================================================================================================
  it('AC-I6-2: VIEWER는 통합 통계 6종 + /stats/intents를 200으로 조회하고, 비로그인은 401이다', async () => {
    const groupId = await createGroup('AC-I6-2 그룹');
    const chatbotId = await createChatbot(groupId);
    await createConversationLog(prisma, { chatbotId, groupId, userMessage: '권한확인질문', isAnswered: true });

    const endpoints = [
      `${baseUrl}/stats/integrated/overview?scope=GROUP&groupId=${groupId}`,
      `${baseUrl}/stats/integrated/summary?scope=GROUP&groupId=${groupId}`,
      `${baseUrl}/stats/integrated/distribution?scope=GROUP&groupId=${groupId}`,
      `${baseUrl}/stats/integrated/questions?scope=GROUP&groupId=${groupId}`,
      `${baseUrl}/stats/integrated/breakdown?scope=GROUP&groupId=${groupId}`,
      `${baseUrl}/stats/integrated/groups`,
      `${baseUrl}/stats/intents?chatbotId=${chatbotId}`,
    ];

    for (const url of endpoints) {
      const viewerRes = await jsonRequest('GET', url, undefined, viewerCookie);
      expect(viewerRes.status).toBe(200);
      const anonRes = await jsonRequest('GET', url, undefined, null);
      expect(anonRes.status).toBe(401);
    }
  });

  // ================================================================================================
  // AC-I6-6 — 5초 초과 시 503 AGGREGATION_TIMEOUT(이전 값 반환 금지, FR-I7-3)
  // ================================================================================================
  it(
    'AC-I6-6: 집계가 5초를 넘으면 503 AGGREGATION_TIMEOUT을 반환한다(이전 값 미반환)',
    async () => {
      const groupId = await createGroup('AC-I6-6 그룹');
      const delaySpy = jest
        .spyOn(prisma.conversationLog, 'groupBy')
        .mockImplementationOnce(() => new Promise((resolve) => setTimeout(() => resolve([] as never), 5_500)) as never);

      try {
        const res = await jsonRequest<{ code?: string }>('GET', `${baseUrl}/stats/integrated/overview?scope=GROUP&groupId=${groupId}`);
        expect(res.status).toBe(503);
        expect(res.body.code).toBe('AGGREGATION_TIMEOUT');
      } finally {
        delaySpy.mockRestore();
      }
    },
    15_000,
  );

  // ================================================================================================
  // AC-I6-7 — 세션 조회는 반환 행 수가 세션 수와 무관하다(NFR-IP3 — 앱으로 세션 행을 끌어오지 않는다)
  // ================================================================================================
  it('AC-I6-7: 세션 조회는 세션 수(30개)와 무관하게 버킷 수(2) 이하의 행만 반환한다', async () => {
    const groupId = await createGroup('AC-I6-7 그룹');
    const chatbotId = await createChatbot(groupId);
    const day1 = '2026-05-01';
    const day2 = '2026-05-02';

    await prisma.conversationLog.createMany({
      data: Array.from({ length: 30 }, (_, i) => ({
        chatbotId,
        groupId,
        channelType: 'WEB',
        userMessage: `세션질문${i}`,
        botResponse: '안내',
        isAnswered: true,
        sessionId: `sess-${i}`,
        dayBucket: i % 2 === 0 ? day1 : day2,
        hourBucket: 10,
        createdAt: new Date(`${i % 2 === 0 ? day1 : day2}T01:00:00.000Z`),
      })),
    });

    const result = await sessionQuery.count({
      scope: { scope: 'GROUP', groupId },
      period: { fromDayBucket: day1, toDayBucket: day2 },
      groupBy: 'BUCKET',
      bucketRanges: [
        { key: day1, fromDay: day1, toDay: day1 },
        { key: day2, fromDay: day2, toDay: day2 },
      ],
    });
    expect(result.length).toBeLessThanOrEqual(2); // 세션 30개가 있어도 버킷(2) 이하 행만 반환된다
    const total = result.reduce((s, r) => s + r.distinctSessions + r.nullSessions, 0);
    expect(total).toBe(30);
  });

  // ================================================================================================
  // [신규 2026-09-24 test-automation 회차] §4.9/§9.8 미자동화 목록 보강 — AC-I1-2 · EX-I-6 · EX-I-9 ·
  // EX-I-14 · EX-I-18. EX-I-6은 전역 센티넬(groupId='')을 만들고 백필 스크립트를 직접 실행하므로,
  // AC-I3-3/AC-I3-4(맨 마지막, 전역 부작용 격리)보다 반드시 앞에 두어 잔여 센티넬을 남기지 않는다.
  // ================================================================================================

  it('AC-I1-2: 보관된 챗봇은 기존과 같이 CHATBOT_HAS_CHILDREN 409로 영구삭제가 막히고 안내에 통계 보존 문구(대화로그)가 포함되며, 그룹 누적은 불변이다', async () => {
    const groupId = await createGroup('AC-I1-2 그룹');
    const chatbotId = await createChatbot(groupId);
    for (let i = 0; i < 3; i += 1) {
      await createConversationLog(prisma, { chatbotId, groupId, userMessage: `보존확인질문${i}`, isAnswered: true });
    }

    const archiveRes = await jsonRequest('DELETE', `${baseUrl}/chatbots/${chatbotId}`);
    expect(archiveRes.status).toBe(204);

    const before = IntegratedOverviewSchema.parse(
      (await jsonRequest('GET', `${baseUrl}/stats/integrated/overview?scope=GROUP&groupId=${groupId}`)).body,
    );

    // createChatbot() 헬퍼가 항상 같은 이름('통합통계 테스트봇')으로 만들므로 confirmName은 그대로 재사용한다.
    const purgeRes = await jsonRequest<{ code: string; message: string }>('POST', `${baseUrl}/chatbots/${chatbotId}/permanent-delete`, {
      confirmName: '통합통계 테스트봇',
    });
    expect(purgeRes.status).toBe(409);
    expect(purgeRes.body.code).toBe('CHATBOT_HAS_CHILDREN');
    expect(purgeRes.body.message).toContain('대화로그'); // 통계 보존 문구(안내에 대화로그 보유 사실이 드러난다)

    const after = IntegratedOverviewSchema.parse(
      (await jsonRequest('GET', `${baseUrl}/stats/integrated/overview?scope=GROUP&groupId=${groupId}`)).body,
    );
    expect(after.totals.turnCount).toBe(before.totals.turnCount);
    expect(after.chatbotCounts.archived).toBe(before.chatbotCounts.archived);
  });

  it('EX-I-9: 보관 챗봇을 복구(ARCHIVED→DRAFT)해도 통계 수치는 변하지 않는다(상태만 바뀐다)', async () => {
    const groupId = await createGroup('EX-I-9 그룹');
    const chatbotId = await createChatbot(groupId);
    for (let i = 0; i < 2; i += 1) {
      await createConversationLog(prisma, { chatbotId, groupId, userMessage: `복구확인질문${i}`, isAnswered: true });
    }

    const beforeArchive = IntegratedOverviewSchema.parse(
      (await jsonRequest('GET', `${baseUrl}/stats/integrated/overview?scope=GROUP&groupId=${groupId}`)).body,
    );

    const archiveRes = await jsonRequest('DELETE', `${baseUrl}/chatbots/${chatbotId}`);
    expect(archiveRes.status).toBe(204);
    const afterArchive = IntegratedOverviewSchema.parse(
      (await jsonRequest('GET', `${baseUrl}/stats/integrated/overview?scope=GROUP&groupId=${groupId}`)).body,
    );
    expect(afterArchive.totals.turnCount).toBe(beforeArchive.totals.turnCount);
    expect(afterArchive.chatbotCounts.archived).toBe(beforeArchive.chatbotCounts.archived + 1);

    const restoreRes = await jsonRequest('PATCH', `${baseUrl}/chatbots/${chatbotId}/status`, { status: 'DRAFT' });
    expect(restoreRes.status).toBe(200);

    const afterRestore = IntegratedOverviewSchema.parse(
      (await jsonRequest('GET', `${baseUrl}/stats/integrated/overview?scope=GROUP&groupId=${groupId}`)).body,
    );
    // 배지(상태)만 원래대로 돌아갈 뿐 누적 수치는 archive 전/후 내내 그대로다.
    expect(afterRestore.totals.turnCount).toBe(beforeArchive.totals.turnCount);
    expect(afterRestore.chatbotCounts.archived).toBe(beforeArchive.chatbotCounts.archived);
    expect(afterRestore.chatbotCounts.draft).toBe(beforeArchive.chatbotCounts.draft);
  });

  it('EX-I-14: 금지어로 차단된 턴은 차단 수(blockedCount)로 집계되지만 그룹 질문 순위 중 미응답 목록(topUnansweredQuestions)에서는 제외된다', async () => {
    const groupId = await createGroup('EX-I-14 그룹');
    const chatbotId = await createChatbot(groupId);
    await createConversationLog(prisma, { chatbotId, groupId, userMessage: 'EX-I-14 금지어차단질문', isAnswered: false, blockedByFilter: true });
    await createConversationLog(prisma, { chatbotId, groupId, userMessage: 'EX-I-14 일반미응답질문', isAnswered: false, blockedByFilter: false });

    const summaryRes = await jsonRequest('GET', `${baseUrl}/stats/integrated/summary?scope=GROUP&groupId=${groupId}&granularity=DAY`);
    expect(summaryRes.status).toBe(200);
    const summary = IntegratedSummarySchema.parse(summaryRes.body);
    expect(summary.totals.blockedCount).toBe(1); // 차단 수로는 집계된다(No.14 규칙 승계)

    const questionsRes = await jsonRequest('GET', `${baseUrl}/stats/integrated/questions?scope=GROUP&groupId=${groupId}`);
    expect(questionsRes.status).toBe(200);
    const questions = IntegratedQuestionsSchema.parse(questionsRes.body);
    // 전체 질문 순위(topQuestions)에는 차단된 턴도 나타난다 — 미응답 전용 목록에서만 제외된다.
    expect(questions.topQuestions.some((q) => q.question.includes('EX-I-14 금지어차단질문'))).toBe(true);
    expect(questions.topUnansweredQuestions.some((q) => q.question.includes('EX-I-14 금지어차단질문'))).toBe(false);
    expect(questions.topUnansweredQuestions.some((q) => q.question.includes('EX-I-14 일반미응답질문'))).toBe(true);
  });

  it('EX-I-18: 시스템 시계 조작으로 생긴 미래 dayBucket 로그는 기간 필터 밖에서 제외되지만, 누적 KPI에는 포함되고 firstDayBucket(최솟값) 판단에는 영향이 없다', async () => {
    const groupId = await createGroup('EX-I-18 그룹');
    const chatbotId = await createChatbot(groupId);
    const now = new Date();
    await createConversationLog(prisma, { chatbotId, groupId, userMessage: 'EX-I-18 현재질문', isAnswered: true, createdAt: now });
    // 약 400일 뒤(NTP 오조정 등으로 시스템 시계가 미래로 튄 상황을 재현) — 기본 조회 기간(오늘까지로 보정)
    // 밖에 위치하도록 충분히 멀리 잡는다.
    const future = new Date(now.getTime() + 400 * 24 * 60 * 60 * 1000);
    await createConversationLog(prisma, { chatbotId, groupId, userMessage: 'EX-I-18 미래시계질문', isAnswered: true, createdAt: future });

    const overview = IntegratedOverviewSchema.parse(
      (await jsonRequest('GET', `${baseUrl}/stats/integrated/overview?scope=GROUP&groupId=${groupId}`)).body,
    );
    expect(overview.totals.turnCount).toBe(2); // 기간 필터가 없는 누적 KPI에는 미래 로그도 포함된다(J-8 계열)
    expect(overview.firstDayBucket).toBe(toKstDayBucket(now)); // MIN이라 미래 로그가 집계 시작일 판단을 흐리지 않는다

    const summary = IntegratedSummarySchema.parse(
      (await jsonRequest('GET', `${baseUrl}/stats/integrated/summary?scope=GROUP&groupId=${groupId}&granularity=DAY`)).body,
    );
    // 기본 기간은 "오늘까지"로 보정되므로(EX-14-6과 동일 규약) 미래 로그는 요약 집계에서 빠진다.
    expect(summary.totals.turnCount).toBe(1);
  });

  it(
    'EX-I-6: 백필 이전에 이미 그룹 이동이 있었던 챗봇은, 감사 이력(소속 그룹 이동)이 실제로 존재해도 과거 로그가 소급 재구성되지 않고 현재 그룹에만 귀속된다',
    async () => {
      const groupA = await createGroup('EX-I-6 그룹A(과거)');
      const groupB = await createGroup('EX-I-6 그룹B(현재)');
      const chatbotId = await createChatbot(groupA);

      // 마이그레이션 이전 시대의 로그(백필 미완 센티넬) — 실제로는 챗봇이 그룹A 소속이던 시점에 쌓였다.
      const now = new Date();
      await prisma.conversationLog.create({
        data: {
          chatbotId,
          groupId: '',
          channelType: 'WEB',
          userMessage: 'EX-I-6 과거로그',
          botResponse: '안내해 드리겠습니다.',
          isAnswered: true,
          dayBucket: toKstDayBucket(now),
          hourBucket: toKstHourOfDay(now),
          createdAt: now,
        },
      });

      // 실제로 그룹 이동이 일어난다 — 감사로그에 "소속 그룹 이동" 흔적이 남는다(소급 재구성용 재료는 실존한다).
      const moveRes = await jsonRequest('PATCH', `${baseUrl}/chatbots/${chatbotId}/group`, { groupId: groupB });
      expect(moveRes.status).toBe(200);
      const auditRows = await prisma.auditLog.findMany({ where: { chatbotId, summary: '소속 그룹 이동' } });
      expect(auditRows.length).toBeGreaterThan(0);

      execSync('pnpm exec ts-node -r tsconfig-paths/register prisma/scripts/backfill-conversation-group.ts', {
        cwd: API_ROOT,
        env: { ...process.env },
        stdio: 'pipe',
      });

      const backfilled = await prisma.conversationLog.findFirst({ where: { chatbotId, userMessage: 'EX-I-6 과거로그' } });
      // 감사 이력(그룹A 소속이었던 시점)을 재구성하지 않고 현재 소속(그룹B)으로만 채운다는 한계를 그대로 증명한다.
      expect(backfilled?.groupId).toBe(groupB);
      expect(backfilled?.groupId).not.toBe(groupA);

      const overviewA = IntegratedOverviewSchema.parse(
        (await jsonRequest('GET', `${baseUrl}/stats/integrated/overview?scope=GROUP&groupId=${groupA}`)).body,
      );
      const overviewB = IntegratedOverviewSchema.parse(
        (await jsonRequest('GET', `${baseUrl}/stats/integrated/overview?scope=GROUP&groupId=${groupB}`)).body,
      );
      expect(overviewA.totals.turnCount).toBe(0); // 실제로는 그룹A 시절 로그였지만 반영되지 않는다(문서화된 한계 재현)
      expect(overviewB.totals.turnCount).toBe(1);
    },
    30_000, // execSync로 ts-node 스크립트를 기동한다 — 모노레포 병렬 실행(pnpm -r test 등) 시 기본 5초를 넘길 수 있다(AC-I3-3/AC-I3-4 선례와 동일)
  );

  // ================================================================================================
  // AC-I3-3 / AC-I3-4 — backfillPending 전환과 백필 스크립트 멱등성(맨 마지막 — 전역 센티넬 부작용 격리)
  // ================================================================================================
  it(
    'AC-I3-3/AC-I3-4: groupId="" 잔여 로그는 backfillPending을 true로 만들고, 백필 스크립트 실행(2회, 멱등) 후 false가 되며 수치가 증가한다',
    async () => {
      const groupId = await createGroup('AC-I3-3 그룹');
      const chatbotId = await createChatbot(groupId);
      // 정상 경로 로그(귀속 완료)
      await createConversationLog(prisma, { chatbotId, groupId, userMessage: '정상 귀속', isAnswered: true });
      // 백필 미완 센티넬 로그(마이그레이션 이전 상태 재현) — groupId=''을 명시적으로 지정.
      const now = new Date();
      await prisma.conversationLog.create({
        data: {
          chatbotId,
          groupId: '',
          channelType: 'WEB',
          userMessage: '백필대상',
          botResponse: '안내해 드리겠습니다.',
          isAnswered: true,
          dayBucket: toKstDayBucket(now),
          hourBucket: toKstHourOfDay(now),
          createdAt: now,
        },
      });

      const before = IntegratedOverviewSchema.parse(
        (await jsonRequest('GET', `${baseUrl}/stats/integrated/overview?scope=GROUP&groupId=${groupId}`)).body,
      );
      expect(before.backfillPending).toBe(true);
      expect(before.totals.turnCount).toBe(1); // groupId='' 행은 GROUP 스코프 집계에서 아직 빠져 있다

      execSync('pnpm exec ts-node -r tsconfig-paths/register prisma/scripts/backfill-conversation-group.ts', {
        cwd: API_ROOT,
        env: { ...process.env },
        stdio: 'pipe',
      });

      const after = IntegratedOverviewSchema.parse(
        (await jsonRequest('GET', `${baseUrl}/stats/integrated/overview?scope=GROUP&groupId=${groupId}`)).body,
      );
      expect(after.backfillPending).toBe(false);
      expect(after.totals.turnCount).toBe(2);

      // 멱등성(AC-I3-4) — 두 번째 실행은 오류 없이 통과하고 결과가 동일하다.
      execSync('pnpm exec ts-node -r tsconfig-paths/register prisma/scripts/backfill-conversation-group.ts', {
        cwd: API_ROOT,
        env: { ...process.env },
        stdio: 'pipe',
      });
      const afterTwice = IntegratedOverviewSchema.parse(
        (await jsonRequest('GET', `${baseUrl}/stats/integrated/overview?scope=GROUP&groupId=${groupId}`)).body,
      );
      expect(afterTwice.totals.turnCount).toBe(2);
      expect(afterTwice.backfillPending).toBe(false);
    },
    30_000,
  );
});
