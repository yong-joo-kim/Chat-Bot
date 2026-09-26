import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import * as http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VersioningType } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { AppModule as AppModuleType } from '../app.module';
import { Test } from '@nestjs/testing';
import { AllExceptionsFilter } from '../common/all-exceptions.filter';
import { PrismaService } from '../prisma/prisma.service';
import { loginAs, seedTestUsers } from './helpers/auth.helper';

/**
 * [신규 No.41] `WORKFLOW_ENABLED=false` — 별도 파일(legacy-api-integration-disabled 선례와 같은
 * 이유: `ConfigModule.forRoot()`가 동기 스냅샷이라 같은 파일 안에서 두 번째 동적 import로 값을
 * 바꿀 수 없다). 모드 OFF에서는 노드 방출이 전부 `SKIPPED(FEATURE_DISABLED)`로 적재되고(본문 없음),
 * 공개 대화 응답·바이트는 영향받지 않는다(FR-0-172).
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
        res.on('data', (c) => (data += c));
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

describe('업무 자동화 워크플로우(No.41) — WORKFLOW_ENABLED=false 무회귀', () => {
  let app: NestExpressApplication;
  let baseUrl: string;
  let tmpDir: string;
  let prisma: PrismaService;
  let adminCookie = '';

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'chatbot-workflow-disabled-test-'));
    const dbPath = join(tmpDir, 'test.db').replace(/\\/g, '/');
    const testDatabaseUrl = `file:${dbPath}`;

    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.DEPLOY_SCHEDULE_ENABLED = 'false';
    process.env.WIDGET_BASE_URL = process.env.WIDGET_BASE_URL ?? 'http://localhost:5174';
    process.env.PUBLIC_API_BASE_URL = process.env.PUBLIC_API_BASE_URL ?? 'http://localhost:3000/api/v1';
    delete process.env.EMBEDDING_BASE_URL;
    process.env.WORKFLOW_ENABLED = 'false';

    execSync('pnpm exec prisma migrate deploy', { cwd: API_ROOT, env: { ...process.env, DATABASE_URL: testDatabaseUrl }, stdio: 'pipe' });

    const { AppModule } = (await import('../app.module')) as { AppModule: typeof AppModuleType };
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
    return jsonRequest(method, `${baseUrl}${path}`, body, { Cookie: adminCookie });
  }

  it('WORKFLOW 노드가 있어도 방출이 SKIPPED(FEATURE_DISABLED)로 적재되고 공개 응답은 영향받지 않는다', async () => {
    const targetRes = await admin<{ id: string }>('POST', '/workflow-targets', {
      name: `대상-${randomUUID().slice(0, 8)}`,
      baseUrl: 'https://wf-disabled-test.example.invalid/hook',
      signingEnabled: false,
    });
    if (targetRes.status !== 201) throw new Error(`대상 생성 실패: ${JSON.stringify(targetRes.body)}`);
    const targetId = targetRes.body.id;

    const groupRes = await admin<{ id: string }>('POST', '/chatbot-groups', { name: `그룹-${randomUUID().slice(0, 8)}` });
    const slug = `wf-off-bot-${randomUUID().slice(0, 8)}`;
    const botRes = await admin<{ id: string }>('POST', '/chatbots', { groupId: groupRes.body.id, name: '모드OFF테스트봇', slug });
    const chatbotId = botRes.body.id;
    const kwRes = await admin<{ id: string }>('POST', `/chatbots/${chatbotId}/keywords`, { name: '테스트키워드', synonyms: ['테스트키워드'] });
    if (kwRes.status !== 201) throw new Error(`키워드 생성 실패: ${JSON.stringify(kwRes.body)}`);
    const nodeRes = await admin('POST', `/chatbots/${chatbotId}/dialog-nodes`, {
      name: '워크플로우노드',
      keywordIds: [kwRes.body.id],
      outputs: [
        { type: 'TEXT', payload: { text: '안내합니다.' } },
        { type: 'WORKFLOW', payload: { version: 1, targetId, actionKey: 'test.action', fields: [] } },
      ],
    });
    if (nodeRes.status !== 201) throw new Error(`노드 생성 실패: ${JSON.stringify(nodeRes.body)}`);
    await admin('PATCH', `/chatbots/${chatbotId}/status`, { status: 'ACTIVE' });
    await admin('PATCH', `/chatbots/${chatbotId}/channels/WEB`, { enabled: true, config: { allowedOrigins: [], greetingMessage: '안녕하세요' } });

    const msgRes = await jsonRequest('POST', `${baseUrl}/public/chatbots/${slug}/messages`, { sessionId: randomUUID(), message: '테스트키워드' });
    expect(msgRes.status).toBe(200);
    expect((msgRes.body as { outputs: Array<{ payload: { text: string } }> }).outputs[0].payload.text).toBe('안내합니다.');

    const row = await prisma.workflowRun.findFirst({ where: { targetId }, orderBy: { createdAt: 'desc' } });
    expect(row?.status).toBe('SKIPPED');
    expect(row?.statusReason).toBe('FEATURE_DISABLED');
    expect(row?.payload).toBeNull();
  });
});
