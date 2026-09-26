import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import * as http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VersioningType } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { AllExceptionsFilter } from '../common/all-exceptions.filter';
import type { PrismaService as PrismaServiceType } from '../prisma/prisma.service';
import { loginAs, seedTestUsers } from './helpers/auth.helper';

const API_ROOT = join(__dirname, '..', '..');

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
 * 옴니채널 통합 인박스(No.42) — 열람 감사(`VIEW`) 3화면 dedupe(§12.2 · O-19). `DATA_GOVERNANCE_MODE=ON`
 * 필요 — `data-governance-view-export-audit.integration.spec.ts` 선례와 같은 동적 import 패턴.
 */
describe('옴니채널 통합 인박스(No.42) — 열람 감사(VIEW) dedupe(목록 · 상세 · 고객 검색)', () => {
  let app: NestExpressApplication | undefined;
  let tmpDir: string;
  let prisma: PrismaServiceType;
  let baseUrl: string;
  let adminCookie = '';

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'chatbot-inbox-view-audit-test-'));
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
    const { PrismaService } = (await import('../prisma/prisma.service')) as { PrismaService: typeof PrismaServiceType };
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    app.enableCors();
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
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await safeCleanupTmpDir(tmpDir);
  }, 15_000);

  function admin<T = unknown>(method: string, path: string, body?: unknown): Promise<ApiResponse<T>> {
    return jsonRequest<T>(method, `${baseUrl}${path}`, body, { Cookie: adminCookie });
  }

  /** `@AuditView`의 `recordView()`는 커밋 후 fire-and-forget(await 없음)이다 — 폴링으로 확인한다(CLAUDE.md). */
  async function waitForViewCount(where: { targetType: string; targetId: string }, atLeast: number, timeoutMs = 3000): Promise<number> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const count = await prisma.auditLog.count({ where: { action: 'VIEW', targetType: where.targetType as never, targetId: where.targetId } });
      if (count >= atLeast || Date.now() > deadline) return count;
      await new Promise((r) => setTimeout(r, 20));
    }
  }

  it('GET /inbox/threads(목록) — 같은 열람자·같은 날짜에 2회 호출해도 VIEW 감사는 1건이다', async () => {
    const before = await prisma.auditLog.count({ where: { action: 'VIEW', targetType: 'InboxThread', targetId: '*' } });
    await admin('GET', '/inbox/threads');
    await waitForViewCount({ targetType: 'InboxThread', targetId: '*' }, before + 1); // 1차 fire-and-forget 완료 대기.
    await admin('GET', '/inbox/threads');
    const after = await waitForViewCount({ targetType: 'InboxThread', targetId: '*' }, before + 1);
    expect(after - before).toBe(1);
  });

  it('GET /inbox/threads/:threadId(상세) — 같은 스레드를 2회 조회해도 VIEW 감사는 1건이다', async () => {
    const created = await admin<{ threadId: string }>('POST', '/inbox/customers', { displayName: 'VIEW 감사 확인' });
    const threadId = created.body.threadId;

    const before = await prisma.auditLog.count({ where: { action: 'VIEW', targetType: 'InboxThread', targetId: threadId } });
    await admin('GET', `/inbox/threads/${threadId}`);
    await waitForViewCount({ targetType: 'InboxThread', targetId: threadId }, before + 1);
    await admin('GET', `/inbox/threads/${threadId}`);
    const after = await waitForViewCount({ targetType: 'InboxThread', targetId: threadId }, before + 1);
    expect(after - before).toBe(1);
  });

  it('POST /inbox/customers/search(고객 검색) — 같은 열람자·같은 날짜에 2회 호출해도 VIEW 감사는 1건이다', async () => {
    const before = await prisma.auditLog.count({ where: { action: 'VIEW', targetType: 'Customer', targetId: '*' } });
    await admin('POST', '/inbox/customers/search', { q: 'aaaa' });
    await waitForViewCount({ targetType: 'Customer', targetId: '*' }, before + 1);
    await admin('POST', '/inbox/customers/search', { q: 'bbbb' });
    const after = await waitForViewCount({ targetType: 'Customer', targetId: '*' }, before + 1);
    expect(after - before).toBe(1);
  });

  it('GET /inbox/session-link(세션 연결 조회)는 열람 감사 대상이 아니다(K-9 — 대화 텍스트가 없다)', async () => {
    const before = await prisma.auditLog.count({ where: { action: 'VIEW' } });
    const groupRes = await admin<{ id: string }>('POST', '/chatbot-groups', { name: 'VIEW 비대상 그룹' });
    const chatbotRes = await admin<{ id: string }>('POST', '/chatbots', { groupId: groupRes.body.id, name: 'VIEW 비대상 봇', slug: `view-na-${Math.random().toString(36).slice(2, 8)}` });
    await admin('GET', `/inbox/session-link?chatbotId=${chatbotRes.body.id}&sessionRef=0123456789abcdef`);
    await new Promise((r) => setTimeout(r, 300)); // 없음을 확인하는 케이스 — 짧게 대기 후 불변을 본다.
    const after = await prisma.auditLog.count({ where: { action: 'VIEW' } });
    expect(after).toBe(before);
  });
});
