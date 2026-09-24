import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import * as http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INestApplication, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../app.module';
import { AllExceptionsFilter } from '../common/all-exceptions.filter';
import { PrismaService } from '../prisma/prisma.service';
import { HandoffSweeperService } from '../handoff/handoff-sweeper.service';
import { loginAs, seedTestUsers } from './helpers/auth.helper';

const API_ROOT = join(__dirname, '..', '..');
const HANDOFF_SESSION_HEADER = 'x-cb-session-id';
const HANDOFF_TOKEN_HEADER = 'x-cb-handoff-token';

/**
 * Windows에서 SQLite 파일 핸들 해제가 `app.close()` 직후 완전히 끝나지 않아 `rmSync`가 EPERM으로
 * 실패하는 경우가 있다(테스트 인프라 안정성 문제 — `learning-augmentation.integration.spec.ts`·
 * `legacy-api-integration.integration.spec.ts` 선례와 동일한 성격, 프로덕션 코드와 무관). 짧은
 * 유예 + 재시도로 흡수하고, 그래도 실패하면 임시 디렉터리 정리만 건너뛴다(OS 임시 폴더 정리
 * 대상 — 테스트 판정에는 무해).
 */
async function safeCleanupTmpDir(dir: string): Promise<void> {
  await new Promise((r) => setTimeout(r, 300));
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {
    // 정리 실패는 무시한다.
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

/**
 * 하이브리드 CS(No.24) 통합 테스트 — `docs/02-spec/hybrid-cs-설계.md` §22 인계 항목 중 HTTP 계약·
 * 전체 개입~종료 흐름·원문 파기·권한을 다룬다(순수 함수 판정은 `handoff/lib/*.spec.ts`가 커버).
 */
describe('하이브리드 CS(No.24) 통합 테스트', () => {
  let app: INestApplication;
  let baseUrl: string;
  let tmpDir: string;
  let prisma: PrismaService;
  let sweeper: HandoffSweeperService;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'chatbot-handoff-test-'));
    const dbPath = join(tmpDir, 'test.db').replace(/\\/g, '/');
    const testDatabaseUrl = `file:${dbPath}`;

    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.DEPLOY_SCHEDULE_ENABLED = 'false';
    process.env.WIDGET_BASE_URL = process.env.WIDGET_BASE_URL ?? 'http://localhost:5174';
    process.env.PUBLIC_API_BASE_URL = process.env.PUBLIC_API_BASE_URL ?? 'http://localhost:3000/api/v1';

    try {
      execSync('pnpm exec prisma migrate deploy', {
        cwd: API_ROOT,
        env: { ...process.env, DATABASE_URL: testDatabaseUrl },
        stdio: 'pipe',
      });
    } catch (e) {
      const err = e as { stdout?: Buffer; stderr?: Buffer };
      throw new Error(`prisma migrate deploy 실패:\n${err.stdout?.toString()}\n${err.stderr?.toString()}`);
    }

    // [코드리뷰 2회차 M-1] `jest.isolate-env.js`가 HANDOFF_SWEEPER_ENABLED=false로 자동 기동을
    // 막는다 — 이 파일은 정적 import를 쓰므로(다른 다수 통합 시험과 동일) beforeAll 안에서
    // 값을 바꿔도 효과가 없다(이미 고정됨). 루프 검증은 `sweeper.tick()` 직접 호출로 한다.
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalFilters(new AllExceptionsFilter());
    prisma = moduleRef.get(PrismaService);
    sweeper = moduleRef.get(HandoffSweeperService);

    await app.listen(0);
    const server = app.getHttpServer() as http.Server;
    const address = server.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;
    baseUrl = `http://127.0.0.1:${port}/api/v1`;

    await seedTestUsers(prisma);
    authCookie = await loginAs(baseUrl, 'ADMIN');
    editorCookie = await loginAs(baseUrl, 'EDITOR');
    agentCookie = await loginAs(baseUrl, 'AGENT');
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await safeCleanupTmpDir(tmpDir);
  });

  async function createGroup(): Promise<string> {
    const res = await jsonRequest<Record<string, unknown>>('POST', `${baseUrl}/chatbot-groups`, { name: `상담 테스트 그룹 ${Math.random().toString(36).slice(2, 8)}` });
    return res.body.id as string;
  }

  async function setupPublicChatbot(): Promise<{ chatbotId: string; slug: string }> {
    const groupId = await createGroup();
    const suffix = Math.random().toString(36).slice(2, 10);
    const slug = `cs-bot-${suffix}`;
    const createRes = await jsonRequest<Record<string, unknown>>('POST', `${baseUrl}/chatbots`, { groupId, name: '상담 테스트봇', slug });
    const chatbotId = createRes.body.id as string;
    await jsonRequest('PATCH', `${baseUrl}/chatbots/${chatbotId}/status`, { status: 'ACTIVE' });
    await jsonRequest('PATCH', `${baseUrl}/chatbots/${chatbotId}/channels/WEB`, { enabled: true, config: { allowedOrigins: [], greetingMessage: '안녕하세요' } });
    return { chatbotId, slug };
  }

  it('AC-CS1-1: 상담이 꺼진 챗봇(설정 행 없음) + 토큰 헤더 없음은 handoff 필드가 없는 응답을 반환한다(바이트 동일 계약)', async () => {
    const { slug } = await setupPublicChatbot();
    const sessionId = '11111111-1111-4111-8111-111111111111';
    const res = await jsonRequest<Record<string, unknown>>('POST', `${baseUrl}/public/chatbots/${slug}/messages`, { sessionId, message: '안녕하세요' });
    expect(res.status).toBe(200);
    expect('handoff' in res.body).toBe(false);
  });

  it('코드리뷰 1회차 Low: 상담 폴링의 x-cb-session-id 헤더가 UUID 형식이 아니면 400이다', async () => {
    const { slug } = await setupPublicChatbot();
    const res = await jsonRequest('GET', `${baseUrl}/public/chatbots/${slug}/handoff?after=0`, undefined, { cookie: '', headers: { [HANDOFF_SESSION_HEADER]: 'not-a-uuid' } });
    expect(res.status).toBe(400);
  });

  it('AC-CS7-1: EDITOR는 cs:write가 없어 개입(intervene)이 403이고, AGENT는 개입할 수 있다', async () => {
    const { chatbotId, slug } = await setupPublicChatbot();
    await jsonRequest('PUT', `${baseUrl}/chatbots/${chatbotId}/handoff-settings`, {
      enabled: true,
      cautionThreshold: 2,
      warningThreshold: 3,
      activeWindowMinutes: 10,
      userIdleMinutes: 10,
      agentNoReplyMinutes: 5,
      connectNotice: '상담원이 연결되었어요.',
      endNotice: '상담이 종료되었어요.',
      failNotice: '연결이 어려워요.',
    });

    const sessionId = '22222222-2222-4222-8222-222222222222';
    await jsonRequest('POST', `${baseUrl}/public/chatbots/${slug}/messages`, { sessionId, message: '주문 조회가 안돼요' });

    const listRes = await jsonRequest<{ items: Array<{ sessionRef: string }> }>('GET', `${baseUrl}/chatbots/${chatbotId}/live-sessions`);
    expect(listRes.status).toBe(200);
    expect(listRes.body.items.length).toBeGreaterThan(0);
    const sessionRef = listRes.body.items[0].sessionRef;

    const forbidden = await jsonRequest('POST', `${baseUrl}/chatbots/${chatbotId}/live-sessions/${sessionRef}/handoff`, {}, { cookie: editorCookie });
    expect(forbidden.status).toBe(403);

    const intervened = await jsonRequest<{ id: string; status: string }>('POST', `${baseUrl}/chatbots/${chatbotId}/live-sessions/${sessionRef}/handoff`, {}, { cookie: agentCookie });
    expect(intervened.status).toBe(201);
    expect(intervened.body.status).toBe('CONNECTING');
  });

  it('전체 흐름: 개입 → 첫 접촉(토큰 발급) → 상담원 전송 → 공개 폴링 수신(마스킹) → 원문 열람(담당자) → RAW_VIEW 감사 1건 → 종료 → 원문 소거', async () => {
    const { chatbotId, slug } = await setupPublicChatbot();
    const settingsRes = await jsonRequest('PUT', `${baseUrl}/chatbots/${chatbotId}/handoff-settings`, {
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

    const sessionId = '33333333-3333-4333-8333-333333333333';
    await jsonRequest('POST', `${baseUrl}/public/chatbots/${slug}/messages`, { sessionId, message: '이해할 수 없는 질문입니다' });

    const listRes = await jsonRequest<{ items: Array<{ sessionRef: string }> }>('GET', `${baseUrl}/chatbots/${chatbotId}/live-sessions`);
    const sessionRef = listRes.body.items[0].sessionRef;

    const intervened = await jsonRequest<{ id: string; isMine: boolean; endButtonLabel: string | null; watchWindowMissed: boolean }>(
      'POST',
      `${baseUrl}/chatbots/${chatbotId}/live-sessions/${sessionRef}/handoff`,
      {},
      { cookie: agentCookie },
    );
    expect(intervened.status).toBe(201);
    // 개입 직후 담당자 본인 화면에서는 isMine=true다(코드리뷰 1회차 반영).
    expect(intervened.body.isMine).toBe(true);
    // 종료 후 버튼을 설정하지 않았으므로 null이다.
    expect(intervened.body.endButtonLabel).toBeNull();
    // 방금 미응답 턴 직후 곧바로 개입했으므로 관찰 창 안이다(false).
    expect(intervened.body.watchWindowMissed).toBe(false);
    const handoffId = intervened.body.id;

    // ADMIN 시점에서 같은 상담을 보면 담당자가 아니므로 isMine=false다.
    const transcriptAsAdmin = await jsonRequest<{ handoff: { isMine: boolean } | null }>(
      'GET',
      `${baseUrl}/chatbots/${chatbotId}/live-sessions/${sessionRef}/transcript`,
      undefined,
      { cookie: authCookie },
    );
    expect(transcriptAsAdmin.body.handoff?.isMine).toBe(false);

    // 첫 접촉(모던) — POST 응답에 토큰이 1회 실린다.
    const firstContact = await jsonRequest<{ handoff?: { status: string; token?: string } }>(
      'POST',
      `${baseUrl}/public/chatbots/${slug}/messages`,
      { sessionId, message: '제 번호는 010-1234-5678이에요', features: ['handoff-v1'] },
    );
    expect(firstContact.status).toBe(200);
    expect(firstContact.body.handoff?.status).toBe('CONNECTED');
    const token = firstContact.body.handoff?.token;
    expect(token).toBeTruthy();

    // 상담원 발신.
    const sendRes = await jsonRequest<{ text: string }>('POST', `${baseUrl}/chatbots/${chatbotId}/handoffs/${handoffId}/messages`, { text: '안녕하세요, 무엇을 도와드릴까요?' }, { cookie: agentCookie });
    expect(sendRes.status).toBe(201);

    // 공개 폴링 — 상담원 메시지를 마스킹본으로 수신한다.
    const pollRes = await jsonRequest<{ status: string; messages: Array<{ sender: string; text: string }> }>(
      'GET',
      `${baseUrl}/public/chatbots/${slug}/handoff?after=0`,
      undefined,
      { cookie: '', headers: { [HANDOFF_SESSION_HEADER]: sessionId, [HANDOFF_TOKEN_HEADER]: token as string } },
    );
    expect(pollRes.status).toBe(200);
    expect(pollRes.body.status).toBe('CONNECTED');
    expect(pollRes.body.messages.some((m) => m.sender === 'AGENT' && m.text.includes('무엇을 도와드릴까요'))).toBe(true);
    // 폴링 응답에는 rawText 키 자체가 없다.
    expect(pollRes.body.messages.every((m) => !('rawText' in m))).toBe(true);

    // 담당자가 원문 열람(includeRaw) — 전화번호가 마스킹되지 않은 원문으로 보인다.
    const transcriptRes = await jsonRequest<{ entries: Array<{ kind: string; text?: string; rawText?: string }>; rawVisible: boolean }>(
      'GET',
      `${baseUrl}/chatbots/${chatbotId}/live-sessions/${sessionRef}/transcript?includeRaw=true`,
      undefined,
      { cookie: agentCookie },
    );
    expect(transcriptRes.status).toBe(200);
    expect(transcriptRes.body.rawVisible).toBe(true);
    const rawEntry = transcriptRes.body.entries.find((e) => e.kind === 'HANDOFF' && e.rawText?.includes('010-1234-5678'));
    expect(rawEntry).toBeDefined();

    // 두 번째 열람에도 RAW_VIEW 감사는 1건만 남는다.
    await jsonRequest('GET', `${baseUrl}/chatbots/${chatbotId}/live-sessions/${sessionRef}/transcript?includeRaw=true`, undefined, { cookie: agentCookie });
    const rawViewCount = await prisma.auditLog.count({ where: { action: 'RAW_VIEW', targetId: handoffId } });
    expect(rawViewCount).toBe(1);

    // 종료 — 같은 트랜잭션에서 원문이 소거된다.
    const endRes = await jsonRequest('POST', `${baseUrl}/chatbots/${chatbotId}/handoffs/${handoffId}/end`, {}, { cookie: agentCookie });
    expect(endRes.status).toBe(201);

    const rawRows = await prisma.handoffMessage.findMany({ where: { handoffSessionId: handoffId, rawText: { not: null } } });
    expect(rawRows).toHaveLength(0);

    // 종료 후 대화 보기는 원문을 다시 보여주지 않는다.
    const afterEndTranscript = await jsonRequest<{ rawVisible: boolean }>(
      'GET',
      `${baseUrl}/chatbots/${chatbotId}/live-sessions/${sessionRef}/transcript?includeRaw=true`,
      undefined,
      { cookie: agentCookie },
    );
    expect(afterEndTranscript.body.rawVisible).toBe(false);
  });

  it('watchWindowMissed: 마지막 턴이 응답된 세션에 개입하면 true다(관찰 창이 열린 적 없음, EX-CS-3)', async () => {
    const { chatbotId, slug } = await setupPublicChatbot();
    const settingsRes = await jsonRequest('PUT', `${baseUrl}/chatbots/${chatbotId}/handoff-settings`, {
      enabled: true,
      cautionThreshold: 1,
      warningThreshold: 2,
      activeWindowMinutes: 10,
      userIdleMinutes: 10,
      agentNoReplyMinutes: 5,
      connectNotice: '연결됨',
      endNotice: '종료됨',
      failNotice: '실패함',
    });
    expect(settingsRes.status).toBe(200);

    const sessionId = '55555555-5555-4555-8555-555555555555';
    // "안녕"은 FAQ SMALL_TALK로 응답되므로(seed와 무관 — 이 챗봇엔 FAQ가 없어 폴백일 수 있다) 명시적으로
    // FAQ를 등록해 반드시 응답되게 만든다.
    await jsonRequest('POST', `${baseUrl}/chatbots/${chatbotId}/faqs`, {
      category: 'SMALL_TALK',
      question: '안녕',
      answer: '안녕하세요!',
    });
    const sendRes = await jsonRequest('POST', `${baseUrl}/public/chatbots/${slug}/messages`, { sessionId, message: '안녕' });
    expect(sendRes.status).toBe(200);

    const listRes = await jsonRequest<{ items: Array<{ sessionRef: string }> }>('GET', `${baseUrl}/chatbots/${chatbotId}/live-sessions`);
    const sessionRef = listRes.body.items[0].sessionRef;

    const intervened = await jsonRequest<{ watchWindowMissed: boolean }>('POST', `${baseUrl}/chatbots/${chatbotId}/live-sessions/${sessionRef}/handoff`, {}, { cookie: agentCookie });
    expect(intervened.status).toBe(201);
    expect(intervened.body.watchWindowMissed).toBe(true);
  });

  it('endButtonLabel: 상담 설정에 종료 후 버튼이 지정되어 있으면 개입·종료 응답에 라벨이 담긴다', async () => {
    const { chatbotId, slug } = await setupPublicChatbot();
    const nodeRes = await jsonRequest<{ id: string }>('POST', `${baseUrl}/chatbots/${chatbotId}/dialog-nodes`, {
      name: '설문 시작 노드',
      nodeType: 'START',
      outputs: [{ type: 'TEXT', payload: { text: '설문을 시작합니다.' } }],
    });
    expect(nodeRes.status).toBe(201);

    const settingsRes = await jsonRequest('PUT', `${baseUrl}/chatbots/${chatbotId}/handoff-settings`, {
      enabled: true,
      cautionThreshold: 1,
      warningThreshold: 2,
      activeWindowMinutes: 10,
      userIdleMinutes: 10,
      agentNoReplyMinutes: 5,
      connectNotice: '연결됨',
      endNotice: '종료됨',
      failNotice: '실패함',
      endButtonLabel: '만족도 설문 하기',
      endButtonNodeId: nodeRes.body.id,
    });
    expect(settingsRes.status).toBe(200);

    const sessionId = '66666666-6666-4666-8666-666666666666';
    await jsonRequest('POST', `${baseUrl}/public/chatbots/${slug}/messages`, { sessionId, message: '이해할 수 없는 질문' });
    const listRes = await jsonRequest<{ items: Array<{ sessionRef: string }> }>('GET', `${baseUrl}/chatbots/${chatbotId}/live-sessions`);
    const sessionRef = listRes.body.items[0].sessionRef;

    const intervened = await jsonRequest<{ id: string; endButtonLabel: string | null }>('POST', `${baseUrl}/chatbots/${chatbotId}/live-sessions/${sessionRef}/handoff`, {}, { cookie: agentCookie });
    expect(intervened.status).toBe(201);
    expect(intervened.body.endButtonLabel).toBe('만족도 설문 하기');

    // [코드리뷰 2회차 M-2] 2초 폴링 응답(대화 보기)에서도 endButtonLabel이 제공된다(Brief에 포함).
    const transcriptRes = await jsonRequest<{ handoff: { endButtonLabel: string | null } | null }>(
      'GET',
      `${baseUrl}/chatbots/${chatbotId}/live-sessions/${sessionRef}/transcript`,
      undefined,
      { cookie: agentCookie },
    );
    expect(transcriptRes.status).toBe(200);
    expect(transcriptRes.body.handoff?.endButtonLabel).toBe('만족도 설문 하기');

    const endRes = await jsonRequest<{ endButtonLabel: string | null }>('POST', `${baseUrl}/chatbots/${chatbotId}/handoffs/${intervened.body.id}/end`, {}, { cookie: agentCookie });
    expect(endRes.status).toBe(201);
    expect(endRes.body.endButtonLabel).toBe('만족도 설문 하기');
  });

  it('영구삭제 사전검사 — 상담 기록이 있는 챗봇은 409로 거부된다(P-12)', async () => {
    const { chatbotId, slug } = await setupPublicChatbot();
    const settingsRes = await jsonRequest('PUT', `${baseUrl}/chatbots/${chatbotId}/handoff-settings`, {
      enabled: true,
      cautionThreshold: 1,
      warningThreshold: 2,
      activeWindowMinutes: 10,
      userIdleMinutes: 10,
      agentNoReplyMinutes: 5,
      connectNotice: '연결됨',
      endNotice: '종료됨',
      failNotice: '실패함',
    });
    expect(settingsRes.status).toBe(200);
    const sessionId = '44444444-4444-4444-8444-444444444444';
    await jsonRequest('POST', `${baseUrl}/public/chatbots/${slug}/messages`, { sessionId, message: '질문' });
    const listRes = await jsonRequest<{ items: Array<{ sessionRef: string }> }>('GET', `${baseUrl}/chatbots/${chatbotId}/live-sessions`);
    const sessionRef = listRes.body.items[0].sessionRef;
    await jsonRequest('POST', `${baseUrl}/chatbots/${chatbotId}/live-sessions/${sessionRef}/handoff`, {}, { cookie: agentCookie });

    await jsonRequest('PATCH', `${baseUrl}/chatbots/${chatbotId}/status`, { status: 'ARCHIVED' });
    const chatbotRes = await jsonRequest<{ name: string }>('GET', `${baseUrl}/chatbots/${chatbotId}`);
    const purgeRes = await jsonRequest('POST', `${baseUrl}/chatbots/${chatbotId}/permanent-delete`, { confirmName: chatbotRes.body.name });
    expect(purgeRes.status).toBe(409);
  });

  it('G-8: 구버전(LEGACY) 상담이 시간 종료되면 미전달 상담원 메시지·종료 안내가 다음 발화의 봇 출력 앞에 전치된다', async () => {
    const { chatbotId, slug } = await setupPublicChatbot();
    const settingsRes = await jsonRequest('PUT', `${baseUrl}/chatbots/${chatbotId}/handoff-settings`, {
      enabled: true,
      cautionThreshold: 1,
      warningThreshold: 2,
      activeWindowMinutes: 10,
      userIdleMinutes: 10,
      agentNoReplyMinutes: 5,
      connectNotice: '연결됨',
      endNotice: '상담이 종료되었어요.',
      failNotice: '실패함',
    });
    expect(settingsRes.status).toBe(200);

    const sessionId = '77777777-7777-4777-8777-777777777777';
    await jsonRequest('POST', `${baseUrl}/public/chatbots/${slug}/messages`, { sessionId, message: '이해할 수 없는 질문' });
    const listRes = await jsonRequest<{ items: Array<{ sessionRef: string }> }>('GET', `${baseUrl}/chatbots/${chatbotId}/live-sessions`);
    const sessionRef = listRes.body.items[0].sessionRef;
    const intervened = await jsonRequest<{ id: string }>('POST', `${baseUrl}/chatbots/${chatbotId}/live-sessions/${sessionRef}/handoff`, {}, { cookie: agentCookie });
    const handoffId = intervened.body.id;

    // 첫 접촉 — features 없이 보내 구버전(LEGACY) 위젯으로 취급되게 한다(G-3).
    const firstContact = await jsonRequest('POST', `${baseUrl}/public/chatbots/${slug}/messages`, { sessionId, message: '안녕하세요' });
    expect(firstContact.status).toBe(200);
    expect('handoff' in (firstContact.body as object)).toBe(false); // LEGACY는 handoff 키가 없다(AC-CS4-7).

    // 상담원이 메시지를 보낸다 — LEGACY 위젯은 폴링하지 않으므로 미전달 상태로 쌓인다.
    const sendRes = await jsonRequest('POST', `${baseUrl}/chatbots/${chatbotId}/handoffs/${handoffId}/messages`, { text: '무엇을 도와드릴까요?' }, { cookie: agentCookie });
    expect(sendRes.status).toBe(201);

    // 시간 종료를 강제한다 — 연결 이후 아무도 응답하지 않은 지 오래된 것처럼 시각을 되돌린다(USER_IDLE, userIdleMinutes=10).
    const longAgo = new Date(Date.now() - 20 * 60_000);
    await prisma.handoffSession.update({
      where: { id: handoffId },
      data: { connectedAt: longAgo, lastAgentMessageAt: longAgo, lastUserMessageAt: longAgo, firstAgentReplyAt: longAgo },
    });

    // 다음 사용자 발화(여전히 LEGACY, features 없음) — 게이트가 조회 시점에 먼저 종료 판정하고(G-1),
    // 같은 요청에서 G-8로 미전달분을 전치해 전달한다.
    const nextTurn = await jsonRequest<{ outputs: Array<{ type: string; payload: { text: string } }> }>('POST', `${baseUrl}/public/chatbots/${slug}/messages`, {
      sessionId,
      message: '거기 있나요?',
    });
    expect(nextTurn.status).toBe(200);
    const texts = nextTurn.body.outputs.filter((o) => o.type === 'TEXT').map((o) => o.payload.text);
    expect(texts).toContain('무엇을 도와드릴까요?');
    expect(texts).toContain('상담이 종료되었어요.');
    // 상담원 메시지·종료 안내가 봇 출력보다 앞에 온다(전치).
    const agentMsgIdx = texts.indexOf('무엇을 도와드릴까요?');
    const endNoticeIdx = texts.indexOf('상담이 종료되었어요.');
    expect(agentMsgIdx).toBeLessThan(texts.length - 1);
    expect(endNoticeIdx).toBeGreaterThan(agentMsgIdx);

    // 커서가 전진해 같은 내용을 다시 전달하지 않는다.
    const thirdTurn = await jsonRequest<{ outputs: Array<{ type: string; payload: { text: string } }> }>('POST', `${baseUrl}/public/chatbots/${slug}/messages`, {
      sessionId,
      message: '또 다른 질문',
    });
    const thirdTexts = thirdTurn.body.outputs.filter((o) => o.type === 'TEXT').map((o) => o.payload.text);
    expect(thirdTexts).not.toContain('무엇을 도와드릴까요?');
    expect(thirdTexts).not.toContain('상담이 종료되었어요.');
  });

  it('정리 루프(R-6): 조회 요청이 전혀 없어도 sweeper.tick() 직접 호출로 시간 종료·원문 파기가 일어난다', async () => {
    const { chatbotId, slug } = await setupPublicChatbot();
    const settingsRes = await jsonRequest('PUT', `${baseUrl}/chatbots/${chatbotId}/handoff-settings`, {
      enabled: true,
      cautionThreshold: 1,
      warningThreshold: 2,
      activeWindowMinutes: 10,
      userIdleMinutes: 10,
      agentNoReplyMinutes: 5,
      connectNotice: '연결됨',
      endNotice: '종료됨',
      failNotice: '실패함',
    });
    expect(settingsRes.status).toBe(200);

    const sessionId = '88888888-8888-4888-8888-888888888888';
    await jsonRequest('POST', `${baseUrl}/public/chatbots/${slug}/messages`, { sessionId, message: '이해할 수 없는 질문' });
    const listRes = await jsonRequest<{ items: Array<{ sessionRef: string }> }>('GET', `${baseUrl}/chatbots/${chatbotId}/live-sessions`);
    const sessionRef = listRes.body.items[0].sessionRef;
    const intervened = await jsonRequest<{ id: string }>('POST', `${baseUrl}/chatbots/${chatbotId}/live-sessions/${sessionRef}/handoff`, {}, { cookie: agentCookie });
    const handoffId = intervened.body.id;

    // 첫 접촉(모던) — 원문이 남는 발화를 하나 넣는다.
    const firstContact = await jsonRequest<{ handoff?: { token?: string } }>('POST', `${baseUrl}/public/chatbots/${slug}/messages`, {
      sessionId,
      message: '제 번호는 010-9999-8888이에요',
      features: ['handoff-v1'],
    });
    expect(firstContact.status).toBe(200);
    const rawRowsBefore = await prisma.handoffMessage.findMany({ where: { handoffSessionId: handoffId, rawText: { not: null } } });
    expect(rawRowsBefore.length).toBeGreaterThan(0);

    // 아무도 다시 조회하지 않은 채로 시간만 지난 것처럼 시각을 되돌린다(USER_IDLE 조건).
    const longAgo = new Date(Date.now() - 20 * 60_000);
    await prisma.handoffSession.update({
      where: { id: handoffId },
      data: { connectedAt: longAgo, lastUserMessageAt: longAgo, lastAgentMessageAt: longAgo, firstAgentReplyAt: longAgo },
    });

    // 클라이언트 요청 없이 정리 루프만 직접 실행한다(타이머 대기 없음 — 결정론적).
    await sweeper.tick();

    const session = await prisma.handoffSession.findUniqueOrThrow({ where: { id: handoffId } });
    expect(session.status).toBe('ENDED');
    expect(session.endReason).toBe('USER_IDLE');
    const rawRowsAfter = await prisma.handoffMessage.findMany({ where: { handoffSessionId: handoffId, rawText: { not: null } } });
    expect(rawRowsAfter).toHaveLength(0);
  });
});
