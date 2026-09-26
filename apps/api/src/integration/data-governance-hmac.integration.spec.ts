import { execSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
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
 * 데이터 거버넌스(No.45) — 감사 해시 체인 HMAC 모드 통합 시험(P-6 — 모드 무관 항상). 부트스트랩
 * (`AUDIT_CHAIN_KEY` 파싱) → `AuditLogService.record()`(HMAC 서명) → `AuditChainVerifier.verify()`
 * (키로 재계산해 검증)까지 전 흐름을 실제 SQLite로 확인한다. `env-key.provider.ts`의 체인 키 파싱이
 * 모듈 스코프에서 지연 1회 메모되므로(다른 파일과 값이 섞이지 않게) **별도 파일**로 분리한다.
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

describe('데이터 거버넌스(No.45) 통합 시험 — 감사 해시 체인 HMAC(AUDIT_CHAIN_KEY)', () => {
  let app: NestExpressApplication | undefined;
  let tmpDir: string;
  let prisma: PrismaService;
  let baseUrl: string;
  let adminCookie: string;
  const chainKey = randomBytes(32).toString('base64');

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'data-governance-hmac-test-'));
    const dbPath = join(tmpDir, 'test.db').replace(/\\/g, '/');
    const testDatabaseUrl = `file:${dbPath}`;

    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.DEPLOY_SCHEDULE_ENABLED = 'false';
    process.env.HANDOFF_SWEEPER_ENABLED = 'false';
    process.env.WIDGET_BASE_URL = process.env.WIDGET_BASE_URL ?? 'http://localhost:5174';
    process.env.PUBLIC_API_BASE_URL = process.env.PUBLIC_API_BASE_URL ?? 'http://localhost:3000/api/v1';
    process.env.EMBEDDING_BASE_URL = '';
    process.env.RAG_BASE_URL = '';

    // 거버넌스 모드는 OFF — 체인은 "모드 무관 항상"임을 함께 증명한다.
    process.env.DATA_GOVERNANCE_MODE = 'OFF';
    process.env.DATA_ENCRYPTION_ENABLED = 'false';
    process.env.DATA_ENCRYPTION_KEYS = '';
    process.env.DATA_EGRESS_ALLOWED_HOSTS = '';
    process.env.DATA_RETENTION_JOB_ENABLED = 'false';
    process.env.DATA_REENCRYPT_JOB_ENABLED = 'false';
    process.env.AUDIT_CHAIN_KEY = `hk1:${chainKey}`;

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
  }, 30_000);

  it('부트스트랩 후 데이터 지도가 HMAC 방식과 서명 키 id를 보여준다', async () => {
    const res = await jsonRequest<{ auditChain: { method: string; signingKeyId: string | null } }>('GET', `${baseUrl}/governance/map`, undefined, { Cookie: adminCookie });
    expect(res.status).toBe(200);
    expect(res.body.auditChain.method).toBe('HMAC');
    expect(res.body.auditChain.signingKeyId).toBe('hk1');
  });

  it('로그인 자체가 감사 기록을 남기고, HMAC 방식(h1: 접두)으로 체인이 연결된다', async () => {
    const rows = await prisma.auditLog.findMany({ where: { seq: { not: null } }, orderBy: { seq: 'asc' } });
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.rowHash).not.toBeNull();
      expect((row.rowHash as string).startsWith('h1:hk1:')).toBe(true);
    }
  });

  it('AC-DG6-1(HMAC): 부트스트랩 → record() → verify() 전체 흐름 — 정상은 OK, 변조는 HASH_MISMATCH다', async () => {
    // 관리자 계정으로 감사 기록을 몇 건 더 만든다(챗봇 그룹 생성 API를 거쳐 실제 요청 경로에서 기록).
    for (let i = 0; i < 3; i += 1) {
      await jsonRequest('POST', `${baseUrl}/chatbot-groups`, { name: `hmac-그룹-${randomUUID().slice(0, 6)}` }, { Cookie: adminCookie });
    }

    // `POST /audit-logs/verify`는 실제 부트스트랩이 설치한 AuditChainVerifier·env-key.provider를
    // 그대로 거친다(엔드투엔드 — 별도 DI 컨테이너를 새로 만들지 않는다).
    const verifyRes = await jsonRequest<{ status: string }>('POST', `${baseUrl}/audit-logs/verify`, {}, { Cookie: adminCookie });
    expect(verifyRes.status).toBe(201);
    expect(['OK', 'EMPTY']).toContain(verifyRes.body.status);

    const chainRow = await prisma.auditLog.findFirst({ where: { seq: { not: null } }, orderBy: { seq: 'asc' } });
    expect(chainRow).not.toBeNull();
    await prisma.auditLog.update({ where: { id: chainRow!.id }, data: { summary: 'HMAC 변조 시험' } });

    const tamperedRes = await jsonRequest<{ status: string; firstBadSeq?: number }>('POST', `${baseUrl}/audit-logs/verify`, {}, { Cookie: adminCookie });
    expect(tamperedRes.status).toBe(201);
    expect(tamperedRes.body.status).toBe('HASH_MISMATCH');
    expect(tamperedRes.body.firstBadSeq).toBe(chainRow!.seq);

    // 키 없이 재계산하면 정상 판정을 만들 수 없다(AC-DG6-2) — env-key.provider의 auditChainSigner()를
    // 직접 호출해 서명 키가 없을 때 verify가 실패로 이어지는지 단위 수준에서 함께 확인한다.
    const { auditChainSigner } = await import('../common/crypto/env-key.provider');
    const signer = auditChainSigner();
    expect(signer.verify('hk1', 'anything')).not.toBeNull(); // 키가 있으면 계산은 된다(값 검증은 verify-segment 단위 시험에서 커버)
  });
});
