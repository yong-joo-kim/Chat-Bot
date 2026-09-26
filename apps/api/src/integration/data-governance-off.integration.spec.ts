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
import { loginAs, seedTestUsers } from './helpers/auth.helper';

/**
 * 데이터 거버넌스(No.45) — 모드 OFF 회귀(AC-DG1-1/AC-DG1-2). `data-governance.integration.spec.ts`
 * (모드 ON)와 **별도 파일**로 둔다 — `common/governance/governance-runtime.ts`의 설치 상태는
 * 프로세스(=Jest 파일의 모듈 레지스트리) 전역이라, 같은 파일 안에서 ON과 OFF 앱을 순서대로 띄우면
 * 두 번째 설치가 조용히 무시되어(§2.3 ④) 실제로 OFF를 검증하지 못한다. 파일 단위로 격리된 모듈
 * 레지스트리를 쓰는 것이 안전하다(`legacy-api-integration-disabled.integration.spec.ts` 선례).
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

describe('데이터 거버넌스(No.45) 통합 시험 — 모드 OFF 회귀', () => {
  let app: NestExpressApplication | undefined;
  let tmpDir: string;
  let prisma: PrismaService;
  let baseUrl: string;
  let adminCookie: string;
  let moduleRef: import('@nestjs/testing').TestingModule;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'data-governance-off-test-'));
    const dbPath = join(tmpDir, 'test.db').replace(/\\/g, '/');
    const testDatabaseUrl = `file:${dbPath}`;

    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.DEPLOY_SCHEDULE_ENABLED = 'false';
    process.env.HANDOFF_SWEEPER_ENABLED = 'false';
    process.env.WIDGET_BASE_URL = process.env.WIDGET_BASE_URL ?? 'http://localhost:5174';
    process.env.PUBLIC_API_BASE_URL = process.env.PUBLIC_API_BASE_URL ?? 'http://localhost:3000/api/v1';
    process.env.EMBEDDING_BASE_URL = '';
    process.env.RAG_BASE_URL = '';

    process.env.DATA_GOVERNANCE_MODE = 'OFF';
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

    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
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
  }, 30_000);

  it('AC-DG1-1/AC-DG1-2: 모드 OFF에서도 기동에 성공하고, 데이터 지도는 "꺼짐"을 보여준다', async () => {
    const res = await jsonRequest<{ mode: string; encryption: { enabled: boolean } }>('GET', `${baseUrl}/governance/map`, undefined, { Cookie: adminCookie });
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe('OFF');
    expect(res.body.encryption.enabled).toBe(false);
  });

  it('AC-DG1-1: 모드 OFF에서 상담 메시지는 평문 그대로 저장된다(암호화 미설치 — 봉투 접두 없음)', async () => {
    const { HandoffThreadService } = await import('../handoff/handoff-thread.service');
    const thread = moduleRef.get(HandoffThreadService);
    const group = await prisma.chatbotGroup.create({ data: { name: `그룹-off-${randomUUID().slice(0, 8)}` } });
    const chatbot = await prisma.chatbot.create({ data: { groupId: group.id, name: '평문 챗봇', slug: `off-${randomUUID().slice(0, 8)}` } });
    const now = new Date();
    const created = await thread.createHandoff({
      chatbotId: chatbot.id,
      groupId: 'group-1',
      sessionId: `sess-${randomUUID()}`,
      sessionRef: randomUUID(),
      channelType: 'WEB',
      assignedUserId: 'agent-1',
      assignedUserName: '상담원',
      startedById: 'agent-1',
      startedByName: '상담원',
      alertLevelAtStart: 'NORMAL',
      consecutiveUnansweredAtStart: 0,
      connectNotice: '상담원이 연결되었어요.',
      now,
      dayBucket: '2026-01-01',
    });
    const row = await prisma.handoffMessage.findFirst({ where: { handoffSessionId: created.id, seq: 1 } });
    expect(row).not.toBeNull();
    expect(row!.text.startsWith('enc:v1:')).toBe(false);
    expect(row!.text).toBe('상담원이 연결되었어요.');
  });

  it('AC-DG8-1: EDITOR 계정은 여전히 정상 로그인·기존 권한대로 동작한다(거버넌스 도입이 기존 인증에 영향 없음)', async () => {
    const editorCookie = await loginAs(baseUrl, 'EDITOR');
    const res = await jsonRequest('GET', `${baseUrl}/governance/map`, undefined, { Cookie: editorCookie });
    expect(res.status).toBe(403);
  });
});
