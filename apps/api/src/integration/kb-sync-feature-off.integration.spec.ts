import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import * as http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VersioningType } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { AppModule as AppModuleType } from '../app.module';
import { AllExceptionsFilter } from '../common/all-exceptions.filter';
import { PrismaService } from '../prisma/prisma.service';
import { loginAs, seedTestUsers } from './helpers/auth.helper';

const API_ROOT = join(__dirname, '..', '..');

async function safeCleanupTmpDir(dir: string): Promise<void> {
  await new Promise((r) => setTimeout(r, 300));
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {
    // Windows 파일 핸들 지연 해제 — 판정에 영향 없음.
  }
}

interface ApiResponse<T = unknown> {
  status: number;
  body: T;
}

function jsonRequest<T = unknown>(method: string, url: string, headers: Record<string, string> = {}): Promise<ApiResponse<T>> {
  return new Promise((resolve, reject) => {
    const { hostname, port, pathname, search } = new URL(url);
    const req = http.request({ method, hostname, port, path: pathname + search, headers }, (res) => {
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
    });
    req.on('error', reject);
    req.end();
  });
}

/**
 * 지식베이스 자동 크롤링/동기화(No.43) — 기능 꺼짐(`KB_SYNC_ENABLED=false`, 기본값) 무회귀 시험
 * (AC-KB1-1 · FR-0-203 · KB-21). 별도 파일로 분리한 이유: 메인 통합 시험은 `KB_SYNC_ENABLED=true`로
 * 부트스트랩하므로(ConfigModule 스냅샷이 import 시점에 고정 — CLAUDE.md), 같은 프로세스에서 두 값을
 * 함께 시험할 수 없다.
 */
describe('지식베이스 동기화 — 기능 꺼짐(기본값) 무회귀 시험', () => {
  let app: NestExpressApplication;
  let baseUrl: string;
  let tmpDir: string;
  let prisma: PrismaService;
  let adminCookie = '';

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'chatbot-kb-sync-off-test-'));
    const dbPath = join(tmpDir, 'test.db').replace(/\\/g, '/');
    const testDatabaseUrl = `file:${dbPath}`;

    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.DEPLOY_SCHEDULE_ENABLED = 'false';
    process.env.WIDGET_BASE_URL = process.env.WIDGET_BASE_URL ?? 'http://localhost:5174';
    process.env.PUBLIC_API_BASE_URL = process.env.PUBLIC_API_BASE_URL ?? 'http://localhost:3000/api/v1';
    delete process.env.EMBEDDING_BASE_URL;
    // KB_SYNC_ENABLED를 명시적으로 지정하지 않는다 — 기본값(false)이 실제로 적용되는지가 이 시험의
    // 목적이다(jest.isolate-env.js가 고정하는 것과 별개로, 여기서도 재확인한다).
    delete process.env.KB_SYNC_ENABLED;
    delete process.env.KB_INGEST_TRANSPORT_ACK;
    delete process.env.RAG_BASE_URL;

    try {
      execSync('pnpm exec prisma migrate deploy', { cwd: API_ROOT, env: { ...process.env, DATABASE_URL: testDatabaseUrl }, stdio: 'pipe' });
    } catch (e) {
      const err = e as { stdout?: Buffer; stderr?: Buffer };
      throw new Error(`prisma migrate deploy 실패:\n${err.stdout?.toString()}\n${err.stderr?.toString()}`);
    }

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

  function admin<T = unknown>(method: string, path: string): Promise<ApiResponse<T>> {
    return jsonRequest(method, `${baseUrl}${path}`, { Cookie: adminCookie });
  }

  it('AC-KB1-1: KB_SYNC_ENABLED=false(기본값)면 관리 API 13개가 전부 404다(대표 5개 확인)', async () => {
    expect((await admin('GET', '/kb-sources')).status).toBe(404);
    expect((await admin('GET', '/kb-sources/meta')).status).toBe(404);
    expect((await admin('GET', '/kb-sources/00000000-0000-0000-0000-000000000000')).status).toBe(404);
    expect((await admin('GET', '/kb-sources/00000000-0000-0000-0000-000000000000/runs')).status).toBe(404);
    expect((await admin('GET', '/kb-sources/00000000-0000-0000-0000-000000000000/documents')).status).toBe(404);
  });

  it('챗봇 답변 설정의 지식베이스 카드도 404다', async () => {
    const res = await admin('GET', '/chatbots/00000000-0000-0000-0000-000000000000/kb-status');
    expect(res.status).toBe(404);
  });

  it('KB-21: 소스 0개(기능 꺼짐) 설치의 데이터 지도 응답에 kbSources 키가 없다', async () => {
    const res = await admin<{ egress: { kbSources?: unknown } }>('GET', '/governance/map');
    expect(res.status).toBe(200);
    expect(res.body.egress.kbSources).toBeUndefined();
  });

  it('무회귀: 관련 없는 기존 경로(헬스체크)는 정상 동작한다', async () => {
    const res = await jsonRequest('GET', `${baseUrl.replace('/api/v1', '')}/api/health`);
    expect(res.status).toBe(200);
  });
});
