import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import * as http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VersioningType } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { AllExceptionsFilter } from '../common/all-exceptions.filter';
import type { PrismaService } from '../prisma/prisma.service';
import { loginAs, seedTestUsers, type TestRole } from './helpers/auth.helper';

const API_ROOT = join(__dirname, '..', '..');

async function safeCleanupTmpDir(dir: string): Promise<void> {
  await new Promise((r) => setTimeout(r, 300));
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {
    // 정리 실패는 판정에 영향 없음.
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
 * 옴니채널 통합 인박스(No.42) — 권한 매트릭스 통합 시험(§11 · `workflow-permission-matrix.integration.
 * spec.ts` 형식). 역할 4종 × 엔드포인트 32개(§14.1) 전수 호출. 더미 id를 써 서비스 내부 로직까지
 * 들어가지 않게 한다 — 가드(+ 일부는 서비스 ADMIN 재검증)를 통과한 역할은 `403`만 아니면 된다
 * (`404`/`409`/`400`도 "허용"으로 판정 — 권한 판정과 자원 존재 판정을 분리한다).
 */
describe('옴니채널 통합 인박스(No.42) 통합 시험 — 권한 매트릭스(역할 4종 × 32핸들러)', () => {
  let app: NestExpressApplication | undefined;
  let tmpDir: string;
  let prisma: PrismaService;
  let baseUrl: string;
  const cookies: Record<TestRole, string> = { ADMIN: '', EDITOR: '', VIEWER: '', AGENT: '' };
  let chatbotId: string;
  const dummyId = '00000000-0000-4000-8000-000000000000';
  const dummySessionRef = '0123456789abcdef';

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'inbox-perm-matrix-test-'));
    const dbPath = join(tmpDir, 'test.db').replace(/\\/g, '/');
    const testDatabaseUrl = `file:${dbPath}`;

    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.DEPLOY_SCHEDULE_ENABLED = 'false';
    process.env.HANDOFF_SWEEPER_ENABLED = 'false';
    process.env.WIDGET_BASE_URL = process.env.WIDGET_BASE_URL ?? 'http://localhost:5174';
    process.env.PUBLIC_API_BASE_URL = process.env.PUBLIC_API_BASE_URL ?? 'http://localhost:3000/api/v1';

    try {
      execSync('pnpm exec prisma migrate deploy', { cwd: API_ROOT, env: { ...process.env, DATABASE_URL: testDatabaseUrl }, stdio: 'pipe' });
    } catch (e) {
      const err = e as { stdout?: Buffer; stderr?: Buffer };
      throw new Error(`prisma migrate deploy 실패:\n${err.stdout?.toString()}\n${err.stderr?.toString()}`);
    }

    const { AppModule } = await import('../app.module');
    const { PrismaService: PrismaServiceClass } = await import('../prisma/prisma.service');

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    app.enableCors();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalFilters(new AllExceptionsFilter());
    prisma = moduleRef.get(PrismaServiceClass);

    await app.listen(0);
    const server = app.getHttpServer() as http.Server;
    const address = server.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;
    baseUrl = `http://127.0.0.1:${port}/api/v1`;

    await seedTestUsers(prisma);
    for (const role of ['ADMIN', 'EDITOR', 'VIEWER', 'AGENT'] as TestRole[]) {
      cookies[role] = await loginAs(baseUrl, role);
    }

    const group = await prisma.chatbotGroup.create({ data: { name: `그룹-인박스권한-${randomUUID().slice(0, 8)}` } });
    const chatbot = await prisma.chatbot.create({ data: { groupId: group.id, name: '인박스 권한매트릭스 챗봇', slug: `inbox-perm-matrix-${randomUUID().slice(0, 8)}` } });
    chatbotId = chatbot.id;
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await safeCleanupTmpDir(tmpDir);
  }, 30_000);

  type MatrixRole = TestRole;
  const ALL_ROLES: MatrixRole[] = ['ADMIN', 'EDITOR', 'VIEWER', 'AGENT'];
  const CS_READ: MatrixRole[] = ['ADMIN', 'EDITOR', 'AGENT']; // VIEWER 제외
  const CS_WRITE: MatrixRole[] = ['ADMIN', 'AGENT']; // EDITOR·VIEWER 제외
  const SIM_WRITE_AND_CS_READ: MatrixRole[] = ['ADMIN', 'EDITOR']; // AGENT는 simulation:write가 없다
  const ADMIN_ONLY: MatrixRole[] = ['ADMIN'];
  const CHATBOT_READ: MatrixRole[] = ALL_ROLES; // 전 역할 조회 가능
  const CHATBOT_WRITE: MatrixRole[] = ['ADMIN', 'EDITOR'];

  const endpoints: Array<{ label: string; method: string; path: () => string; body?: unknown | (() => unknown); allowed: MatrixRole[] }> = [
    // InboxThreadsController — 14개
    { label: '1: GET /inbox/threads', method: 'GET', path: () => '/inbox/threads', allowed: CS_READ },
    { label: '2: GET /inbox/threads/summary', method: 'GET', path: () => '/inbox/threads/summary', allowed: CS_READ },
    { label: '3: GET /inbox/assignees', method: 'GET', path: () => '/inbox/assignees', allowed: CS_READ },
    { label: '4: POST /inbox/threads/open', method: 'POST', path: () => '/inbox/threads/open', body: () => ({ chatbotId, sessionRef: dummySessionRef }), allowed: CS_WRITE },
    { label: '5: POST /inbox/mask-preview', method: 'POST', path: () => '/inbox/mask-preview', body: { text: '미리보기' }, allowed: CS_WRITE },
    { label: '6: GET /inbox/threads/:threadId', method: 'GET', path: () => `/inbox/threads/${dummyId}`, allowed: CS_READ },
    { label: '7: PATCH /inbox/threads/:threadId', method: 'PATCH', path: () => `/inbox/threads/${dummyId}`, body: { status: 'OPEN', version: 0 }, allowed: CS_WRITE },
    { label: '8: POST /inbox/threads/:threadId/claim', method: 'POST', path: () => `/inbox/threads/${dummyId}/claim`, body: {}, allowed: CS_WRITE },
    { label: '9: POST /inbox/threads/:threadId/assign', method: 'POST', path: () => `/inbox/threads/${dummyId}/assign`, body: { userId: dummyId, version: 0 }, allowed: CS_WRITE },
    { label: '10: POST /inbox/threads/:threadId/release', method: 'POST', path: () => `/inbox/threads/${dummyId}/release`, body: { version: 0 }, allowed: CS_WRITE },
    { label: '11: PUT /inbox/threads/:threadId/tags', method: 'PUT', path: () => `/inbox/threads/${dummyId}/tags`, body: { tagIds: [], version: 0 }, allowed: CS_WRITE },
    { label: '12: POST /inbox/threads/:threadId/notes', method: 'POST', path: () => `/inbox/threads/${dummyId}/notes`, body: { text: '메모' }, allowed: CS_WRITE },
    { label: '13: PATCH /inbox/threads/:threadId/notes/:entryId', method: 'PATCH', path: () => `/inbox/threads/${dummyId}/notes/${dummyId}`, body: { text: '메모' }, allowed: CS_WRITE },
    {
      label: '14: POST /inbox/threads/:threadId/records',
      method: 'POST',
      path: () => `/inbox/threads/${dummyId}/records`,
      body: { recordChannel: 'PHONE', direction: 'INBOUND', occurredAt: new Date().toISOString(), text: '기록' },
      allowed: CS_WRITE,
    },
    // InboxCustomersController — 8개
    { label: '15: POST /inbox/customers/search', method: 'POST', path: () => '/inbox/customers/search', body: {}, allowed: CS_READ },
    { label: '16: POST /inbox/customers', method: 'POST', path: () => '/inbox/customers', body: {}, allowed: CS_WRITE },
    { label: '17: GET /inbox/session-link', method: 'GET', path: () => `/inbox/session-link?chatbotId=${chatbotId}&sessionRef=${dummySessionRef}`, allowed: CS_READ },
    { label: '18: GET /inbox/identity-spaces', method: 'GET', path: () => '/inbox/identity-spaces', allowed: CS_READ },
    { label: '19: POST /inbox/customers/:customerId/links', method: 'POST', path: () => `/inbox/customers/${dummyId}/links`, body: () => ({ chatbotId, sessionRef: dummySessionRef }), allowed: CS_WRITE },
    { label: '20: DELETE /inbox/customers/:customerId/links/:linkId', method: 'DELETE', path: () => `/inbox/customers/${dummyId}/links/${dummyId}`, allowed: CS_WRITE },
    { label: '21: POST /inbox/customers/:customerId/merge', method: 'POST', path: () => `/inbox/customers/${dummyId}/merge`, body: { targetCustomerId: dummyId }, allowed: CS_WRITE },
    { label: '22: POST /inbox/merges/:mergeId/revert', method: 'POST', path: () => `/inbox/merges/${dummyId}/revert`, allowed: CS_WRITE },
    // InboxTestCustomersController — 3개(simulation:write AND cs:read)
    { label: '23: POST /inbox/test-customers', method: 'POST', path: () => '/inbox/test-customers', body: { label: '시험' }, allowed: SIM_WRITE_AND_CS_READ },
    { label: '24: DELETE /inbox/test-customers/:customerId', method: 'DELETE', path: () => `/inbox/test-customers/${dummyId}`, allowed: SIM_WRITE_AND_CS_READ },
    {
      label: '25: POST /inbox/test-customers/:customerId/simulate',
      method: 'POST',
      path: () => `/inbox/test-customers/${dummyId}/simulate`,
      body: () => ({ chatbotId, simulatedChannel: 'KAKAOTALK', message: '안녕' }),
      allowed: SIM_WRITE_AND_CS_READ,
    },
    // InboxTagsController — 4개(변경은 cs:write 가드 + 서비스 ADMIN 재검증 — 최종 허용은 ADMIN뿐)
    { label: '26: GET /inbox/tags', method: 'GET', path: () => '/inbox/tags', allowed: CS_READ },
    { label: '27: POST /inbox/tags', method: 'POST', path: () => '/inbox/tags', body: { name: `권한시험-${randomUUID().slice(0, 6)}`, color: 'BLUE' }, allowed: ADMIN_ONLY },
    { label: '28: PATCH /inbox/tags/:tagId', method: 'PATCH', path: () => `/inbox/tags/${dummyId}`, body: { name: '이름', color: 'BLUE' }, allowed: ADMIN_ONLY },
    { label: '29: DELETE /inbox/tags/:tagId', method: 'DELETE', path: () => `/inbox/tags/${dummyId}`, allowed: ADMIN_ONLY },
    // ChatbotInboxSettingsController — 3개
    { label: '30: GET /chatbots/:chatbotId/inbox-settings', method: 'GET', path: () => `/chatbots/${chatbotId}/inbox-settings`, allowed: CHATBOT_READ },
    { label: '31: PUT /chatbots/:chatbotId/inbox-settings', method: 'PUT', path: () => `/chatbots/${chatbotId}/inbox-settings`, body: { enabled: true, openOnWarning: false }, allowed: CHATBOT_WRITE },
    { label: '32: PUT /chatbots/:chatbotId/inbox-settings/identity', method: 'PUT', path: () => `/chatbots/${chatbotId}/inbox-settings/identity`, body: { identitySecretRef: null }, allowed: ADMIN_ONLY },
  ];

  it('엔드포인트 정의가 정확히 32개다(§14.1 규모 회귀 가드)', () => {
    expect(endpoints).toHaveLength(32);
  });

  for (const ep of endpoints) {
    for (const role of ALL_ROLES) {
      const shouldAllow = ep.allowed.includes(role);
      it(`${ep.label} — ${role}은 ${shouldAllow ? '허용(403 아님)' : '거부(403)'}된다`, async () => {
        const resolvedBody = typeof ep.body === 'function' ? (ep.body as () => unknown)() : ep.body;
        const res = await jsonRequest(ep.method, `${baseUrl}${ep.path()}`, resolvedBody, { Cookie: cookies[role] });
        if (shouldAllow) {
          expect(res.status).not.toBe(403);
        } else {
          expect(res.status).toBe(403);
        }
      });
    }
  }

  it('감사 — 권한 거부는 FORBIDDEN 코드로 응답한다(기존 규약)', async () => {
    const res = await jsonRequest<{ code: string }>('GET', `${baseUrl}/inbox/threads`, undefined, { Cookie: cookies.VIEWER });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  it('AC-OC4-7: 태그 생성은 EDITOR·AGENT 둘 다 서비스 ADMIN 재검증으로 403이다(가드만으로는 구분되지 않는 지점)', async () => {
    const editorRes = await jsonRequest<{ code: string }>('POST', `${baseUrl}/inbox/tags`, { name: `재검증-${randomUUID().slice(0, 6)}`, color: 'BLUE' }, { Cookie: cookies.EDITOR });
    expect(editorRes.status).toBe(403);
    const agentRes = await jsonRequest<{ code: string }>('POST', `${baseUrl}/inbox/tags`, { name: `재검증-${randomUUID().slice(0, 6)}`, color: 'BLUE' }, { Cookie: cookies.AGENT });
    expect(agentRes.status).toBe(403);
  });
});
