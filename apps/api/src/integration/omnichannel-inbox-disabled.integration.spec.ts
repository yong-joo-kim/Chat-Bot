import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import * as http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHmac } from 'node:crypto';
import { VersioningType } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { AppModule as AppModuleType } from '../app.module';
import { Test } from '@nestjs/testing';
import { AllExceptionsFilter } from '../common/all-exceptions.filter';
import type { PrismaService as PrismaServiceType } from '../prisma/prisma.service';
import { loginAs, seedTestUsers } from './helpers/auth.helper';

/**
 * [No.42] `OMNI_INBOX_ENABLED=false`(EX-OC-18) — 별도 파일(CLAUDE.md 규약 · legacy-api-integration-
 * disabled 선례). `ConfigModule.forRoot()`가 정적 import 시점에 env를 스냅샷하므로 `AppModule`을
 * 동적 import로 읽는다.
 */
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

function b64url(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

function signToken(payload: Record<string, unknown>, secret: string): string {
  const h = b64url({ alg: 'HS256' });
  const p = b64url(payload);
  const sig = createHmac('sha256', Buffer.from(secret, 'utf8')).update(`${h}.${p}`).digest('base64url');
  return `${h}.${p}.${sig}`;
}

describe('옴니채널 통합 인박스(No.42) — OMNI_INBOX_ENABLED=false(EX-OC-18)', () => {
  it('인박스·설정 API는 전부 404이고, 공개 대화 경로는 식별 헤더가 있어도 응답이 변하지 않는다', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'chatbot-inbox-disabled-test-'));
    const dbPath = join(tmpDir, 'test.db').replace(/\\/g, '/');
    const testDatabaseUrl = `file:${dbPath}`;

    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.DEPLOY_SCHEDULE_ENABLED = 'false';
    process.env.HANDOFF_SWEEPER_ENABLED = 'false';
    process.env.WIDGET_BASE_URL = process.env.WIDGET_BASE_URL ?? 'http://localhost:5174';
    process.env.PUBLIC_API_BASE_URL = process.env.PUBLIC_API_BASE_URL ?? 'http://localhost:3000/api/v1';
    process.env.OMNI_INBOX_ENABLED = 'false';
    process.env.OMNI_CUSTOMER_KEY_SECRET = 'ck-secret-'.padEnd(32, '0');
    process.env.OMNI_IDENTITY_SECRET__OFFSPACE = 'off-secret-'.padEnd(32, '1');

    let app: NestExpressApplication | undefined;
    try {
      execSync('pnpm exec prisma migrate deploy', { cwd: API_ROOT, env: { ...process.env, DATABASE_URL: testDatabaseUrl }, stdio: 'pipe' });

      const { AppModule } = (await import('../app.module')) as { AppModule: typeof AppModuleType };
      const { PrismaService } = (await import('../prisma/prisma.service')) as { PrismaService: typeof PrismaServiceType };
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

      app = moduleRef.createNestApplication<NestExpressApplication>();
      app.setGlobalPrefix('api');
      app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
      app.useGlobalFilters(new AllExceptionsFilter());
      const prisma = moduleRef.get(PrismaService);

      await app.listen(0);
      const server = app.getHttpServer() as http.Server;
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      const baseUrl = `http://127.0.0.1:${port}/api/v1`;

      await seedTestUsers(prisma);
      const adminCookie = await loginAs(baseUrl, 'ADMIN');

      const listRes = await jsonRequest('GET', `${baseUrl}/inbox/threads`, undefined, { Cookie: adminCookie });
      expect(listRes.status).toBe(404);

      const groupRes = await jsonRequest<{ id: string }>('POST', `${baseUrl}/chatbot-groups`, { name: '인박스 꺼짐 그룹' }, { Cookie: adminCookie });
      const chatbotRes = await jsonRequest<{ id: string }>('POST', `${baseUrl}/chatbots`, { groupId: groupRes.body.id, name: '인박스 꺼짐 봇', slug: `inbox-off-${Math.random().toString(36).slice(2, 8)}` }, { Cookie: adminCookie });
      const chatbotId = chatbotRes.body.id;
      await jsonRequest('PATCH', `${baseUrl}/chatbots/${chatbotId}/status`, { status: 'ACTIVE' }, { Cookie: adminCookie });
      await jsonRequest('PATCH', `${baseUrl}/chatbots/${chatbotId}/channels/WEB`, { enabled: true, config: { allowedOrigins: [], greetingMessage: '안녕' } }, { Cookie: adminCookie });

      const settingsRes = await jsonRequest('GET', `${baseUrl}/chatbots/${chatbotId}/inbox-settings`, undefined, { Cookie: adminCookie });
      expect(settingsRes.status).toBe(404);

      const slug = (await jsonRequest<{ slug: string }>('GET', `${baseUrl}/chatbots/${chatbotId}`, undefined, { Cookie: adminCookie })).body.slug;
      const sessionId = '99999999-9999-4999-8999-999999999999';
      const now = Math.floor(Date.now() / 1000);
      const token = signToken({ sub: 'member-off', iat: now, exp: now + 3600 }, 'off-secret-'.padEnd(32, '1'));

      const withoutHeader = await jsonRequest<Record<string, unknown>>('POST', `${baseUrl}/public/chatbots/${slug}/messages`, { sessionId, message: '안녕하세요' });
      const withHeader = await jsonRequest<Record<string, unknown>>(
        'POST',
        `${baseUrl}/public/chatbots/${slug}/messages`,
        { sessionId: '88888888-8888-4888-8888-888888888888', message: '안녕하세요' },
        { 'x-cb-identity': token },
      );
      expect(withHeader.status).toBe(withoutHeader.status);
      expect(Object.keys(withHeader.body).sort()).toEqual(Object.keys(withoutHeader.body).sort());

      const customerCount = await prisma.customer.count();
      expect(customerCount).toBe(0);
    } finally {
      await app?.close();
      await safeCleanupTmpDir(tmpDir);
    }
  }, 60_000);
});
