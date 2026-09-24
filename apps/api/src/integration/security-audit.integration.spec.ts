import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import * as http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INestApplication, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../app.module';
import { AllExceptionsFilter } from '../common/all-exceptions.filter';
import { PrismaService } from '../prisma/prisma.service';
import { loginAs, seedTestUsers, TEST_PASSWORD } from './helpers/auth.helper';

const API_ROOT = join(__dirname, '..', '..');

interface ApiResponse<T = unknown> {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: T;
}

function jsonRequest<T = unknown>(
  method: string,
  url: string,
  body?: unknown,
  headers: Record<string, string> = {},
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

function extractCookie(res: ApiResponse): string | undefined {
  const setCookie = res.headers['set-cookie'];
  const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return raw?.split(';')[0];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 보안/이력(No.12~13) 통합 테스트. 인증/RBAC/금지어필터/감사이력의 HTTP 계약 레벨 핵심 경로를 검증한다.
 * 전 AC/EX의 소진적 검증은 test-automation 단계에서 확장한다.
 */
describe('보안/이력(No.12~13) 통합 테스트', () => {
  let app: INestApplication;
  let baseUrl: string;
  let tmpDir: string;
  let prisma: PrismaService;
  let adminCookie: string;
  let viewerCookie: string;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'chatbot-security-audit-test-'));
    const dbPath = join(tmpDir, 'test.db').replace(/\\/g, '/');
    const testDatabaseUrl = `file:${dbPath}`;

    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.DEPLOY_SCHEDULE_ENABLED = 'false'; // [No.28] 실행 엔진 비활성 — 기존 그룹 통합 시험은 폴링 없이 수행(§7.10)
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

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
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
    viewerCookie = await loginAs(baseUrl, 'VIEWER');
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  /** `ConversationLogService.record()`는 await 하지 않는 fire-and-forget이다(FR-11-24) — 짧게 폴링한다. */
  async function waitForConversationLog(chatbotId: string) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const log = await prisma.conversationLog.findFirst({ where: { chatbotId }, orderBy: { createdAt: 'desc' } });
      if (log) return log;
      await sleep(50);
    }
    return null;
  }

  describe('인증(auth)', () => {
    it('AC-12A-1: 올바른 자격증명으로 로그인하면 200과 Set-Cookie를 반환한다', async () => {
      const res = await jsonRequest('POST', `${baseUrl}/auth/login`, {
        email: 'integration-test-admin@chat-bot.local',
        password: TEST_PASSWORD,
      });
      expect(res.status).toBe(200);
      expect((res.body as { user: { email: string } }).user.email).toBe('integration-test-admin@chat-bot.local');
      expect(extractCookie(res)).toMatch(/^cb_session=/);
      const bodyStr = JSON.stringify(res.body);
      expect(bodyStr).not.toMatch(/passwordHash/i);
    });

    it('AC-12A-2: 존재하지 않는 이메일과 틀린 비밀번호는 동일한 401/문구를 반환한다(계정 열거 방지)', async () => {
      const noSuchEmail = await jsonRequest('POST', `${baseUrl}/auth/login`, {
        email: 'no-such-user@chat-bot.local',
        password: 'whatever123!',
      });
      const wrongPassword = await jsonRequest('POST', `${baseUrl}/auth/login`, {
        email: 'integration-test-viewer@chat-bot.local',
        password: 'definitely-wrong-password',
      });
      expect(noSuchEmail.status).toBe(401);
      expect(wrongPassword.status).toBe(401);
      expect((noSuchEmail.body as { code: string }).code).toBe('INVALID_CREDENTIALS');
      expect((noSuchEmail.body as { message: string }).message).toBe((wrongPassword.body as { message: string }).message);
    });

    it('AC-12A-4: 5회 연속 실패하면 6번째(올바른 비밀번호 포함)는 401 ACCOUNT_LOCKED다', async () => {
      const email = 'lockout-target@chat-bot.local';
      await jsonRequest('POST', `${baseUrl}/users`, { email, name: '잠금 대상', role: 'VIEWER' }, { Cookie: adminCookie });

      for (let i = 0; i < 5; i += 1) {
        const res = await jsonRequest('POST', `${baseUrl}/auth/login`, { email, password: 'wrong-password-attempt' });
        expect(res.status).toBe(401);
      }
      const locked = await jsonRequest('POST', `${baseUrl}/auth/login`, { email, password: 'wrong-password-attempt' });
      expect(locked.status).toBe(401);
      expect((locked.body as { code: string }).code).toBe('ACCOUNT_LOCKED');
    });

    it('로그아웃은 멱등하게 204를 반환한다(FR-12-8)', async () => {
      const login = await jsonRequest('POST', `${baseUrl}/auth/login`, {
        email: 'integration-test-viewer@chat-bot.local',
        password: TEST_PASSWORD,
      });
      const cookie = extractCookie(login) as string;
      const first = await jsonRequest('POST', `${baseUrl}/auth/logout`, undefined, { Cookie: cookie });
      const second = await jsonRequest('POST', `${baseUrl}/auth/logout`, undefined, { Cookie: cookie });
      expect(first.status).toBe(204);
      expect(second.status).toBe(204);

      const afterLogout = await jsonRequest('GET', `${baseUrl}/auth/me`, undefined, { Cookie: cookie });
      expect(afterLogout.status).toBe(401);
    });
  });

  describe('권한(RBAC)', () => {
    it('AC-12B-1: 미인증 요청은 401 UNAUTHENTICATED다', async () => {
      const res = await jsonRequest('GET', `${baseUrl}/chatbots`);
      expect(res.status).toBe(401);
      expect((res.body as { code: string }).code).toBe('UNAUTHENTICATED');
    });

    it('AC-12B-3/AC-12B-7: VIEWER는 조회는 되지만 쓰기는 403이며 응답에 요구 권한 문자열이 없다', async () => {
      const read = await jsonRequest('GET', `${baseUrl}/chatbots`, undefined, { Cookie: viewerCookie });
      expect(read.status).toBe(200);

      const write = await jsonRequest('POST', `${baseUrl}/chatbot-groups`, { name: '뷰어 시도 그룹' }, { Cookie: viewerCookie });
      expect(write.status).toBe(403);
      expect((write.body as { code: string }).code).toBe('FORBIDDEN');
      expect(JSON.stringify(write.body)).not.toMatch(/chatbot:write/);
    });

    it('AC-12B-12/FR-13-9: 권한 거부는 PERMISSION_DENIED로 기록된다', async () => {
      await jsonRequest('POST', `${baseUrl}/chatbot-groups`, { name: '권한거부 기록용 시도' }, { Cookie: viewerCookie });
      const logs = await jsonRequest<{ items: Array<{ action: string; actorEmail: string | null }> }>(
        'GET',
        `${baseUrl}/audit-logs?action=PERMISSION_DENIED`,
        undefined,
        { Cookie: adminCookie },
      );
      expect(logs.status).toBe(200);
      const match = logs.body.items.find((i) => i.actorEmail === 'integration-test-viewer@chat-bot.local');
      expect(match).toBeDefined();
    });

    it('AC-12B-6: 이력 조회는 ADMIN만 가능하다', async () => {
      const asAdmin = await jsonRequest('GET', `${baseUrl}/audit-logs`, undefined, { Cookie: adminCookie });
      const asViewer = await jsonRequest('GET', `${baseUrl}/audit-logs`, undefined, { Cookie: viewerCookie });
      expect(asAdmin.status).toBe(200);
      expect(asViewer.status).toBe(403);
    });

    it('AC-12B-8: 역할 강등이 재로그인 없이 다음 요청부터 반영된다(DD-42 — 캐시 없음)', async () => {
      const created = await jsonRequest<{ user: { id: string }; temporaryPassword: string }>(
        'POST',
        `${baseUrl}/users`,
        { email: 'demote-target@chat-bot.local', name: '강등 대상', role: 'EDITOR' },
        { Cookie: adminCookie },
      );
      const targetId = created.body.user.id;

      // 임시 비밀번호는 mustChangePassword=true를 강제하므로, 비밀번호부터 변경해야 다른 API를 쓸 수 있다(FR-12-13).
      const login = await jsonRequest('POST', `${baseUrl}/auth/login`, {
        email: 'demote-target@chat-bot.local',
        password: created.body.temporaryPassword,
      });
      const targetCookie = extractCookie(login) as string;
      const changePassword = await jsonRequest(
        'POST',
        `${baseUrl}/auth/password`,
        { currentPassword: created.body.temporaryPassword, newPassword: 'Editor-New-Pass#9' },
        { Cookie: targetCookie },
      );
      expect(changePassword.status).toBe(204);
      const targetCookieAfterChange = extractCookie(changePassword) ?? targetCookie;

      const beforeDemote = await jsonRequest('POST', `${baseUrl}/chatbot-groups`, { name: 'EDITOR 권한 확인용 그룹' }, { Cookie: targetCookieAfterChange });
      expect(beforeDemote.status).toBe(201);

      await jsonRequest('PATCH', `${baseUrl}/users/${targetId}`, { role: 'VIEWER' }, { Cookie: adminCookie });

      const afterDemote = await jsonRequest('POST', `${baseUrl}/chatbot-groups`, { name: 'EDITOR 권한 확인용 그룹2' }, { Cookie: targetCookieAfterChange });
      expect(afterDemote.status).toBe(403);
    });
  });

  describe('회원 관리', () => {
    it('AC-12C-1/AC-12C-7: 회원 등록 시 임시 비밀번호가 1회 반환되고 목록에는 해시가 없다', async () => {
      const res = await jsonRequest<{ user: { id: string }; temporaryPassword: string }>(
        'POST',
        `${baseUrl}/users`,
        { email: 'new-member@chat-bot.local', name: '신규 회원', role: 'VIEWER' },
        { Cookie: adminCookie },
      );
      expect(res.status).toBe(201);
      expect(typeof res.body.temporaryPassword).toBe('string');
      expect(res.body.temporaryPassword.length).toBeGreaterThan(0);

      const list = await jsonRequest('GET', `${baseUrl}/users`, undefined, { Cookie: adminCookie });
      expect(JSON.stringify(list.body)).not.toMatch(/passwordHash/i);
    });

    it('AC-12C-2: 대소문자만 다른 이메일 중복 등록은 409 DUPLICATE_EMAIL이다', async () => {
      await jsonRequest('POST', `${baseUrl}/users`, { email: 'dup-check@chat-bot.local', name: 'A', role: 'VIEWER' }, { Cookie: adminCookie });
      const dup = await jsonRequest('POST', `${baseUrl}/users`, { email: 'DUP-CHECK@Chat-Bot.local', name: 'B', role: 'VIEWER' }, { Cookie: adminCookie });
      expect(dup.status).toBe(409);
      expect((dup.body as { code: string }).code).toBe('DUPLICATE_EMAIL');
    });

    it('AC-12C-5/AC-12C-6/C-2: 유일한 ACTIVE ADMIN 강등은 409 LAST_ADMIN, 2명 이상이면 200이다', async () => {
      const admins = await jsonRequest<{ items: Array<{ id: string }> }>(
        'GET',
        `${baseUrl}/users?role=ADMIN&status=ACTIVE&pageSize=100`,
        undefined,
        { Cookie: adminCookie },
      );
      expect(admins.body.items).toHaveLength(1);
      const onlyAdminId = admins.body.items[0].id;

      // 유일한 ACTIVE ADMIN(=요청자 자신)을 강등 시도 → LAST_ADMIN이 SELF_MODIFICATION보다 먼저 판정된다(C-2).
      const demoteLastAdmin = await jsonRequest('PATCH', `${baseUrl}/users/${onlyAdminId}`, { role: 'VIEWER' }, { Cookie: adminCookie });
      expect(demoteLastAdmin.status).toBe(409);
      expect((demoteLastAdmin.body as { code: string }).code).toBe('LAST_ADMIN');

      // 두 번째 ADMIN이 생기면 더 이상 마지막 관리자가 아니므로, 그 계정의 강등은 성공한다(AC-12C-6).
      const secondAdmin = await jsonRequest<{ user: { id: string } }>(
        'POST',
        `${baseUrl}/users`,
        { email: 'second-admin@chat-bot.local', name: '두번째 관리자', role: 'ADMIN' },
        { Cookie: adminCookie },
      );
      const demoteOther = await jsonRequest('PATCH', `${baseUrl}/users/${secondAdmin.body.user.id}`, { role: 'VIEWER' }, { Cookie: adminCookie });
      expect(demoteOther.status).toBe(200);
    });

    it('code-reviewer Medium/Low: 상태를 실제로 바꾸지 않는 자기 자신 요청은 SELF_MODIFICATION 없이 200이고, 실제 변경 시도만 409다(update()와의 게이팅 대칭)', async () => {
      // ACTIVE ADMIN이 2명 이상이어야 LAST_ADMIN이 아니라 SELF_MODIFICATION 게이팅 자체를 검증할 수 있다.
      await jsonRequest(
        'POST',
        `${baseUrl}/users`,
        { email: 'self-mod-gating-admin@chat-bot.local', name: '게이팅 검증용 관리자', role: 'ADMIN' },
        { Cookie: adminCookie },
      );

      const me = await jsonRequest<{ id: string; status: string }>('GET', `${baseUrl}/auth/me`, undefined, { Cookie: adminCookie });
      expect(me.body.status).toBe('ACTIVE');

      // 현재 값과 동일한 상태로의 자기 자신 PATCH는 실질적 변경이 없으므로 통과해야 한다(update()의 roleChanging 게이팅과 대칭).
      const noopSelf = await jsonRequest('PATCH', `${baseUrl}/users/${me.body.id}/status`, { status: 'ACTIVE' }, { Cookie: adminCookie });
      expect(noopSelf.status).toBe(200);

      // 실제로 자기 자신의 상태를 바꾸려는 시도는 여전히 409 SELF_MODIFICATION이다(LAST_ADMIN이 아님을 위에서 보장).
      const realSelfChange = await jsonRequest('PATCH', `${baseUrl}/users/${me.body.id}/status`, { status: 'DISABLED' }, { Cookie: adminCookie });
      expect(realSelfChange.status).toBe(409);
      expect((realSelfChange.body as { code: string }).code).toBe('SELF_MODIFICATION');
    });
  });

  describe('금지어 필터', () => {
    it('AC-12D-7: /banned-words/test는 탐지·마스킹·정책을 반환한다', async () => {
      await jsonRequest('POST', `${baseUrl}/banned-words`, { word: '통합테스트금지어', matchType: 'CONTAINS', policy: 'BLOCK' }, { Cookie: adminCookie });
      const res = await jsonRequest<{ decision: string; maskedText: string }>(
        'POST',
        `${baseUrl}/banned-words/test`,
        { text: '이건 통합테스트금지어 문장입니다' },
        { Cookie: adminCookie },
      );
      expect(res.status).toBe(200);
      expect(res.body.decision).toBe('BLOCK');
      expect(res.body.maskedText).toContain('***');
    });

    it('AC-12D-1/AC-12D-2: 공개 대화에서 BLOCK 단어는 엔진을 타지 않고 고정 안내를 반환하며 로그가 마스킹·차단 표기된다', async () => {
      const group = await jsonRequest<{ id: string }>('POST', `${baseUrl}/chatbot-groups`, { name: '금지어 파이프라인 그룹' }, { Cookie: adminCookie });
      const suffix = Math.random().toString(36).slice(2, 10);
      const slug = `banned-word-bot-${suffix}`;
      const chatbot = await jsonRequest<{ id: string }>(
        'POST',
        `${baseUrl}/chatbots`,
        { groupId: group.body.id, name: '금지어 파이프라인 챗봇', slug },
        { Cookie: adminCookie },
      );
      const chatbotId = chatbot.body.id;
      await jsonRequest('PATCH', `${baseUrl}/chatbots/${chatbotId}/status`, { status: 'ACTIVE' }, { Cookie: adminCookie });
      await jsonRequest(
        'PATCH',
        `${baseUrl}/chatbots/${chatbotId}/channels/WEB`,
        { enabled: true, config: { allowedOrigins: [] } },
        { Cookie: adminCookie },
      );

      const sessionId = randomUUID();
      const res = await jsonRequest<{ outputs: Array<{ type: string; payload: { text: string } }>; stateReset: boolean }>(
        'POST',
        `${baseUrl}/public/chatbots/${slug}/messages`,
        { sessionId, message: '이건 통합테스트금지어 문장입니다' },
      );
      expect(res.status).toBe(200);
      expect(res.body.outputs).toHaveLength(1);
      expect(res.body.outputs[0].payload.text).toBe('바람직하지 않은 표현이 포함되어 있습니다. 다시 입력해 주세요.');
      expect(res.body.stateReset).toBe(false);

      // 로그 적재는 await 하지 않는 fire-and-forget이다(FR-11-24) — 짧게 폴링해 반영을 기다린다.
      const log = await waitForConversationLog(chatbotId);
      expect(log?.blockedByFilter).toBe(true);
      expect(log?.isAnswered).toBe(false);
      expect(log?.userMessage).not.toContain('통합테스트금지어');
    });

    it('AC-12D-5: 관리자 시뮬레이션 API는 같은 금지어 입력에 필터를 적용하지 않는다(FR-12-42)', async () => {
      await jsonRequest(
        'POST',
        `${baseUrl}/banned-words`,
        { word: '시뮬금지어검증용', matchType: 'CONTAINS', policy: 'BLOCK' },
        { Cookie: adminCookie },
      );
      const group = await jsonRequest<{ id: string }>(
        'POST',
        `${baseUrl}/chatbot-groups`,
        { name: '시뮬레이션 금지어 미적용 그룹' },
        { Cookie: adminCookie },
      );
      const suffix = Math.random().toString(36).slice(2, 10);
      const chatbot = await jsonRequest<{ id: string }>(
        'POST',
        `${baseUrl}/chatbots`,
        { groupId: group.body.id, name: '시뮬레이션 금지어 미적용 챗봇', slug: `sim-banned-word-bot-${suffix}` },
        { Cookie: adminCookie },
      );
      const chatbotId = chatbot.body.id;

      const res = await jsonRequest<{ outputs: Array<{ type: string; payload: { text: string } }> }>(
        'POST',
        `${baseUrl}/chatbots/${chatbotId}/simulate`,
        { message: '이건 시뮬금지어검증용 문장입니다' },
        { Cookie: adminCookie },
      );
      // 시뮬레이션은 금지어 필터를 전혀 알지 못하는 경로다(SimulationService가 BannedWordFilterService를
      // 주입받지 않음) — 공개 대화였다면 나왔을 고정 차단 안내문이 아니라 엔진의 원본 동작(미해석 폴백 등)이
      // 그대로 나와야 한다.
      expect(res.status).toBe(200);
      const text = res.body.outputs[0]?.payload?.text ?? '';
      expect(text).not.toBe('바람직하지 않은 표현이 포함되어 있습니다. 다시 입력해 주세요.');
    });
  });

  describe('이력(감사로그)', () => {
    it('AC-13-*: 챗봇 그룹 생성이 CREATE 이력으로 기록된다(9개 모듈 소급 최소 1케이스)', async () => {
      const created = await jsonRequest<{ id: string; name: string }>(
        'POST',
        `${baseUrl}/chatbot-groups`,
        { name: '이력 검증용 그룹' },
        { Cookie: adminCookie },
      );
      const logs = await jsonRequest<{ items: Array<{ action: string; targetType: string; targetId: string }> }>(
        'GET',
        `${baseUrl}/audit-logs?targetType=ChatbotGroup&q=${encodeURIComponent('이력 검증용 그룹')}`,
        undefined,
        { Cookie: adminCookie },
      );
      const match = logs.body.items.find((i) => i.targetId === created.body.id && i.action === 'CREATE');
      expect(match).toBeDefined();
    });

    it('FR-13-17: 조회 기간이 90일을 초과하면 400 AUDIT_RANGE_TOO_WIDE다', async () => {
      const from = new Date();
      from.setDate(from.getDate() - 200);
      const res = await jsonRequest(
        'GET',
        `${baseUrl}/audit-logs?from=${from.toISOString()}&to=${new Date().toISOString()}`,
        undefined,
        { Cookie: adminCookie },
      );
      expect(res.status).toBe(400);
      expect((res.body as { code: string }).code).toBe('AUDIT_RANGE_TOO_WIDE');
    });

    it('이력에는 수정/삭제 API가 존재하지 않는다(FR-13-14/20)', async () => {
      const patch = await jsonRequest('PATCH', `${baseUrl}/audit-logs/some-id`, {}, { Cookie: adminCookie });
      const del = await jsonRequest('DELETE', `${baseUrl}/audit-logs/some-id`, undefined, { Cookie: adminCookie });
      expect(patch.status).toBe(404);
      expect(del.status).toBe(404);
    });
  });
});
