import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import * as http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { VersioningType } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { AllExceptionsFilter } from '../common/all-exceptions.filter';
import type { PrismaService } from '../prisma/prisma.service';
import { loginAs, seedTestUsers } from './helpers/auth.helper';

/**
 * 선제적(Proactive) 메시징(No.35) — `PROACTIVE_ENABLED=false` 회귀(AC-PA5-6). 기본값(true)과
 * 다른 값이라 `proactive-messaging.integration.spec.ts`와 **별도 파일**로 둔다(`CLAUDE.md` 규약 ·
 * `data-governance-off.integration.spec.ts` 선례 — 모듈 레지스트리가 파일 단위로 격리된다).
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
      { method, hostname, port, path: pathname + search, headers: { ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}), ...headers } },
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

describe('선제적(Proactive) 메시징(No.35) — PROACTIVE_ENABLED=false 회귀', () => {
  let app: NestExpressApplication | undefined;
  let tmpDir: string;
  let prisma: PrismaService;
  let baseUrl: string;
  let adminCookie: string;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'proactive-messaging-off-test-'));
    const dbPath = join(tmpDir, 'test.db').replace(/\\/g, '/');
    const testDatabaseUrl = `file:${dbPath}`;

    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.DEPLOY_SCHEDULE_ENABLED = 'false';
    process.env.HANDOFF_SWEEPER_ENABLED = 'false';
    process.env.WIDGET_BASE_URL = process.env.WIDGET_BASE_URL ?? 'http://localhost:5174';
    process.env.PUBLIC_API_BASE_URL = process.env.PUBLIC_API_BASE_URL ?? 'http://localhost:3000/api/v1';
    process.env.PROACTIVE_ENABLED = 'false';

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
    adminCookie = await loginAs(baseUrl, 'ADMIN');
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await safeCleanupTmpDir(tmpDir);
  });

  const admin = <T = unknown>(method: string, path: string, body?: unknown) => jsonRequest<T>(method, `${baseUrl}${path}`, body, { Cookie: adminCookie });
  const publicReq = <T = unknown>(method: string, path: string, body?: unknown) => jsonRequest<T>(method, `${baseUrl}${path}`, body);

  it('AC-PA5-6: 서버 스위치가 꺼지면 조회는 규칙 0 · 수집은 카운터 불변 · 관리 API는 계속 동작한다', async () => {
    const groupRes = await admin<{ id: string }>('POST', '/chatbot-groups', { name: `선제꺼짐그룹 ${randomUUID().slice(0, 8)}` });
    const slug = `pa-off-${randomUUID().slice(0, 8)}`;
    const createRes = await admin<{ id: string }>('POST', '/chatbots', { groupId: groupRes.body.id, name: '선제꺼짐봇', slug });
    const chatbotId = createRes.body.id;
    await admin('PATCH', `/chatbots/${chatbotId}/status`, { status: 'ACTIVE' });
    await admin('PATCH', `/chatbots/${chatbotId}/channels/WEB`, { enabled: true, config: { allowedOrigins: [], greetingMessage: '안녕하세요' } });

    // 관리 API는 서버 스위치와 무관하게 계속 동작하고 serverEnabled=false를 알려준다.
    const settingsRes = await admin('PUT', `/chatbots/${chatbotId}/proactive/settings`, { enabled: true, maxPerSession: 1, minIntervalSec: 60, quietAfterUserMessageSec: 300 });
    expect(settingsRes.status).toBe(200);
    const ruleRes = await admin<{ id: string }>('POST', `/chatbots/${chatbotId}/proactive/rules`, {
      name: '규칙',
      trigger: { kind: 'PAGE_DWELL', pathInclude: ['/**'], pathExclude: [], dwellSec: 30 },
      text: '안내',
      buttons: [],
      devices: ['DESKTOP'],
      purposeConfirmed: true,
    });
    expect(ruleRes.status).toBe(201);
    const enableRes = await admin('POST', `/chatbots/${chatbotId}/proactive/rules/${ruleRes.body.id}/enable`);
    expect(enableRes.status).toBe(200);

    const overview = await admin<{ serverEnabled: boolean }>('GET', `/chatbots/${chatbotId}/proactive`);
    expect(overview.body.serverEnabled).toBe(false);

    // 공개 조회는 규칙이 있어도 빈 배열이다.
    const publicConfig = await publicReq<{ proactive?: { rules: unknown[] } }>('GET', `/public/chatbots/${slug}/config?proactive=1`);
    expect(publicConfig.body.proactive?.rules).toEqual([]);

    // 수집은 무시(204)하고 카운터가 변하지 않는다.
    const eventRes = await publicReq('POST', `/public/chatbots/${slug}/proactive-events`, { sessionId: randomUUID(), ruleId: ruleRes.body.id, kind: 'SHOWN' });
    expect(eventRes.status).toBe(204);
    const statCount = await prisma.proactiveDailyStat.count({ where: { ruleId: ruleRes.body.id } });
    expect(statCount).toBe(0);
  });
});
