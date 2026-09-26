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

/**
 * 업무 자동화 워크플로우(No.41) — 권한 매트릭스 통합 시험(코드 리뷰 R1 시험 공백 (e)).
 * `data-governance-permission-matrix.integration.spec.ts`·`environment-separation.integration.spec.ts`
 * Q절과 같은 형식 — 역할 4종 × 엔드포인트 21개(§12.1) 전수 호출. `allowed`는 `security.ts`의
 * `ROLE_PERMISSIONS`에서 도출한 기대값이다(ADMIN=전 권한 · EDITOR=chatbot:*·dialogue:read·cs:read ·
 * VIEWER=읽기(chatbot:read·dialogue:read) · AGENT=chatbot:read + cs:*뿐 — dialogue:read·chatbot:write·
 * security:*가 없다).
 *
 * 실제 서비스 로직까지 들어가지 않도록(사전 자원 존재 불필요) 더미 id를 쓴다 — 권한 가드는 컨트롤러
 * 경계에서 서비스 호출 전에 판정하므로, 허용된 역할이 더미 id로 404를 받아도 `403`만 아니면 된다.
 */

const API_ROOT = join(__dirname, '..', '..');

async function safeCleanupTmpDir(dir: string): Promise<void> {
  await new Promise((r) => setTimeout(r, 300));
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {
    // 정리 실패는 판정에 영향 없음(Windows 파일 핸들 지연 해제).
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
      {
        method,
        hostname,
        port,
        path: pathname + search,
        headers: { ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}), ...headers },
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

describe('업무 자동화 워크플로우(No.41) 통합 시험 — 권한 매트릭스', () => {
  let app: NestExpressApplication | undefined;
  let tmpDir: string;
  let prisma: PrismaService;
  let baseUrl: string;
  const cookies: Record<TestRole, string> = { ADMIN: '', EDITOR: '', VIEWER: '', AGENT: '' };
  let chatbotId: string;
  const dummyId = '00000000-0000-4000-8000-000000000000';

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'workflow-perm-matrix-test-'));
    const dbPath = join(tmpDir, 'test.db').replace(/\\/g, '/');
    const testDatabaseUrl = `file:${dbPath}`;

    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.DEPLOY_SCHEDULE_ENABLED = 'false';
    process.env.HANDOFF_SWEEPER_ENABLED = 'false';
    process.env.WIDGET_BASE_URL = process.env.WIDGET_BASE_URL ?? 'http://localhost:5174';
    process.env.PUBLIC_API_BASE_URL = process.env.PUBLIC_API_BASE_URL ?? 'http://localhost:3000/api/v1';
    process.env.EMBEDDING_BASE_URL = '';
    process.env.RAG_BASE_URL = '';
    process.env.WORKFLOW_ENABLED = 'true';
    process.env.WORKFLOW_DISPATCH_ENABLED = 'false';

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

    const group = await prisma.chatbotGroup.create({ data: { name: `그룹-워크플로우권한-${randomUUID().slice(0, 8)}` } });
    const chatbot = await prisma.chatbot.create({ data: { groupId: group.id, name: '워크플로우 권한매트릭스 챗봇', slug: `wf-perm-matrix-${randomUUID().slice(0, 8)}` } });
    chatbotId = chatbot.id;
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await safeCleanupTmpDir(tmpDir);
  }, 30_000);

  type MatrixRole = TestRole;
  const ALL_ROLES: MatrixRole[] = ['ADMIN', 'EDITOR', 'VIEWER', 'AGENT'];

  const endpoints: Array<{ label: string; method: string; path: () => string; body?: unknown; allowed: MatrixRole[] }> = [
    // WorkflowTargetsController — 9개
    { label: '1: GET /workflow-targets', method: 'GET', path: () => '/workflow-targets', allowed: ['ADMIN'] },
    { label: '2: GET /workflow-targets/picker', method: 'GET', path: () => '/workflow-targets/picker', allowed: ['ADMIN', 'EDITOR', 'VIEWER'] },
    {
      label: '3: POST /workflow-targets',
      method: 'POST',
      path: () => '/workflow-targets',
      body: { name: `권한시험-${randomUUID().slice(0, 8)}`, baseUrl: 'https://wf-perm-test.example.invalid/hook' },
      allowed: ['ADMIN'],
    },
    { label: '4: GET /workflow-targets/:id', method: 'GET', path: () => `/workflow-targets/${dummyId}`, allowed: ['ADMIN'] },
    { label: '5: PATCH /workflow-targets/:id', method: 'PATCH', path: () => `/workflow-targets/${dummyId}`, body: {}, allowed: ['ADMIN'] },
    { label: '6: DELETE /workflow-targets/:id', method: 'DELETE', path: () => `/workflow-targets/${dummyId}`, allowed: ['ADMIN'] },
    { label: '7: POST /workflow-targets/:id/test', method: 'POST', path: () => `/workflow-targets/${dummyId}/test`, body: {}, allowed: ['ADMIN'] },
    { label: '8: POST /workflow-targets/:id/pause', method: 'POST', path: () => `/workflow-targets/${dummyId}/pause`, allowed: ['ADMIN'] },
    { label: '9: POST /workflow-targets/:id/resume', method: 'POST', path: () => `/workflow-targets/${dummyId}/resume`, allowed: ['ADMIN'] },
    // WorkflowRunsController — 2개
    { label: '10: GET /workflow-runs', method: 'GET', path: () => '/workflow-runs', allowed: ['ADMIN'] },
    { label: '11: GET /workflow-runs/summary', method: 'GET', path: () => '/workflow-runs/summary', allowed: ['ADMIN'] },
    // ChatbotWorkflowController — 10개
    { label: '12: GET /chatbots/:id/workflow-subscriptions', method: 'GET', path: () => `/chatbots/${chatbotId}/workflow-subscriptions`, allowed: ['ADMIN', 'EDITOR', 'VIEWER'] },
    {
      label: '13: POST /chatbots/:id/workflow-subscriptions',
      method: 'POST',
      path: () => `/chatbots/${chatbotId}/workflow-subscriptions`,
      body: { eventType: 'HANDOFF_STARTED', targetId: dummyId },
      allowed: ['ADMIN', 'EDITOR'],
    },
    {
      label: '14: PATCH /chatbots/:id/workflow-subscriptions/:subscriptionId',
      method: 'PATCH',
      path: () => `/chatbots/${chatbotId}/workflow-subscriptions/${dummyId}`,
      body: {},
      allowed: ['ADMIN', 'EDITOR'],
    },
    {
      label: '15: DELETE /chatbots/:id/workflow-subscriptions/:subscriptionId',
      method: 'DELETE',
      path: () => `/chatbots/${chatbotId}/workflow-subscriptions/${dummyId}`,
      allowed: ['ADMIN', 'EDITOR'],
    },
    {
      label: '16: POST /chatbots/:id/workflow-subscriptions/:subscriptionId/pause',
      method: 'POST',
      path: () => `/chatbots/${chatbotId}/workflow-subscriptions/${dummyId}/pause`,
      allowed: ['ADMIN', 'EDITOR'],
    },
    {
      label: '17: POST /chatbots/:id/workflow-subscriptions/:subscriptionId/resume',
      method: 'POST',
      path: () => `/chatbots/${chatbotId}/workflow-subscriptions/${dummyId}/resume`,
      allowed: ['ADMIN', 'EDITOR'],
    },
    { label: '18: GET /chatbots/:id/workflow-runs', method: 'GET', path: () => `/chatbots/${chatbotId}/workflow-runs`, allowed: ['ADMIN', 'EDITOR', 'VIEWER'] },
    { label: '19: GET /chatbots/:id/workflow-runs/summary', method: 'GET', path: () => `/chatbots/${chatbotId}/workflow-runs/summary`, allowed: ['ADMIN', 'EDITOR', 'VIEWER'] },
    {
      label: '20: POST /chatbots/:id/workflow-runs/retry',
      method: 'POST',
      path: () => `/chatbots/${chatbotId}/workflow-runs/retry`,
      body: { runIds: [dummyId] },
      allowed: ['ADMIN', 'EDITOR'],
    },
    {
      label: '21: POST /chatbots/:id/workflow-runs/cancel',
      method: 'POST',
      path: () => `/chatbots/${chatbotId}/workflow-runs/cancel`,
      body: { runIds: [dummyId] },
      allowed: ['ADMIN', 'EDITOR'],
    },
  ];

  it('엔드포인트 정의가 정확히 21개다(§12.1 규모 회귀 가드)', () => {
    expect(endpoints).toHaveLength(21);
  });

  for (const ep of endpoints) {
    for (const role of ALL_ROLES) {
      const shouldAllow = ep.allowed.includes(role);
      it(`${ep.label} — ${role}은 ${shouldAllow ? '허용(403 아님)' : '거부(403)'}된다`, async () => {
        const res = await jsonRequest(ep.method, `${baseUrl}${ep.path()}`, ep.body, { Cookie: cookies[role] });
        if (shouldAllow) {
          expect(res.status).not.toBe(403);
        } else {
          expect(res.status).toBe(403);
        }
      });
    }
  }

  it('감사 — 권한 거부는 FORBIDDEN 코드로 응답한다(기존 규약)', async () => {
    const res = await jsonRequest<{ code: string }>('GET', `${baseUrl}/workflow-targets`, undefined, { Cookie: cookies.VIEWER });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });
});
