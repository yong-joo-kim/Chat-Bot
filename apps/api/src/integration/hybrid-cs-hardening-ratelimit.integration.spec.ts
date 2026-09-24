import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import * as http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { INestApplication, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AllExceptionsFilter } from '../common/all-exceptions.filter';
import { PrismaService } from '../prisma/prisma.service';
import { loginAs, seedTestUsers } from './helpers/auth.helper';

const API_ROOT = join(__dirname, '..', '..');
const HANDOFF_SESSION_HEADER = 'x-cb-session-id';

/**
 * 하이브리드 CS(No.24) 보강 통합 시험 — 4절(레이트리밋 격리 K-1) 전용 파일.
 *
 * ⚠ 별도 파일로 분리한 이유(중요): 이 절은 `PUBLIC_POLL_RATE_LIMIT_IP_PER_MIN` 등을 낮게 재정의한
 * 전용 앱 인스턴스가 필요하다. `jest.isolate-env.js` 주석대로 `ConfigModule` 스냅샷은 **그 테스트
 * 파일이 `AppModule`을 처음 require하는 시점**에 고정된다 — 한 파일 안에 정적 import(예:
 * `hybrid-cs-hardening.integration.spec.ts`)와 동적 import가 섞이면, 동적 `import('../app.module')`도
 * Node의 모듈 캐시를 그대로 반환해 새 env가 반영되지 않는다(실측 확인 — 같은 파일에 두면 429가
 * 전혀 발생하지 않았다). Jest는 테스트 파일 단위로 모듈 레지스트리를 격리하므로, 이 절만 별도
 * 파일로 두면 동적 import가 이 파일의 낮은 상한으로 새로 평가된다(No.28
 * `scheduled-deploy-multi-instance.integration.spec.ts` 분리 선례와 같은 이유).
 */

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

describe('하이브리드 CS(No.24) 보강 통합 시험 — 4절: 레이트리밋 격리(K-1)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let tmpDir: string;
  let adminCookie = '';

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'chatbot-handoff-ratelimit-'));
    const dbPath = join(tmpDir, 'test.db').replace(/\\/g, '/');
    const testDatabaseUrl = `file:${dbPath}`;

    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.DEPLOY_SCHEDULE_ENABLED = 'false';
    process.env.WIDGET_BASE_URL = process.env.WIDGET_BASE_URL ?? 'http://localhost:5174';
    process.env.PUBLIC_API_BASE_URL = process.env.PUBLIC_API_BASE_URL ?? 'http://localhost:3000/api/v1';
    // K-1 재현을 위해 낮은 상한을 쓴다 — poll-ip 5/분, 상담 폴링 세션 키 2/분, 일반 ip/session은
    // 넉넉히 둬서 "일반 전송은 전혀 소진되지 않는다"를 명확히 구분한다.
    process.env.PUBLIC_POLL_RATE_LIMIT_IP_PER_MIN = '5';
    process.env.PUBLIC_HANDOFF_POLL_RATE_LIMIT_SESSION_PER_MIN = '2';
    process.env.PUBLIC_RATE_LIMIT_IP_PER_MIN = '100';
    process.env.PUBLIC_RATE_LIMIT_SESSION_PER_MIN = '100';

    execSync('pnpm exec prisma migrate deploy', {
      cwd: API_ROOT,
      env: { ...process.env, DATABASE_URL: testDatabaseUrl },
      stdio: 'pipe',
    });

    const { AppModule } = await import('../app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalFilters(new AllExceptionsFilter());
    const prisma = moduleRef.get(PrismaService);

    await app.listen(0);
    const server = app.getHttpServer() as http.Server;
    const address = server.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;
    baseUrl = `http://127.0.0.1:${port}/api/v1`;

    await seedTestUsers(prisma);
    adminCookie = await loginAs(baseUrl, 'ADMIN');
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await safeCleanupTmpDir(tmpDir);
  });

  it('poll-ip(5/분)·poll-key(세션, 2/분) 상한이 각각 걸리고, 폴링이 일반 메시지 전송(ip/session 버킷)을 전혀 소진하지 않는다(K-1)', async () => {
    const group = await jsonRequest<{ id: string }>('POST', `${baseUrl}/chatbot-groups`, { name: `레이트리밋 그룹 ${Math.random().toString(36).slice(2, 8)}` }, { cookie: adminCookie });
    const slug = `cs-rl-${Math.random().toString(36).slice(2, 10)}`;
    const create = await jsonRequest<{ id: string }>('POST', `${baseUrl}/chatbots`, { groupId: group.body.id, name: '레이트리밋봇', slug }, { cookie: adminCookie });
    await jsonRequest('PATCH', `${baseUrl}/chatbots/${create.body.id}/status`, { status: 'ACTIVE' }, { cookie: adminCookie });
    await jsonRequest('PATCH', `${baseUrl}/chatbots/${create.body.id}/channels/WEB`, { enabled: true, config: { allowedOrigins: [], greetingMessage: 'hi' } }, { cookie: adminCookie });
    await jsonRequest('PUT', `${baseUrl}/chatbots/${create.body.id}/handoff-settings`, DEFAULT_SETTINGS, { cookie: adminCookie });

    // ① poll-key(세션 A, 상한 2) — 2회는 통과, 3회째는 poll-ip에 여유가 있어도 429다.
    const sessionA = randomUUID();
    expect((await jsonRequest('GET', `${baseUrl}/public/chatbots/${slug}/handoff?after=0`, undefined, { headers: { [HANDOFF_SESSION_HEADER]: sessionA } })).status).toBe(200);
    expect((await jsonRequest('GET', `${baseUrl}/public/chatbots/${slug}/handoff?after=0`, undefined, { headers: { [HANDOFF_SESSION_HEADER]: sessionA } })).status).toBe(200);
    const sessionAThird = await jsonRequest('GET', `${baseUrl}/public/chatbots/${slug}/handoff?after=0`, undefined, { headers: { [HANDOFF_SESSION_HEADER]: sessionA } });
    expect(sessionAThird.status).toBe(429); // poll-key(A) 상한 — 이 시점 poll-ip 누적은 3/5.

    // ② 키를 바꿔가며(세션 B·C) 우회를 시도해도 poll-ip(상한 5, 이미 3 소진) 축이 걸어 잠근다.
    expect((await jsonRequest('GET', `${baseUrl}/public/chatbots/${slug}/handoff?after=0`, undefined, { headers: { [HANDOFF_SESSION_HEADER]: randomUUID() } })).status).toBe(200); // poll-ip 4/5
    expect((await jsonRequest('GET', `${baseUrl}/public/chatbots/${slug}/handoff?after=0`, undefined, { headers: { [HANDOFF_SESSION_HEADER]: randomUUID() } })).status).toBe(200); // poll-ip 5/5
    const bypassAttempt = await jsonRequest('GET', `${baseUrl}/public/chatbots/${slug}/handoff?after=0`, undefined, { headers: { [HANDOFF_SESSION_HEADER]: randomUUID() } });
    expect(bypassAttempt.status).toBe(429); // 새 키(세션 D)인데도 poll-ip 상한(6번째 요청)에 걸린다 — 우회 불가.

    // ③ poll-ip가 소진된 상태에서도 일반 메시지 전송(`ip:`/`session:` 버킷, poll-ip와 별도 축)은 200이다.
    const send = await jsonRequest('POST', `${baseUrl}/public/chatbots/${slug}/messages`, { sessionId: randomUUID(), message: '안녕하세요' });
    expect(send.status).toBe(200);
  });
});
