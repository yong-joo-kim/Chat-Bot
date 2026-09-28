import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import * as http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VersioningType } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { AllExceptionsFilter } from '../common/all-exceptions.filter';
import { PrismaService } from '../prisma/prisma.service';
import { loginAs, seedTestUsers } from './helpers/auth.helper';

/**
 * 지식베이스 자동 크롤링/동기화(No.43) 콘솔 R2 M5 — `DATA_GOVERNANCE_MODE=ON`일 때 소스 등록의 두
 * `VALIDATION_FAILED` 예외에 구조화된 `details`가 실리는지 확인한다(문구는 그대로 — details만 추가).
 *
 * `DATA_GOVERNANCE_MODE`는 선택 기능이라(CLAUDE.md) 값을 먼저 설정한 뒤 **동적 import**로 앱을
 * 띄운다(정적 import + `ConfigModule.forRoot` 스냅샷 고정 문제 회피).
 */
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

function sourcePayload(overrides: Record<string, unknown>): Record<string, unknown> {
  const suffix = Math.random().toString(36).slice(2, 10);
  return {
    name: `거버넌스검증-${suffix}`,
    seedUrls: [`https://203.0.113.10/${suffix}/`],
    sitemapUrls: [],
    pathPrefixes: [],
    excludePatterns: [],
    noisePatterns: [],
    allowQueryUrls: false,
    maxDepth: 3,
    maxPages: 50,
    fileTypes: [],
    maxFileBytes: 20971520,
    minIntervalMs: 500,
    scope: { company: '예시공사', category: '테스트', subcategory: suffix },
    schedule: { kind: 'MANUAL' },
    auth: { kind: 'NONE' },
    piiMask: true,
    allowRawFileIngest: false,
    rightsConfirmed: true,
    ...overrides,
  };
}

describe('지식베이스 소스 등록(No.43) 콘솔 R2 M5 — 거버넌스 모드 VALIDATION_FAILED details', () => {
  let app: NestExpressApplication;
  let baseUrl: string;
  let tmpDir: string;
  let prisma: PrismaService;
  let adminCookie = '';

  async function admin<T = unknown>(method: string, path: string, body?: unknown): Promise<ApiResponse<T>> {
    return jsonRequest(method, `${baseUrl}${path}`, body, { Cookie: adminCookie });
  }

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'chatbot-kb-governance-validation-test-'));
    const dbPath = join(tmpDir, 'test.db').replace(/\\/g, '/');
    const testDatabaseUrl = `file:${dbPath}`;

    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.DEPLOY_SCHEDULE_ENABLED = 'false';
    process.env.WIDGET_BASE_URL = process.env.WIDGET_BASE_URL ?? 'http://localhost:5174';
    process.env.PUBLIC_API_BASE_URL = process.env.PUBLIC_API_BASE_URL ?? 'http://localhost:3000/api/v1';
    // 같은 jest worker 안에서 다른 시험 파일이 남긴 EMBEDDING_BASE_URL/RAG_BASE_URL이 있으면 거버넌스
    // 부팅 시 출구 허용 목록 점검에 걸린다 — 명시적으로 빈 문자열로 고정한다(삭제가 아니라 설정).
    process.env.EMBEDDING_BASE_URL = '';
    process.env.RAG_BASE_URL = '';
    process.env.KB_SYNC_ENABLED = 'true';
    // [M5] 거버넌스 모드 ON — 암호화는 켜지 않는다(이 시험은 소스 등록 검증만 본다).
    process.env.DATA_GOVERNANCE_MODE = 'ON';
    process.env.DATA_ENCRYPTION_ENABLED = 'false';
    // 회귀 방지 시험(정상 조합 통과)이 쓰는 시드 호스트를 허용 목록에 넣는다 — 거버넌스 모드에서는
    // 출구 허용 목록도 함께 검사되므로, 이 값이 비어 있으면 그 시험이 호스트 차단으로 400을 받는다.
    process.env.DATA_EGRESS_ALLOWED_HOSTS = '203.0.113.10';
    process.env.KB_ALLOW_RAW_FILE_INGEST = 'false';

    try {
      execSync('pnpm exec prisma migrate deploy', { cwd: API_ROOT, env: { ...process.env, DATABASE_URL: testDatabaseUrl }, stdio: 'pipe' });
    } catch (e) {
      const err = e as { stdout?: Buffer; stderr?: Buffer };
      throw new Error(`prisma migrate deploy 실패:\n${err.stdout?.toString()}\n${err.stderr?.toString()}`);
    }

    // 선택 기능(DATA_GOVERNANCE_MODE)이라 정적 import가 아니라 동적 import로 띄운다 — CLAUDE.md 규약.
    const { AppModule } = await import('../app.module');
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

  it('★ 거버넌스 모드에서 piiMask를 끄면 VALIDATION_FAILED에 구조화된 details가 실린다(문구는 그대로)', async () => {
    const res = await admin<{ code: string; message: string; details: Array<{ field: string; message: string }> }>('POST', '/kb-sources', sourcePayload({ piiMask: false }));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(res.body.message).toBe('거버넌스 모드에서는 개인정보 마스킹을 끌 수 없습니다.'); // 문구는 그대로.
    expect(res.body.details).toEqual([{ field: 'piiMask', message: 'GOVERNANCE_MASK_REQUIRED' }]);
  });

  it('★ 거버넌스 모드에서 원본 파일 전달을 켜면(서버 설정 미허용) VALIDATION_FAILED에 구조화된 details가 실린다(문구는 그대로)', async () => {
    const res = await admin<{ code: string; message: string; details: Array<{ field: string; message: string }> }>(
      'POST',
      '/kb-sources',
      sourcePayload({ piiMask: true, allowRawFileIngest: true }),
    );
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(res.body.message).toBe('거버넌스 모드에서 원본 파일 전달을 켜려면 서버 설정(KB_ALLOW_RAW_FILE_INGEST)이 필요합니다.'); // 문구는 그대로.
    expect(res.body.details).toEqual([{ field: 'allowRawFileIngest', message: 'GOVERNANCE_RAW_FILE_NOT_ALLOWED' }]);
  });

  it('정상 조합(piiMask 켜짐 · allowRawFileIngest 꺼짐)은 그대로 통과한다(회귀 방지)', async () => {
    const res = await admin<{ id: string }>('POST', '/kb-sources', sourcePayload({ piiMask: true, allowRawFileIngest: false }));
    expect(res.status).toBe(201);
  });

  // pass 4 위반 3 — 예전에는 수정(PATCH) 경로가 이 검사를 건너뛰어, 등록에서 막힌 값을 수정으로 우회할 수 있었다.
  describe('수정(PATCH)도 등록과 같은 거버넌스 검사를 받는다', () => {
    async function createSource(): Promise<string> {
      const created = await admin<{ id: string }>('POST', '/kb-sources', sourcePayload({}));
      expect(created.status).toBe(201);
      return created.body.id;
    }

    it('★ PATCH { piiMask: false } → 400 VALIDATION_FAILED + details(GOVERNANCE_MASK_REQUIRED) · 저장값 불변', async () => {
      const id = await createSource();
      const res = await admin<{ code: string; details: Array<{ field: string; message: string }> }>('PATCH', `/kb-sources/${id}`, { piiMask: false });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
      expect(res.body.details).toEqual([{ field: 'piiMask', message: 'GOVERNANCE_MASK_REQUIRED' }]);
      const row = await prisma.kbSource.findUnique({ where: { id } });
      expect(row?.piiMask).toBe(true);
      expect(row?.configVersion).toBe(1);
    });

    it('★ PATCH { allowRawFileIngest: true }(서버 설정 미허용) → 400 + details(GOVERNANCE_RAW_FILE_NOT_ALLOWED) · 저장값 불변', async () => {
      const id = await createSource();
      const res = await admin<{ code: string; details: Array<{ field: string; message: string }> }>('PATCH', `/kb-sources/${id}`, { allowRawFileIngest: true });
      expect(res.status).toBe(400);
      expect(res.body.details).toEqual([{ field: 'allowRawFileIngest', message: 'GOVERNANCE_RAW_FILE_NOT_ALLOWED' }]);
      expect((await prisma.kbSource.findUnique({ where: { id } }))?.allowRawFileIngest).toBe(false);
    });

    it('개인정보 옵션을 건드리지 않는 수정(이름·일시중지)은 거버넌스 모드에서도 통과한다', async () => {
      const id = await createSource();
      const res = await admin<{ name: string; enabled: boolean }>('PATCH', `/kb-sources/${id}`, { name: `개명-${Date.now()}`, enabled: false });
      expect(res.status).toBe(200);
      expect(res.body.enabled).toBe(false);
    });

    it('piiMask를 켠 채로 다시 보내는 것(true)은 통과한다', async () => {
      const id = await createSource();
      const res = await admin('PATCH', `/kb-sources/${id}`, { piiMask: true });
      expect(res.status).toBe(200);
    });
  });
});
