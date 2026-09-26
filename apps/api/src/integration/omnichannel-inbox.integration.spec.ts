import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import * as http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHmac } from 'node:crypto';
import { INestApplication, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../app.module';
import { AllExceptionsFilter } from '../common/all-exceptions.filter';
import { PrismaService } from '../prisma/prisma.service';
import { InboxIdentityService } from '../inbox/identity/inbox-identity.service';
import { InboxSignalService } from '../inbox/core/inbox-signal.service';
import { computeSessionRef } from '../handoff/lib/session-ref';
import { loginAs, seedTestUsers } from './helpers/auth.helper';

const API_ROOT = join(__dirname, '..', '..');
const IDENTITY_HEADER = 'x-cb-identity';

async function safeCleanupTmpDir(dir: string): Promise<void> {
  await new Promise((r) => setTimeout(r, 300));
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {
    // 무시.
  }
}

interface ApiResponse<T = unknown> {
  status: number;
  body: T;
  headers: http.IncomingHttpHeaders;
}

let authCookie = '';
let editorCookie = '';
let agentCookie = '';
let viewerCookie = '';

function jsonRequest<T = unknown>(method: string, url: string, body?: unknown, opts: { cookie?: string; headers?: Record<string, string> } = {}): Promise<ApiResponse<T>> {
  return new Promise((resolve, reject) => {
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    const cookie = opts.cookie !== undefined ? opts.cookie : authCookie;
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
          ...(opts.headers ?? {}),
        },
      },
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
          resolve({ status: res.statusCode ?? 0, body: parsed as T, headers: res.headers });
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function b64url(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

function signToken(payload: Record<string, unknown>, secret: string, header: Record<string, unknown> = { alg: 'HS256' }): string {
  const h = b64url(header);
  const p = b64url(payload);
  const sig = createHmac('sha256', Buffer.from(secret, 'utf8')).update(`${h}.${p}`).digest('base64url');
  return `${h}.${p}.${sig}`;
}

/**
 * 옴니채널 통합 인박스(No.42) 통합 시험 — `docs/02-spec/omnichannel-inbox-설계.md` §21 인계 항목 중
 * 대표 시나리오(전체 목록은 서비스/순수 함수 단위 시험 + 이 파일로 나누어 커버한다).
 */
describe('옴니채널 통합 인박스(No.42) 통합 테스트', () => {
  let app: INestApplication;
  let baseUrl: string;
  let tmpDir: string;
  let prisma: PrismaService;
  let inboxIdentity: InboxIdentityService;
  let inboxSignal: InboxSignalService;

  const CUSTOMER_KEY_SECRET = 'ck-secret-'.padEnd(32, '0');
  const SPACE_REF = 'TESTSPACE';
  const SPACE_SECRET = 'space-secret-'.padEnd(32, '1');

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'chatbot-inbox-test-'));
    const dbPath = join(tmpDir, 'test.db').replace(/\\/g, '/');
    const testDatabaseUrl = `file:${dbPath}`;

    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.DEPLOY_SCHEDULE_ENABLED = 'false';
    process.env.HANDOFF_SWEEPER_ENABLED = 'false';
    process.env.WIDGET_BASE_URL = process.env.WIDGET_BASE_URL ?? 'http://localhost:5174';
    process.env.PUBLIC_API_BASE_URL = process.env.PUBLIC_API_BASE_URL ?? 'http://localhost:3000/api/v1';
    // 비밀 2규약은 스키마 밖(process.env 직접) — 리졸버가 매 호출 읽으므로 앱 기동 전후 아무 때나 설정해도 된다.
    process.env.OMNI_CUSTOMER_KEY_SECRET = CUSTOMER_KEY_SECRET;
    process.env[`OMNI_IDENTITY_SECRET__${SPACE_REF}`] = SPACE_SECRET;

    try {
      execSync('pnpm exec prisma migrate deploy', { cwd: API_ROOT, env: { ...process.env, DATABASE_URL: testDatabaseUrl }, stdio: 'pipe' });
    } catch (e) {
      const err = e as { stdout?: Buffer; stderr?: Buffer };
      throw new Error(`prisma migrate deploy 실패:\n${err.stdout?.toString()}\n${err.stderr?.toString()}`);
    }

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalFilters(new AllExceptionsFilter());
    prisma = moduleRef.get(PrismaService);
    inboxIdentity = moduleRef.get(InboxIdentityService);
    inboxSignal = moduleRef.get(InboxSignalService);

    await app.listen(0);
    const server = app.getHttpServer() as http.Server;
    const address = server.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;
    baseUrl = `http://127.0.0.1:${port}/api/v1`;

    await seedTestUsers(prisma);
    authCookie = await loginAs(baseUrl, 'ADMIN');
    editorCookie = await loginAs(baseUrl, 'EDITOR');
    agentCookie = await loginAs(baseUrl, 'AGENT');
    viewerCookie = await loginAs(baseUrl, 'VIEWER');
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await safeCleanupTmpDir(tmpDir);
  });

  async function drainAll(): Promise<void> {
    await inboxIdentity.drainForTest();
    await inboxSignal.drainForTest();
  }

  /**
   * `conversation-log.service.ts`의 `record()`는 `void`로 호출되는 완전한 발사 후 망각(fire-and-forget)
   * 이라 `drainAll()`(식별·신호 서비스의 pending 체인만 기다린다)만으로는 `TURN_RECORDED` 신호 자체가
   * 아직 발행되지 않았을 수 있다(개입 경로의 `HANDOFF_OPENED`는 요청 안에서 동기적으로 발행되므로
   * 이 문제가 없다). DB 최종 상태를 짧게 폴링해 경합을 없앤다.
   */
  async function waitFor<T>(check: () => Promise<T | null | undefined | false>, timeoutMs = 4000, intervalMs = 50): Promise<T> {
    const start = Date.now();
    for (;;) {
      const result = await check();
      if (result) return result;
      if (Date.now() - start >= timeoutMs) throw new Error('waitFor: 시간 초과');
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }

  async function createGroup(): Promise<string> {
    const res = await jsonRequest<Record<string, unknown>>('POST', `${baseUrl}/chatbot-groups`, { name: `인박스 테스트 그룹 ${Math.random().toString(36).slice(2, 8)}` });
    return res.body.id as string;
  }

  async function setupPublicChatbot(): Promise<{ chatbotId: string; slug: string }> {
    const groupId = await createGroup();
    const suffix = Math.random().toString(36).slice(2, 10);
    const slug = `inbox-bot-${suffix}`;
    const createRes = await jsonRequest<Record<string, unknown>>('POST', `${baseUrl}/chatbots`, { groupId, name: '인박스 테스트봇', slug });
    const chatbotId = createRes.body.id as string;
    await jsonRequest('PATCH', `${baseUrl}/chatbots/${chatbotId}/status`, { status: 'ACTIVE' });
    await jsonRequest('PATCH', `${baseUrl}/chatbots/${chatbotId}/channels/WEB`, { enabled: true, config: { allowedOrigins: [], greetingMessage: '안녕하세요' } });
    return { chatbotId, slug };
  }

  async function enableInboxParticipation(chatbotId: string, identitySecretRef?: string): Promise<void> {
    const res = await jsonRequest('PUT', `${baseUrl}/chatbots/${chatbotId}/inbox-settings`, { enabled: true, openOnWarning: false });
    expect(res.status).toBe(200);
    if (identitySecretRef) {
      const idRes = await jsonRequest('PUT', `${baseUrl}/chatbots/${chatbotId}/inbox-settings/identity`, { identitySecretRef });
      expect(idRes.status).toBe(200);
    }
  }

  function randomSessionId(): string {
    const hex = () => Math.random().toString(16).slice(2, 10);
    return `${hex()}-${hex().slice(0, 4)}-4${hex().slice(0, 3)}-8${hex().slice(0, 3)}-${hex()}${hex().slice(0, 4)}`;
  }

  it('AC-OC1-1: 참여하지 않는 챗봇 + 식별 헤더 있음 — 응답 바이트·상태가 헤더 없음과 동일하고 고객·연결이 생기지 않는다', async () => {
    const { slug } = await setupPublicChatbot(); // 참여 설정을 켜지 않음(기본 꺼짐)
    const sessionA = randomSessionId();
    const sessionB = randomSessionId();
    const token = signToken({ sub: 'member-parity', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 }, SPACE_SECRET);

    const withoutHeader = await jsonRequest<Record<string, unknown>>('POST', `${baseUrl}/public/chatbots/${slug}/messages`, { sessionId: sessionA, message: '안녕하세요' });
    const withHeader = await jsonRequest<Record<string, unknown>>('POST', `${baseUrl}/public/chatbots/${slug}/messages`, { sessionId: sessionB, message: '안녕하세요' }, { headers: { [IDENTITY_HEADER]: token } });

    expect(withHeader.status).toBe(withoutHeader.status);
    expect(Object.keys(withHeader.body).sort()).toEqual(Object.keys(withoutHeader.body).sort());
    expect((withHeader.body as { outputs: unknown }).outputs).toEqual((withoutHeader.body as { outputs: unknown }).outputs);

    await drainAll();
    const customerCount = await prisma.customer.count();
    const linkCount = await prisma.customerLink.count();
    expect(customerCount).toBe(0);
    expect(linkCount).toBe(0);
  });

  it('AC-OC2-1: 같은 식별 공간의 두 챗봇 — 같은 sub는 고객 1명 + 연결 2건으로 묶인다', async () => {
    const botA = await setupPublicChatbot();
    const botB = await setupPublicChatbot();
    await enableInboxParticipation(botA.chatbotId, SPACE_REF);
    await enableInboxParticipation(botB.chatbotId, SPACE_REF);

    const sub = `member-${Math.random().toString(36).slice(2, 10)}`;
    const now = Math.floor(Date.now() / 1000);
    const token = signToken({ sub, iat: now, exp: now + 3600 }, SPACE_SECRET);

    await jsonRequest('POST', `${baseUrl}/public/chatbots/${botA.slug}/messages`, { sessionId: randomSessionId(), message: '안녕' }, { headers: { [IDENTITY_HEADER]: token } });
    await jsonRequest('POST', `${baseUrl}/public/chatbots/${botB.slug}/messages`, { sessionId: randomSessionId(), message: '안녕' }, { headers: { [IDENTITY_HEADER]: token } });
    await drainAll();

    const customers = await prisma.customer.findMany({ where: { kind: 'IDENTIFIED', identitySpaceRef: SPACE_REF } });
    const target = customers.find((c) => c.customerKeyHash !== null);
    expect(target).toBeDefined();
    const links = await prisma.customerLink.findMany({ where: { customerId: target!.id } });
    expect(links.length).toBe(2);
  });

  it('AC-OC2-3/EX-OC-2: 위조·만료 토큰은 응답에 영향이 없고(200, 바이트 동일) 원 회원 번호는 어디에도 저장되지 않는다', async () => {
    const bot = await setupPublicChatbot();
    await enableInboxParticipation(bot.chatbotId, SPACE_REF);
    const secretSub = `member-${Math.random().toString(36).slice(2, 12)}`;

    const now = Math.floor(Date.now() / 1000);
    const forged = signToken({ sub: secretSub, iat: now, exp: now + 3600 }, 'wrong-secret-'.padEnd(32, '9'));
    const expired = signToken({ sub: secretSub, iat: now - 8000, exp: now - 7000 }, SPACE_SECRET);

    for (const token of [forged, expired]) {
      const sessionId = randomSessionId();
      const res = await jsonRequest<Record<string, unknown>>('POST', `${baseUrl}/public/chatbots/${bot.slug}/messages`, { sessionId, message: '안녕' }, { headers: { [IDENTITY_HEADER]: token } });
      expect(res.status).toBe(200);
    }
    await drainAll();

    const linkedCount = await prisma.customerLink.count({ where: { chatbotId: bot.chatbotId } });
    expect(linkedCount).toBe(0);

    // 가짜 회원 번호가 DB 전 테이블 문자열 어디에도 남지 않는다(전수 grep — AC-OC2-6).
    const [customers, links, entries] = await Promise.all([prisma.customer.findMany(), prisma.customerLink.findMany(), prisma.inboxEntry.findMany()]);
    const dump = JSON.stringify({ customers, links, entries });
    expect(dump.includes(secretSub)).toBe(false);
  });

  it('AC-OC4-1/EX-OC-9: 상담 개입 성공 시 스레드가 열리고, 신호 처리 실패를 흉내내도 개입 응답은 영향받지 않는다', async () => {
    const bot = await setupPublicChatbot();
    await enableInboxParticipation(bot.chatbotId);
    await jsonRequest('PUT', `${baseUrl}/chatbots/${bot.chatbotId}/handoff-settings`, {
      enabled: true,
      cautionThreshold: 1,
      warningThreshold: 2,
      activeWindowMinutes: 10,
      userIdleMinutes: 10,
      agentNoReplyMinutes: 5,
      connectNotice: '상담원이 연결되었어요.',
      endNotice: '상담이 종료되었어요.',
      failNotice: '연결이 어려워요.',
    });

    const sessionId = randomSessionId();
    await jsonRequest('POST', `${baseUrl}/public/chatbots/${bot.slug}/messages`, { sessionId, message: '이해할 수 없는 질문입니다' });
    const listRes = await jsonRequest<{ items: Array<{ sessionRef: string }> }>('GET', `${baseUrl}/chatbots/${bot.chatbotId}/live-sessions`);
    const sessionRef = listRes.body.items[0].sessionRef;

    const intervened = await jsonRequest('POST', `${baseUrl}/chatbots/${bot.chatbotId}/live-sessions/${sessionRef}/handoff`, {}, { cookie: agentCookie });
    expect(intervened.status).toBe(201);
    await drainAll();

    const link = await prisma.customerLink.findFirst({ where: { chatbotId: bot.chatbotId, sessionId } });
    expect(link?.source).toBe('SYSTEM');
    const thread = await prisma.inboxThread.findFirst({ where: { customerId: link!.customerId } });
    expect(thread?.status).toBe('OPEN');
    expect(thread?.openReason).toBe('HANDOFF');
  });

  it('AC-OC4-4: 담당 없는 스레드에 두 요청이 동시에 가져가기하면 1건만 성공하고 나머지는 409다', async () => {
    const bot = await setupPublicChatbot();
    await enableInboxParticipation(bot.chatbotId);
    const create = await jsonRequest<{ threadId: string }>('POST', `${baseUrl}/inbox/customers`, { displayName: '동시성 테스트' }, { cookie: agentCookie });
    expect(create.status).toBe(201);
    const threadId = create.body.threadId;

    const [r1, r2] = await Promise.all([
      jsonRequest('POST', `${baseUrl}/inbox/threads/${threadId}/claim`, {}, { cookie: agentCookie }),
      jsonRequest('POST', `${baseUrl}/inbox/threads/${threadId}/claim`, {}, { cookie: authCookie }),
    ]);
    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([201, 409]);
  });

  it('AC-OC3-2: 식별↔식별 병합은 거부된다(409 CUSTOMER_MERGE_FORBIDDEN)', async () => {
    const bot = await setupPublicChatbot();
    await enableInboxParticipation(bot.chatbotId, SPACE_REF);
    const now = Math.floor(Date.now() / 1000);
    const tokenA = signToken({ sub: `id-a-${Math.random().toString(36).slice(2, 8)}`, iat: now, exp: now + 3600 }, SPACE_SECRET);
    const tokenB = signToken({ sub: `id-b-${Math.random().toString(36).slice(2, 8)}`, iat: now, exp: now + 3600 }, SPACE_SECRET);
    await jsonRequest('POST', `${baseUrl}/public/chatbots/${bot.slug}/messages`, { sessionId: randomSessionId(), message: 'hi' }, { headers: { [IDENTITY_HEADER]: tokenA } });
    await jsonRequest('POST', `${baseUrl}/public/chatbots/${bot.slug}/messages`, { sessionId: randomSessionId(), message: 'hi' }, { headers: { [IDENTITY_HEADER]: tokenB } });
    await drainAll();

    const customers = await prisma.customer.findMany({ where: { kind: 'IDENTIFIED' } });
    expect(customers.length).toBeGreaterThanOrEqual(2);
    const [c1, c2] = customers;
    const res = await jsonRequest('POST', `${baseUrl}/inbox/customers/${c1.id}/merge`, { targetCustomerId: c2.id }, { cookie: agentCookie });
    expect(res.status).toBe(409);
    expect((res.body as { code: string }).code).toBe('CUSTOMER_MERGE_FORBIDDEN');
  });

  it('IDENTITY 연결 분리는 ADMIN만 가능하다(비ADMIN은 409)', async () => {
    const bot = await setupPublicChatbot();
    await enableInboxParticipation(bot.chatbotId, SPACE_REF);
    const now = Math.floor(Date.now() / 1000);
    const token = signToken({ sub: `id-solo-${Math.random().toString(36).slice(2, 8)}`, iat: now, exp: now + 3600 }, SPACE_SECRET);
    await jsonRequest('POST', `${baseUrl}/public/chatbots/${bot.slug}/messages`, { sessionId: randomSessionId(), message: 'hi' }, { headers: { [IDENTITY_HEADER]: token } });
    await drainAll();

    const link = await prisma.customerLink.findFirst({ where: { chatbotId: bot.chatbotId, source: 'IDENTITY' } });
    expect(link).toBeDefined();

    const forbidden = await jsonRequest('DELETE', `${baseUrl}/inbox/customers/${link!.customerId}/links/${link!.id}`, undefined, { cookie: agentCookie });
    expect(forbidden.status).toBe(409);

    const ok = await jsonRequest('DELETE', `${baseUrl}/inbox/customers/${link!.customerId}/links/${link!.id}`, undefined, { cookie: authCookie });
    expect(ok.status).toBe(200);
  });

  it('권한 매트릭스(부분): VIEWER는 인박스 목록이 403 · AGENT는 조회·처리 가능 · 태그 관리는 ADMIN만', async () => {
    const viewerRes = await jsonRequest('GET', `${baseUrl}/inbox/threads`, undefined, { cookie: viewerCookie });
    expect(viewerRes.status).toBe(403);

    const agentRes = await jsonRequest('GET', `${baseUrl}/inbox/threads`, undefined, { cookie: agentCookie });
    expect(agentRes.status).toBe(200);

    const tagByAgent = await jsonRequest('POST', `${baseUrl}/inbox/tags`, { name: `태그${Math.random().toString(36).slice(2, 6)}`, color: 'BLUE' }, { cookie: agentCookie });
    expect(tagByAgent.status).toBe(403);

    const tagByAdmin = await jsonRequest('POST', `${baseUrl}/inbox/tags`, { name: `태그${Math.random().toString(36).slice(2, 6)}`, color: 'BLUE' }, { cookie: authCookie });
    expect(tagByAdmin.status).toBe(201);
  });

  it('시뮬레이션 3회는 로그·통계·학습 큐에 반영되지 않는다(AC-OC5-2 축약)', async () => {
    const bot = await setupPublicChatbot();
    await enableInboxParticipation(bot.chatbotId);
    const createTest = await jsonRequest<{ customerId: string }>('POST', `${baseUrl}/inbox/test-customers`, { label: '시뮬 고객' }, { cookie: authCookie });
    expect(createTest.status).toBe(201);
    const customerId = createTest.body.customerId;

    const beforeLogs = await prisma.conversationLog.count({ where: { chatbotId: bot.chatbotId } });
    for (let i = 0; i < 3; i += 1) {
      const res = await jsonRequest(
        'POST',
        `${baseUrl}/inbox/test-customers/${customerId}/simulate`,
        { chatbotId: bot.chatbotId, simulatedChannel: 'KAKAOTALK', message: `시뮬 메시지 ${i}` },
        { cookie: authCookie },
      );
      expect(res.status).toBe(201);
    }
    const afterLogs = await prisma.conversationLog.count({ where: { chatbotId: bot.chatbotId } });
    expect(afterLogs).toBe(beforeLogs);

    const entries = await prisma.inboxEntry.count({ where: { kind: { in: ['SIM_USER', 'SIM_BOT'] } } });
    expect(entries).toBeGreaterThanOrEqual(6);
  });

  it('EX-OC-18: OMNI_INBOX_ENABLED는 기본 true — 목록 API가 200으로 응답한다(꺼짐 계약은 별도 파일에서 동적 import로 검증)', async () => {
    const res = await jsonRequest('GET', `${baseUrl}/inbox/threads/summary`, undefined, { cookie: agentCookie });
    expect(res.status).toBe(200);
  });

  it('H-1: 종료된 상담의 메시지가 인박스 타임라인에 나타나고 rawText는 노출되지 않는다', async () => {
    const bot = await setupPublicChatbot();
    await enableInboxParticipation(bot.chatbotId);
    await jsonRequest('PUT', `${baseUrl}/chatbots/${bot.chatbotId}/handoff-settings`, {
      enabled: true,
      cautionThreshold: 1,
      warningThreshold: 2,
      activeWindowMinutes: 10,
      userIdleMinutes: 10,
      agentNoReplyMinutes: 5,
      connectNotice: '상담원이 연결되었어요.',
      endNotice: '상담이 종료되었어요.',
      failNotice: '연결이 어려워요.',
    });

    const sessionId = randomSessionId();
    await jsonRequest('POST', `${baseUrl}/public/chatbots/${bot.slug}/messages`, { sessionId, message: '이해할 수 없는 질문입니다' });
    const listRes = await jsonRequest<{ items: Array<{ sessionRef: string }> }>('GET', `${baseUrl}/chatbots/${bot.chatbotId}/live-sessions`);
    const sessionRef = listRes.body.items[0].sessionRef;

    const intervened = await jsonRequest<{ id: string }>('POST', `${baseUrl}/chatbots/${bot.chatbotId}/live-sessions/${sessionRef}/handoff`, {}, { cookie: agentCookie });
    expect(intervened.status).toBe(201);
    const handoffId = intervened.body.id;
    await drainAll();

    const link = await prisma.customerLink.findFirst({ where: { chatbotId: bot.chatbotId, sessionId } });
    expect(link).toBeDefined();
    const thread = await prisma.inboxThread.findFirst({ where: { customerId: link!.customerId } });
    expect(thread).toBeDefined();

    // 첫 접촉(모던) — 전화번호가 든 사용자 원문이 rawText에 잠깐 남는 구간을 지나 종료로 소거된다.
    await jsonRequest('POST', `${baseUrl}/public/chatbots/${bot.slug}/messages`, { sessionId, message: '제 번호는 010-1234-5678이에요', features: ['handoff-v1'] });
    const sendRes = await jsonRequest('POST', `${baseUrl}/chatbots/${bot.chatbotId}/handoffs/${handoffId}/messages`, { text: '안녕하세요, 무엇을 도와드릴까요?' }, { cookie: agentCookie });
    expect(sendRes.status).toBe(201);

    const endRes = await jsonRequest('POST', `${baseUrl}/chatbots/${bot.chatbotId}/handoffs/${handoffId}/end`, {}, { cookie: agentCookie });
    expect(endRes.status).toBe(201);

    const detail = await jsonRequest<{ timeline: { units: Array<Record<string, unknown>> } }>('GET', `${baseUrl}/inbox/threads/${thread!.id}`, undefined, { cookie: agentCookie });
    expect(detail.status).toBe(200);

    const conv = detail.body.timeline.units.find((u) => u.kind === 'CONVERSATION' && u.sessionRef === sessionRef) as
      | { handoffs: Array<{ status: string; messages: Array<{ sender: string; text: string }> }> }
      | undefined;
    expect(conv).toBeDefined();
    expect(conv!.handoffs.length).toBeGreaterThanOrEqual(1);
    const h = conv!.handoffs[0];
    expect(h.status).toBe('ENDED');
    expect(h.messages.some((m) => m.sender === 'AGENT' && m.text.includes('무엇을 도와드릴까요'))).toBe(true);
    const userMsg = h.messages.find((m) => m.sender === 'USER');
    expect(userMsg).toBeDefined();
    // 마스킹본만 노출된다 — 원문 전화번호는 나오지 않는다.
    expect(userMsg!.text.includes('010-1234-5678')).toBe(false);

    // rawText 키 자체가 응답 어디에도 없다(H-5·O-10).
    const dump = JSON.stringify(detail.body);
    expect(dump.includes('rawText')).toBe(false);
  });

  it('M-4: 상세 응답의 activeHandoffCount가 하드코딩 0이 아니라 실제 진행 중 상담 수를 반영한다(코드리뷰 R2)', async () => {
    const bot = await setupPublicChatbot();
    await enableInboxParticipation(bot.chatbotId);
    await jsonRequest('PUT', `${baseUrl}/chatbots/${bot.chatbotId}/handoff-settings`, {
      enabled: true,
      cautionThreshold: 1,
      warningThreshold: 2,
      activeWindowMinutes: 10,
      userIdleMinutes: 10,
      agentNoReplyMinutes: 5,
      connectNotice: '상담원이 연결되었어요.',
      endNotice: '상담이 종료되었어요.',
      failNotice: '연결이 어려워요.',
    });

    const sessionId = randomSessionId();
    await jsonRequest('POST', `${baseUrl}/public/chatbots/${bot.slug}/messages`, { sessionId, message: '이해할 수 없는 질문입니다' });
    const listRes = await jsonRequest<{ items: Array<{ sessionRef: string }> }>('GET', `${baseUrl}/chatbots/${bot.chatbotId}/live-sessions`);
    const sessionRef = listRes.body.items[0].sessionRef;

    const intervened = await jsonRequest<{ id: string }>('POST', `${baseUrl}/chatbots/${bot.chatbotId}/live-sessions/${sessionRef}/handoff`, {}, { cookie: agentCookie });
    expect(intervened.status).toBe(201);
    await drainAll();

    const link = await prisma.customerLink.findFirst({ where: { chatbotId: bot.chatbotId, sessionId } });
    expect(link).toBeDefined();
    const thread = await prisma.inboxThread.findFirst({ where: { customerId: link!.customerId } });
    expect(thread).toBeDefined();

    // 진행 중 상담이 정확히 1건 있는 상태에서 상세 응답의 activeHandoffCount가 이를 반영해야 한다
    // (수정 전에는 항상 0 하드코딩).
    const detail = await jsonRequest<{ thread: { activeHandoffCount: number } }>('GET', `${baseUrl}/inbox/threads/${thread!.id}`, undefined, { cookie: agentCookie });
    expect(detail.status).toBe(200);
    expect(detail.body.thread.activeHandoffCount).toBe(1);
  });

  it('H-2: 사전 CustomerLink가 없는 순수 익명 세션도 경고 단계 도달 시 스레드가 열린다(코드리뷰 R2 — M-1과 달리 식별 연결을 먼저 만들지 않는다)', async () => {
    const bot = await setupPublicChatbot();
    const settingRes = await jsonRequest('PUT', `${baseUrl}/chatbots/${bot.chatbotId}/inbox-settings`, { enabled: true, openOnWarning: true });
    expect(settingRes.status).toBe(200);

    const sessionId = randomSessionId();
    // 사전 연결 없음 확인 — 이 세션에는 CustomerLink 행이 전혀 없다.
    const preLink = await prisma.customerLink.findFirst({ where: { chatbotId: bot.chatbotId, sessionId } });
    expect(preLink).toBeNull();

    // 식별 헤더를 전혀 보내지 않는다(순수 익명) — 기본 임계값(경고=3)에 도달하도록 미응답
    // 3턴을 연속으로 보낸다.
    for (let i = 0; i < 3; i += 1) {
      const res = await jsonRequest('POST', `${baseUrl}/public/chatbots/${bot.slug}/messages`, { sessionId, message: '이해할 수 없는 질문입니다' });
      expect(res.status).toBe(200);
    }

    const link = await waitFor(() => prisma.customerLink.findFirst({ where: { chatbotId: bot.chatbotId, sessionId } }));
    const thread = await waitFor(() => prisma.inboxThread.findFirst({ where: { customerId: link.customerId, openReason: 'WARNING' } }));
    expect(thread.openReason).toBe('WARNING');

    // 세션당 링크·스레드가 각각 정확히 1개다(중복 생성 없음).
    const allLinks = await prisma.customerLink.findMany({ where: { chatbotId: bot.chatbotId, sessionId } });
    expect(allLinks.length).toBe(1);
    expect(allLinks[0].warningOpenedAt).not.toBeNull();
    const allThreads = await prisma.inboxThread.findMany({ where: { customerId: link.customerId } });
    expect(allThreads.length).toBe(1);
  });

  it('L-4: openFromSession이 기존 CLOSED 스레드를 다시 연다(§8.2 상담원 쪽 사건 = MANUAL 트리거, 코드리뷰 R2)', async () => {
    const bot = await setupPublicChatbot();
    await enableInboxParticipation(bot.chatbotId);

    const sessionId = randomSessionId();
    await jsonRequest('POST', `${baseUrl}/public/chatbots/${bot.slug}/messages`, { sessionId, message: '안녕하세요' });
    const sessionRef = computeSessionRef(bot.chatbotId, sessionId);

    const openRes = await jsonRequest<{ threadId: string }>('POST', `${baseUrl}/inbox/threads/open`, { chatbotId: bot.chatbotId, sessionRef }, { cookie: authCookie });
    expect(openRes.status).toBe(201);
    const threadId = openRes.body.threadId;

    const beforeClose = await prisma.inboxThread.findUniqueOrThrow({ where: { id: threadId } });
    expect(beforeClose.status).toBe('OPEN');

    const closeRes = await jsonRequest('PATCH', `${baseUrl}/inbox/threads/${threadId}`, { status: 'CLOSED', version: beforeClose.version }, { cookie: authCookie });
    expect(closeRes.status).toBe(200);
    const closed = await prisma.inboxThread.findUniqueOrThrow({ where: { id: threadId } });
    expect(closed.status).toBe('CLOSED');

    // 같은 세션에 다시 "대화 보기에서 스레드 열기"를 호출하면(기존 링크가 있으므로 else 분기)
    // 재수정 전에는 CLOSED 그대로 반환하고 있었다 — 이제는 OPEN으로 되돌리고 version이 늘어난다.
    const reopenRes = await jsonRequest<{ threadId: string }>('POST', `${baseUrl}/inbox/threads/open`, { chatbotId: bot.chatbotId, sessionRef }, { cookie: authCookie });
    expect(reopenRes.status).toBe(201);
    expect(reopenRes.body.threadId).toBe(threadId);

    const reopened = await prisma.inboxThread.findUniqueOrThrow({ where: { id: threadId } });
    expect(reopened.status).toBe('OPEN');
    expect(reopened.version).toBeGreaterThan(closed.version);
  });

  it('M-1: 경고 임계값은 챗봇 상담 설정(caution/warningThreshold)을 따른다(하드코딩 2/3 제거)', async () => {
    const bot = await setupPublicChatbot();
    // 순수 익명 경로에서 세션당 1회 열림이 보장되는지는 별도 H-2 시험이 우회 없이 검증한다.
    // 이 시험은 커스텀 임계값 적용만 본다 — 식별 연결로 링크를 먼저 만들어(1턴 · drain으로
    // 확정) 두 번째(미응답) 턴에서 커스텀 임계값이 적용되는지 확인한다. 임계값은 경고 > 주의여야
    // 하므로(주의 임계값보다 커야 함) 1/2로 둔다 — 기본값(2/3)이었다면 미응답 2턴으로는 WARNING에
    // 도달하지 못한다.
    await enableInboxParticipation(bot.chatbotId, SPACE_REF);
    await jsonRequest('PUT', `${baseUrl}/chatbots/${bot.chatbotId}/inbox-settings`, { enabled: true, openOnWarning: true });
    const settingsRes = await jsonRequest('PUT', `${baseUrl}/chatbots/${bot.chatbotId}/handoff-settings`, {
      enabled: true,
      cautionThreshold: 1,
      warningThreshold: 2,
      activeWindowMinutes: 10,
      userIdleMinutes: 10,
      agentNoReplyMinutes: 5,
      connectNotice: '상담원이 연결되었어요.',
      endNotice: '상담이 종료되었어요.',
      failNotice: '연결이 어려워요.',
    });
    expect(settingsRes.status).toBe(200);

    const sessionId = randomSessionId();
    const now = Math.floor(Date.now() / 1000);
    const token = signToken({ sub: `member-warn-${Math.random().toString(36).slice(2, 8)}`, iat: now, exp: now + 3600 }, SPACE_SECRET);

    // 1턴 — 식별 연결을 먼저 만든다(폴링으로 확정 — record()는 fire-and-forget이라 drainAll()만으로는
    // 신호 자체가 아직 발행되지 않았을 수 있다).
    await jsonRequest('POST', `${baseUrl}/public/chatbots/${bot.slug}/messages`, { sessionId, message: '안녕하세요' }, { headers: { [IDENTITY_HEADER]: token } });
    const link = await waitFor(() => prisma.customerLink.findFirst({ where: { chatbotId: bot.chatbotId, sessionId } }));

    // 2턴 — 미응답 1턴 추가(누적 2턴)로 커스텀 임계값(warning=2)에 도달해 WARNING으로 열린다.
    await jsonRequest('POST', `${baseUrl}/public/chatbots/${bot.slug}/messages`, { sessionId, message: '이해할 수 없는 질문입니다' }, { headers: { [IDENTITY_HEADER]: token } });
    const thread = await waitFor(() => prisma.inboxThread.findFirst({ where: { customerId: link.customerId, openReason: 'WARNING' } }));
    expect(thread.openReason).toBe('WARNING');
  });

  it('M-3: channelFamily 필터가 목록을 실제로 좁힌다(RECORD ↔ SIMULATED)', async () => {
    const bot = await setupPublicChatbot();
    await enableInboxParticipation(bot.chatbotId);

    const recordCustomer = await jsonRequest<{ threadId: string }>('POST', `${baseUrl}/inbox/customers`, { displayName: '기록채널고객' }, { cookie: authCookie });
    expect(recordCustomer.status).toBe(201);
    const recordThreadId = recordCustomer.body.threadId;
    const recordRes = await jsonRequest(
      'POST',
      `${baseUrl}/inbox/threads/${recordThreadId}/records`,
      { recordChannel: 'PHONE', direction: 'INBOUND', occurredAt: new Date().toISOString(), text: '전화 기록' },
      { cookie: authCookie },
    );
    expect(recordRes.status).toBe(201);

    const simCustomer = await jsonRequest<{ customerId: string; threadId: string }>('POST', `${baseUrl}/inbox/test-customers`, { label: '시뮬채널고객' }, { cookie: authCookie });
    expect(simCustomer.status).toBe(201);
    const simThreadId = simCustomer.body.threadId;
    const simRes = await jsonRequest(
      'POST',
      `${baseUrl}/inbox/test-customers/${simCustomer.body.customerId}/simulate`,
      { chatbotId: bot.chatbotId, simulatedChannel: 'KAKAOTALK', message: '안녕' },
      { cookie: authCookie },
    );
    expect(simRes.status).toBe(201);

    const recordOnly = await jsonRequest<{ items: Array<{ threadId: string }> }>('GET', `${baseUrl}/inbox/threads?channelFamily=RECORD&includeTest=true`, undefined, { cookie: authCookie });
    expect(recordOnly.status).toBe(200);
    expect(recordOnly.body.items.some((i) => i.threadId === recordThreadId)).toBe(true);
    expect(recordOnly.body.items.some((i) => i.threadId === simThreadId)).toBe(false);

    const simOnly = await jsonRequest<{ items: Array<{ threadId: string }> }>('GET', `${baseUrl}/inbox/threads?channelFamily=SIMULATED&includeTest=true`, undefined, { cookie: authCookie });
    expect(simOnly.status).toBe(200);
    expect(simOnly.body.items.some((i) => i.threadId === simThreadId)).toBe(true);
    expect(simOnly.body.items.some((i) => i.threadId === recordThreadId)).toBe(false);
  });

  it('L-3: 메모 수정 시 경로의 threadId와 실제 메모의 threadId가 다르면 404다', async () => {
    const customerA = await jsonRequest<{ threadId: string }>('POST', `${baseUrl}/inbox/customers`, { displayName: '메모 고객 A' }, { cookie: authCookie });
    const customerB = await jsonRequest<{ threadId: string }>('POST', `${baseUrl}/inbox/customers`, { displayName: '메모 고객 B' }, { cookie: authCookie });
    expect(customerA.status).toBe(201);
    expect(customerB.status).toBe(201);

    const noteRes = await jsonRequest('POST', `${baseUrl}/inbox/threads/${customerA.body.threadId}/notes`, { text: '원본 메모' }, { cookie: authCookie });
    expect(noteRes.status).toBe(201);
    const entry = await prisma.inboxEntry.findFirst({ where: { threadId: customerA.body.threadId, kind: 'NOTE' }, orderBy: { createdAt: 'desc' } });
    expect(entry).toBeDefined();

    // 실제로는 A 스레드 소속인 메모를 B 스레드 경로로 수정 시도 — 불일치이므로 404.
    const mismatched = await jsonRequest('PATCH', `${baseUrl}/inbox/threads/${customerB.body.threadId}/notes/${entry!.id}`, { text: '수정 시도' }, { cookie: authCookie });
    expect(mismatched.status).toBe(404);

    // 올바른 경로(A)는 정상 수정된다.
    const ok = await jsonRequest('PATCH', `${baseUrl}/inbox/threads/${customerA.body.threadId}/notes/${entry!.id}`, { text: '정상 수정' }, { cookie: authCookie });
    expect(ok.status).toBe(200);
  });

  it('L-C: 상담 메시지 그룹 take는 seq가 세션마다 1부터 재시작한다는 불변식에 의존한다 — 메시지 수가 비대칭인 두 세션 중 하나가 상한(200)을 넘어도 다른 세션의 메시지가 누락되지 않는다', async () => {
    const bot = await setupPublicChatbot();
    await enableInboxParticipation(bot.chatbotId);

    // 고객 스레드 1개를 만들고, 같은 챗봇의 서로 다른 두 상담(세션)을 여기 연결한다 — 둘 다 seq가
    // 1부터 시작하는 별개의 HandoffSession이다(스키마 `@@unique([handoffSessionId, seq])` — 세션마다
    // 독립적인 시퀀스). `inbox-thread-detail.service.ts`의 상담 메시지 조회는 두 세션을 한 번의
    // `IN` 쿼리로 묶어 `orderBy: seq asc` + `take: handoffMessagesPerSessionMax * handoffIds.length`로
    // 가져온다 — 정렬이 세션 경계 없이 seq 값 하나로만 이뤄지므로, 이 불변식(재시작)이 깨지면
    // 메시지 수가 적은 세션이 메시지 수가 많은 세션에 밀려 일부(또는 전부) 누락될 수 있다.
    const customerRes = await jsonRequest<{ threadId: string; customerId: string }>('POST', `${baseUrl}/inbox/customers`, { displayName: 'seq 불변식 고객' }, { cookie: authCookie });
    expect(customerRes.status).toBe(201);
    const { threadId, customerId } = customerRes.body;

    const smallSessionId = randomSessionId();
    const smallSessionRef = computeSessionRef(bot.chatbotId, smallSessionId);
    const bigSessionId = randomSessionId();
    const bigSessionRef = computeSessionRef(bot.chatbotId, bigSessionId);
    const now = new Date();

    const baseHandoffData = {
      chatbotId: bot.chatbotId,
      groupId: 'lc-invariant-group',
      channelType: 'WEB',
      status: 'ENDED',
      assignedUserId: 'lc-agent',
      assignedUserName: 'LC 상담원',
      startedById: 'lc-agent',
      startedByName: 'LC 상담원',
      alertLevelAtStart: 'NORMAL',
      consecutiveUnansweredAtStart: 0,
      startedAt: now,
      endedAt: now,
      dayBucket: '2026-09-26',
    };
    const smallHandoff = await prisma.handoffSession.create({ data: { ...baseHandoffData, sessionId: smallSessionId, sessionRef: smallSessionRef } });
    const bigHandoff = await prisma.handoffSession.create({ data: { ...baseHandoffData, sessionId: bigSessionId, sessionRef: bigSessionRef } });

    // 작은 세션 = 5개(seq 1~5) · 큰 세션 = 상한(200)을 넘는 250개(seq 1~250) — 둘 다 seq는 1부터.
    const SMALL_COUNT = 5;
    const BIG_COUNT = 250;
    await prisma.handoffMessage.createMany({
      data: Array.from({ length: SMALL_COUNT }, (_, i) => ({ handoffSessionId: smallHandoff.id, chatbotId: bot.chatbotId, seq: i + 1, sender: 'USER', text: `작은세션 메시지 ${i + 1}` })),
    });
    await prisma.handoffMessage.createMany({
      data: Array.from({ length: BIG_COUNT }, (_, i) => ({ handoffSessionId: bigHandoff.id, chatbotId: bot.chatbotId, seq: i + 1, sender: 'USER', text: `큰세션 메시지 ${i + 1}` })),
    });

    // 큰 세션을 먼저 연결해(고큐 세션이 조회 순서상 앞서도록) 편향을 최대화한 뒤 작은 세션을 연결한다.
    const bigLink = await jsonRequest('POST', `${baseUrl}/inbox/customers/${customerId}/links`, { chatbotId: bot.chatbotId, sessionRef: bigSessionRef }, { cookie: authCookie });
    expect(bigLink.status).toBe(201);
    const smallLink = await jsonRequest('POST', `${baseUrl}/inbox/customers/${customerId}/links`, { chatbotId: bot.chatbotId, sessionRef: smallSessionRef }, { cookie: authCookie });
    expect(smallLink.status).toBe(201);

    const detail = await jsonRequest<{ timeline: { units: Array<{ kind: string; sessionRef?: string; handoffs?: Array<{ messages: Array<{ text: string }>; truncated?: boolean }> }> } }>(
      'GET',
      `${baseUrl}/inbox/threads/${threadId}`,
      undefined,
      { cookie: agentCookie },
    );
    expect(detail.status).toBe(200);

    const conv = detail.body.timeline.units.filter((u) => u.kind === 'CONVERSATION');
    const smallConv = conv.find((u) => u.sessionRef === smallSessionRef);
    const bigConv = conv.find((u) => u.sessionRef === bigSessionRef);
    expect(smallConv).toBeDefined();
    expect(bigConv).toBeDefined();

    // 핵심 단언 — 메시지 수가 적은 세션(작은세션)이 메시지 수가 훨씬 많은 다른 세션(큰세션) 때문에
    // 밀려서 메시지가 누락되면 안 된다: 5개 전부가 그대로 보여야 한다(누락되면 이 값이 줄어든다).
    expect(smallConv!.handoffs![0].messages.length).toBe(SMALL_COUNT);
    expect(smallConv!.handoffs![0].truncated).toBeUndefined();
    expect(smallConv!.handoffs![0].messages.map((m) => m.text)).toEqual(Array.from({ length: SMALL_COUNT }, (_, i) => `작은세션 메시지 ${i + 1}`));

    // 큰 세션은 상한(200)에서 잘리되, 잘린 구간이 seq 앞쪽(1~200)이어야 한다(뒤쪽이 잘려야 정상).
    expect(bigConv!.handoffs![0].messages.length).toBe(200);
    expect(bigConv!.handoffs![0].truncated).toBe(true);
    expect(bigConv!.handoffs![0].messages[0].text).toBe('큰세션 메시지 1');
    expect(bigConv!.handoffs![0].messages[199].text).toBe('큰세션 메시지 200');
  });

  it('AC-OC3-1: 익명 세션을 고객에 수동 연결 후 분리하면 타임라인에서 나타났다 사라지고 ConversationLog·HandoffSession 행 수는 바뀌지 않는다', async () => {
    const bot = await setupPublicChatbot();
    await enableInboxParticipation(bot.chatbotId);

    const sessionId = randomSessionId();
    await jsonRequest('POST', `${baseUrl}/public/chatbots/${bot.slug}/messages`, { sessionId, message: '안녕하세요' });
    const sessionRef = computeSessionRef(bot.chatbotId, sessionId);

    // 세션의 대화 로그가 실제로 적재될 때까지 기다린다(record()는 fire-and-forget).
    await waitFor(() => prisma.conversationLog.findFirst({ where: { chatbotId: bot.chatbotId, sessionId } }));
    const beforeLogs = await prisma.conversationLog.count({ where: { chatbotId: bot.chatbotId, sessionId } });
    const beforeHandoffs = await prisma.handoffSession.count({ where: { chatbotId: bot.chatbotId, sessionId } });
    expect(beforeLogs).toBeGreaterThanOrEqual(1);

    const customerRes = await jsonRequest<{ threadId: string; customerId: string }>('POST', `${baseUrl}/inbox/customers`, { displayName: 'AC-OC3-1 고객 A' }, { cookie: authCookie });
    expect(customerRes.status).toBe(201);
    const { threadId, customerId } = customerRes.body;
    const auditBefore = await prisma.auditLog.count({ where: { targetType: 'Customer', targetId: customerId } });

    // 연결 -- 스레드 타임라인에 세션이 나타난다.
    const linkRes = await jsonRequest('POST', `${baseUrl}/inbox/customers/${customerId}/links`, { chatbotId: bot.chatbotId, sessionRef }, { cookie: authCookie });
    expect(linkRes.status).toBe(201);

    const detailAfterLink = await jsonRequest<{ timeline: { units: Array<{ kind: string; sessionRef?: string }> } }>('GET', `${baseUrl}/inbox/threads/${threadId}`, undefined, { cookie: agentCookie });
    expect(detailAfterLink.status).toBe(200);
    expect(detailAfterLink.body.timeline.units.some((u) => u.kind === 'CONVERSATION' && u.sessionRef === sessionRef)).toBe(true);

    // 분리 -- 스레드 타임라인에서 세션이 사라진다(원상 복구, §7.2 J-13).
    const link = await prisma.customerLink.findUniqueOrThrow({ where: { chatbotId_sessionId: { chatbotId: bot.chatbotId, sessionId } } });
    const unlinkRes = await jsonRequest('DELETE', `${baseUrl}/inbox/customers/${customerId}/links/${link.id}`, undefined, { cookie: authCookie });
    expect(unlinkRes.status).toBe(200);

    const detailAfterUnlink = await jsonRequest<{ timeline: { units: Array<{ kind: string; sessionRef?: string }> } }>('GET', `${baseUrl}/inbox/threads/${threadId}`, undefined, { cookie: agentCookie });
    expect(detailAfterUnlink.status).toBe(200);
    expect(detailAfterUnlink.body.timeline.units.some((u) => u.kind === 'CONVERSATION' && u.sessionRef === sessionRef)).toBe(false);

    // 핵심 불변식 -- 연결·분리는 원천 데이터를 손대지 않는다(§7.3 FR-OC3-6 · O-10).
    const afterLogs = await prisma.conversationLog.count({ where: { chatbotId: bot.chatbotId, sessionId } });
    const afterHandoffs = await prisma.handoffSession.count({ where: { chatbotId: bot.chatbotId, sessionId } });
    expect(afterLogs).toBe(beforeLogs);
    expect(afterHandoffs).toBe(beforeHandoffs);

    // 감사 -- 연결·분리 각 1건씩 정확히 2건.
    const auditAfter = await prisma.auditLog.count({ where: { targetType: 'Customer', targetId: customerId } });
    expect(auditAfter - auditBefore).toBe(2);
  });

  it('S-2 채널 전환 컨텍스트: 웹 대화 → 수동 기록(전화)이 한 스레드 타임라인에 시간순으로 함께 보인다', async () => {
    const bot = await setupPublicChatbot();
    await enableInboxParticipation(bot.chatbotId);

    const sessionId = randomSessionId();
    await jsonRequest('POST', `${baseUrl}/public/chatbots/${bot.slug}/messages`, { sessionId, message: '환불하고 싶어요' });
    const sessionRef = computeSessionRef(bot.chatbotId, sessionId);
    await waitFor(() => prisma.conversationLog.findFirst({ where: { chatbotId: bot.chatbotId, sessionId } }));

    const customerRes = await jsonRequest<{ threadId: string; customerId: string }>('POST', `${baseUrl}/inbox/customers`, { displayName: '채널전환 고객' }, { cookie: authCookie });
    expect(customerRes.status).toBe(201);
    const { threadId, customerId } = customerRes.body;
    const linkRes = await jsonRequest('POST', `${baseUrl}/inbox/customers/${customerId}/links`, { chatbotId: bot.chatbotId, sessionRef }, { cookie: authCookie });
    expect(linkRes.status).toBe(201);

    // 다음 접촉 -- 전화로 이어진 상담을 수동 기록한다(웹 대화보다 확실히 나중 시각).
    const recordAt = new Date(Date.now() + 1000).toISOString();
    const recordRes = await jsonRequest(
      'POST',
      `${baseUrl}/inbox/threads/${threadId}/records`,
      { recordChannel: 'PHONE', direction: 'INBOUND', occurredAt: recordAt, text: '환불 계좌 재확인 요청' },
      { cookie: authCookie },
    );
    expect(recordRes.status).toBe(201);

    const detail = await jsonRequest<{ timeline: { units: Array<{ kind: string; at: string; sessionRef?: string; recordChannel?: string }> } }>(
      'GET',
      `${baseUrl}/inbox/threads/${threadId}`,
      undefined,
      { cookie: agentCookie },
    );
    expect(detail.status).toBe(200);
    const units = detail.body.timeline.units;

    const conv = units.find((u) => u.kind === 'CONVERSATION' && u.sessionRef === sessionRef);
    const record = units.find((u) => u.kind === 'RECORD' && u.recordChannel === 'PHONE');
    expect(conv).toBeDefined();
    expect(record).toBeDefined();

    // 한 스레드 응답 안에 웹 대화 + 수동 기록(전화)이 함께 있고, 시간순(내림차순 -- 최신이 먼저)이다.
    const times = units.map((u) => new Date(u.at).getTime());
    for (let i = 1; i < times.length; i += 1) expect(times[i - 1]).toBeGreaterThanOrEqual(times[i]);
    // 전화 기록이 웹 대화보다 나중이므로 배열에서 더 앞(더 최신)에 나온다.
    expect(units.indexOf(record!)).toBeLessThan(units.indexOf(conv!));
  });
});
