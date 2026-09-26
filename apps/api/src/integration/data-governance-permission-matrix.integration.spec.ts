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
 * 데이터 거버넌스(No.45) — 권한 매트릭스 통합 시험(★ AC-DG8-1, `data-governance-설계.md` §14).
 * test-automation 보강(2026-09-26) — `environment-separation.integration.spec.ts`의 Q절(ADMIN/EDITOR/
 * VIEWER/AGENT × 11개 엔드포인트 전수)과 같은 형식. 전역 거버넌스 6 + `retention/overrides` 1 +
 * 챗봇 보존 4 + 감사 체인 검증 1 = **12개 엔드포인트**를 4개 역할로 전수 호출한다. 설계 §14는
 * "전부 ADMIN 전용"이라 EDITOR/VIEWER/AGENT는 어떤 조합이든 `403`이어야 한다.
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

describe('데이터 거버넌스(No.45) 통합 시험 — 권한 매트릭스(AC-DG8-1)', () => {
  let app: NestExpressApplication | undefined;
  let tmpDir: string;
  let prisma: PrismaService;
  let baseUrl: string;
  const cookies: Record<TestRole, string> = { ADMIN: '', EDITOR: '', VIEWER: '', AGENT: '' };
  let chatbotId: string;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'data-governance-perm-matrix-test-'));
    const dbPath = join(tmpDir, 'test.db').replace(/\\/g, '/');
    const testDatabaseUrl = `file:${dbPath}`;

    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.DEPLOY_SCHEDULE_ENABLED = 'false';
    process.env.HANDOFF_SWEEPER_ENABLED = 'false';
    process.env.WIDGET_BASE_URL = process.env.WIDGET_BASE_URL ?? 'http://localhost:5174';
    process.env.PUBLIC_API_BASE_URL = process.env.PUBLIC_API_BASE_URL ?? 'http://localhost:3000/api/v1';
    process.env.EMBEDDING_BASE_URL = '';
    process.env.RAG_BASE_URL = '';

    process.env.DATA_GOVERNANCE_MODE = 'ON';
    process.env.DATA_ENCRYPTION_ENABLED = 'false';
    process.env.DATA_ENCRYPTION_KEYS = '';
    process.env.DATA_EGRESS_ALLOWED_HOSTS = '';
    process.env.DATA_RETENTION_JOB_ENABLED = 'false';
    process.env.DATA_REENCRYPT_JOB_ENABLED = 'false';

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

    const group = await prisma.chatbotGroup.create({ data: { name: `그룹-권한매트릭스-${randomUUID().slice(0, 8)}` } });
    const chatbot = await prisma.chatbot.create({ data: { groupId: group.id, name: '권한매트릭스 챗봇', slug: `perm-matrix-${randomUUID().slice(0, 8)}` } });
    chatbotId = chatbot.id;
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await safeCleanupTmpDir(tmpDir);
  }, 30_000);

  const fullDaysNull = { CONVERSATION_TEXT: null, UNANSWERED_CLOSED: null, SURVEY_FREE_TEXT: null, HANDOFF_TEXT: null, CALL_LOGS: null, AUDIT_LOGS: null };
  const chatbotDaysGlobal = { CONVERSATION_TEXT: 'GLOBAL', UNANSWERED_CLOSED: 'GLOBAL', SURVEY_FREE_TEXT: 'GLOBAL', HANDOFF_TEXT: 'GLOBAL' };

  const endpoints: Array<{ label: string; method: string; path: () => string; body?: unknown }> = [
    { label: '전역 1: GET /governance/map', method: 'GET', path: () => '/governance/map' },
    { label: '전역 2: GET /governance/retention', method: 'GET', path: () => '/governance/retention' },
    { label: '전역 3: PUT /governance/retention', method: 'PUT', path: () => '/governance/retention', body: { days: fullDaysNull } },
    { label: '전역 4: POST /governance/retention/preview', method: 'POST', path: () => '/governance/retention/preview', body: { days: {} } },
    { label: '전역 5: POST /governance/retention/pending/cancel', method: 'POST', path: () => '/governance/retention/pending/cancel' },
    { label: '전역 6: GET /governance/retention-runs', method: 'GET', path: () => '/governance/retention-runs' },
    { label: 'overrides: GET /governance/retention/overrides', method: 'GET', path: () => '/governance/retention/overrides' },
    { label: '챗봇 1: GET /chatbots/:id/retention', method: 'GET', path: () => `/chatbots/${chatbotId}/retention` },
    { label: '챗봇 2: PUT /chatbots/:id/retention', method: 'PUT', path: () => `/chatbots/${chatbotId}/retention`, body: { days: chatbotDaysGlobal } },
    { label: '챗봇 3: POST /chatbots/:id/retention/preview', method: 'POST', path: () => `/chatbots/${chatbotId}/retention/preview`, body: { days: {} } },
    { label: '챗봇 4: POST /chatbots/:id/retention/pending/cancel', method: 'POST', path: () => `/chatbots/${chatbotId}/retention/pending/cancel` },
    { label: 'verify: POST /audit-logs/verify', method: 'POST', path: () => '/audit-logs/verify', body: {} },
  ];

  it.each(endpoints)('$label — ADMIN은 403이 아니고, EDITOR/VIEWER/AGENT는 403이다', async ({ method, path, body }) => {
    const adminRes = await jsonRequest(method, `${baseUrl}${path()}`, body, { Cookie: cookies.ADMIN });
    expect(adminRes.status).not.toBe(403);

    for (const role of ['EDITOR', 'VIEWER', 'AGENT'] as TestRole[]) {
      const res = await jsonRequest<{ code?: string }>(method, `${baseUrl}${path()}`, body, { Cookie: cookies[role] });
      expect(res.status).toBe(403);
    }
  });

  it('감사: 권한 거부는 FORBIDDEN 코드로 응답한다(기존 규약)', async () => {
    const res = await jsonRequest<{ code: string }>('GET', `${baseUrl}/governance/map`, undefined, { Cookie: cookies.VIEWER });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });
});
