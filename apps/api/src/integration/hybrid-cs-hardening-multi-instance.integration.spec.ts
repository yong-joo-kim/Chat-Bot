import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import * as http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { INestApplication, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { normalizeEmail } from '@chat-bot/shared-types';
import { AllExceptionsFilter } from '../common/all-exceptions.filter';
import { PrismaService } from '../prisma/prisma.service';
import { hashPassword } from '../common/auth/lib/password-hash';
import { loginAs, seedTestUsers, TEST_PASSWORD } from './helpers/auth.helper';

const API_ROOT = join(__dirname, '..', '..');

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

async function safeCleanupTmpDir(dir: string): Promise<void> {
  await new Promise((r) => setTimeout(r, 300));
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {
    // 정리 실패는 테스트 판정에 영향 없음.
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

/**
 * 하이브리드 CS(No.24) 배정 경합 — 다중 인스턴스(AC-CS3-1, No.28
 * `scheduled-deploy-multi-instance.integration.spec.ts` 하네스 재사용). 별도 파일로 분리한 이유는
 * 앱 인스턴스 2개를 동시에 띄우고 종료 순서를 관리해야 해서다(선례와 동일).
 *
 * ⚠ `prisma db push`는 `schema.prisma`에 선언할 수 없는 부분 유니크 인덱스(마이그레이션 전용 raw
 * SQL, `handoff_sessions_active_key` — "한 세션에 활성 상담 1건"의 실제 잠금)를 만들지 않는다.
 * 실제 배포는 `prisma migrate deploy`로 이 인덱스를 적용하지만, 이 저장소의 통합 시험은 전부
 * `db push --accept-data-loss`를 쓰므로(속도) 이 인덱스가 **한 번도 시험 DB에 존재하지 않았다** —
 * 그 결과 동시 개입 경합 시나리오를 처음 작성했을 때 두 요청이 모두 201로 성공해 버렸다(경합 보호가
 * 전혀 검증되지 않고 있었다는 뜻). 마이그레이션과 동일한 SQL을 `$executeRawUnsafe`로 직접 적용해
 * 실제 배포와 같은 조건을 재현한다.
 */
describe('하이브리드 CS(No.24) 보강 통합 시험 — 3-b절: 다중 인스턴스 동시 개입(AC-CS3-1)', () => {
  let app1: INestApplication;
  let app2: INestApplication;
  let baseUrl1: string;
  let baseUrl2: string;
  let tmpDir: string;
  let prisma1: PrismaService;
  let agentCookie1 = '';
  let agentCookie2 = '';

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'chatbot-handoff-multi-'));
    const dbPath = join(tmpDir, 'test.db').replace(/\\/g, '/');
    const testDatabaseUrl = `file:${dbPath}`;

    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.DEPLOY_SCHEDULE_ENABLED = 'false';
    process.env.HANDOFF_SWEEPER_ENABLED = 'false';
    process.env.WIDGET_BASE_URL = process.env.WIDGET_BASE_URL ?? 'http://localhost:5174';
    process.env.PUBLIC_API_BASE_URL = process.env.PUBLIC_API_BASE_URL ?? 'http://localhost:3000/api/v1';

    execSync('pnpm exec prisma migrate deploy', {
      cwd: API_ROOT,
      env: { ...process.env, DATABASE_URL: testDatabaseUrl },
      stdio: 'pipe',
    });

    const { AppModule } = await import('../app.module');

    const moduleRef1 = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app1 = moduleRef1.createNestApplication();
    app1.setGlobalPrefix('api');
    app1.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app1.useGlobalFilters(new AllExceptionsFilter());
    prisma1 = moduleRef1.get(PrismaService);
    // db push가 만들지 않는 부분 유니크 인덱스를 마이그레이션과 동일하게 직접 적용한다(위 주석 참고).
    await prisma1.$executeRawUnsafe(
      'CREATE UNIQUE INDEX IF NOT EXISTS "handoff_sessions_active_key" ON "handoff_sessions"("chatbotId", "sessionId") WHERE "status" IN (\'CONNECTING\', \'CONNECTED\')',
    );
    await app1.listen(0);
    const server1 = app1.getHttpServer() as http.Server;
    const address1 = server1.address();
    const port1 = typeof address1 === 'object' && address1 !== null ? address1.port : 0;
    baseUrl1 = `http://127.0.0.1:${port1}/api/v1`;

    const moduleRef2 = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app2 = moduleRef2.createNestApplication();
    app2.setGlobalPrefix('api');
    app2.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app2.useGlobalFilters(new AllExceptionsFilter());
    await app2.listen(0);
    const server2 = app2.getHttpServer() as http.Server;
    const address2 = server2.address();
    const port2 = typeof address2 === 'object' && address2 !== null ? address2.port : 0;
    baseUrl2 = `http://127.0.0.1:${port2}/api/v1`;

    await seedTestUsers(prisma1);
    agentCookie1 = await loginAs(baseUrl1, 'AGENT');
    const passwordHash = await hashPassword(TEST_PASSWORD);
    const email2 = normalizeEmail('integration-test-agent2@chat-bot.local');
    await prisma1.user.upsert({ where: { email: email2 }, update: {}, create: { email: email2, name: 'AGENT2', role: 'AGENT', passwordHash, mustChangePassword: false, status: 'ACTIVE' } });
    const loginRes2 = await jsonRequest<Record<string, unknown>>('POST', `${baseUrl2}/auth/login`, { email: email2, password: TEST_PASSWORD });
    const setCookie2 = loginRes2.headers['set-cookie'];
    agentCookie2 = (Array.isArray(setCookie2) ? setCookie2[0] : setCookie2)!.split(';')[0];
  }, 60_000);

  afterAll(async () => {
    await app1?.close();
    await app2?.close();
    await safeCleanupTmpDir(tmpDir);
  });

  it('서로 다른 앱 인스턴스에서 온 동시 개입 요청도 DB 유니크 제약이 걸려 1건만 성공한다(프로세스 로컬 락에 의존하지 않음)', async () => {
    const adminCookie1 = await loginAs(baseUrl1, 'ADMIN');
    const group = await jsonRequest<{ id: string }>('POST', `${baseUrl1}/chatbot-groups`, { name: `다중인스턴스그룹 ${Math.random().toString(36).slice(2, 8)}` }, { cookie: adminCookie1 });
    const slug = `cs-multi-${Math.random().toString(36).slice(2, 10)}`;
    const create = await jsonRequest<{ id: string }>('POST', `${baseUrl1}/chatbots`, { groupId: group.body.id, name: '다중인스턴스봇', slug }, { cookie: adminCookie1 });
    const chatbotId = create.body.id;
    await jsonRequest('PATCH', `${baseUrl1}/chatbots/${chatbotId}/status`, { status: 'ACTIVE' }, { cookie: adminCookie1 });
    await jsonRequest('PATCH', `${baseUrl1}/chatbots/${chatbotId}/channels/WEB`, { enabled: true, config: { allowedOrigins: [], greetingMessage: 'hi' } }, { cookie: adminCookie1 });
    await jsonRequest('PUT', `${baseUrl1}/chatbots/${chatbotId}/handoff-settings`, DEFAULT_SETTINGS, { cookie: adminCookie1 });

    const sessionId = randomUUID();
    await jsonRequest('POST', `${baseUrl1}/public/chatbots/${slug}/messages`, { sessionId, message: '이해할 수 없는 질문입니다' });
    const listRes = await jsonRequest<{ items: Array<{ sessionRef: string }> }>('GET', `${baseUrl1}/chatbots/${chatbotId}/live-sessions`, undefined, { cookie: adminCookie1 });
    const sessionRef = listRes.body.items[0].sessionRef;

    const [resFromApp1, resFromApp2] = await Promise.all([
      jsonRequest('POST', `${baseUrl1}/chatbots/${chatbotId}/live-sessions/${sessionRef}/handoff`, {}, { cookie: agentCookie1 }),
      jsonRequest('POST', `${baseUrl2}/chatbots/${chatbotId}/live-sessions/${sessionRef}/handoff`, {}, { cookie: agentCookie2 }),
    ]);
    const statuses = [resFromApp1.status, resFromApp2.status].sort();
    expect(statuses).toEqual([201, 409]);

    const activeCount = await prisma1.handoffSession.count({ where: { chatbotId, sessionId, status: { in: ['CONNECTING', 'CONNECTED'] } } });
    expect(activeCount).toBe(1);
  });
});
