import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import * as http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VersioningType } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { AppModule as AppModuleType } from '../app.module';
import { Test } from '@nestjs/testing';
import { AllExceptionsFilter } from '../common/all-exceptions.filter';
import type { PrismaService as PrismaServiceType } from '../prisma/prisma.service';
import { loginAs, seedTestUsers } from './helpers/auth.helper';
import { LEGACY_DNS_RESOLVER, LEGACY_TRANSPORT } from '../legacy-api/transport/legacy-transport.port';
import type { LegacyDnsResolver, LegacyTransport, LegacyTransportRequest, LegacyTransportResult } from '../legacy-api/transport/legacy-transport.port';

/**
 * [No.26] LEGACY_API_ENABLED=false(AC-L4-8) — 별도 파일.
 * `@nestjs/config`의 `ConfigModule.forRoot()`는 **호출되는 즉시(동기)** `process.env`를 스냅샷해
 * 검증한다(`config.module.js`의 `forRoot()` 본문). `app.module.ts`가 정적으로 import되면 그 스냅샷이
 * 테스트 파일 로드 시점에 고정되어 버려 `beforeAll`에서 설정한 `LEGACY_API_*` 값이 반영되지 않는다
 * (직접 확인 — 제품 결함이 아니라 "부팅 후 env 불변"이 정상 동작이다). 그래서 `AppModule`을 정적
 * import하지 않고 `beforeAll` 안에서 환경변수를 먼저 설정한 뒤 **동적 import**로 읽는다. 이 값을
 * `legacy-api-integration.integration.spec.ts`(LEGACY_API_ENABLED=true)와 **다르게** 설정해야 하므로
 * 같은 파일에 두 번째 앱으로 두지 않고 **별도 파일**로 분리했다 — 동일 파일 안에서 두 번째 동적
 * import 전에 `jest.resetModules()`를 호출하면 `@nestjs/core`의 데코레이터 메타데이터(Reflector 등)
 * 까지 리셋되어 `Nest can't resolve dependencies of the PermissionGuard(?, ...)` 식으로 깨진다(직접
 * 확인) — 파일 단위로 격리된 모듈 레지스트리를 쓰는 것이 안전하다.
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
        headers: {
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
          ...headers,
        },
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

interface RecordedLegacyRequest {
  method: string;
  pathname: string;
}

function startMockLegacyServer(legacyRequests: RecordedLegacyRequest[]): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      legacyRequests.push({ method: req.method ?? 'GET', pathname: req.url ?? '/' });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
    });
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      resolve({ url: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(() => r())) });
    });
  });
}

function makeFakeDnsResolver(): LegacyDnsResolver {
  return { async lookupAll(): Promise<string[]> { return ['203.0.113.10']; } };
}

function makeFakeTransport(getMockBaseUrl: () => string, counter: { calls: number }): LegacyTransport {
  return {
    request(req: LegacyTransportRequest): Promise<LegacyTransportResult> {
      counter.calls += 1;
      return new Promise((resolve) => {
        const target = new URL(req.url);
        const local = new URL(getMockBaseUrl());
        const httpReq = http.request(
          { method: req.method, hostname: local.hostname, port: local.port, path: target.pathname + target.search, headers: req.headers },
          (res) => {
            const chunks: Buffer[] = [];
            res.on('data', (c: Buffer) => chunks.push(c));
            res.on('end', () => resolve({ kind: 'RESPONSE', status: res.statusCode ?? 200, contentType: res.headers['content-type'], bytes: Buffer.concat(chunks).length, body: Buffer.concat(chunks) }));
          },
        );
        httpReq.on('error', () => resolve({ kind: 'ERROR', outcome: 'NETWORK_ERROR' }));
        httpReq.end();
      });
    },
  };
}

describe('레거시 API 연동(No.26) — LEGACY_API_ENABLED=false(AC-L4-8)', () => {
  it('기능이 꺼져 있으면 연결 테스트가 FEATURE_DISABLED이고 아웃바운드가 0건이다', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'chatbot-legacy-api-disabled-test-'));
    const dbPath = join(tmpDir, 'test.db').replace(/\\/g, '/');
    const testDatabaseUrl = `file:${dbPath}`;
    const legacyRequests: RecordedLegacyRequest[] = [];
    const mockLegacy = await startMockLegacyServer(legacyRequests);
    const transportCounter = { calls: 0 };

    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.DEPLOY_SCHEDULE_ENABLED = 'false';
    process.env.WIDGET_BASE_URL = process.env.WIDGET_BASE_URL ?? 'http://localhost:5174';
    process.env.PUBLIC_API_BASE_URL = process.env.PUBLIC_API_BASE_URL ?? 'http://localhost:3000/api/v1';
    delete process.env.EMBEDDING_BASE_URL;
    process.env.LEGACY_API_ENABLED = 'false';
    process.env.LEGACY_API_PRIVATE_ALLOWLIST = '';

    let app: NestExpressApplication | undefined;
    try {
      execSync('pnpm exec prisma db push --skip-generate --accept-data-loss', {
        cwd: API_ROOT,
        env: { ...process.env, DATABASE_URL: testDatabaseUrl },
        stdio: 'pipe',
      });

      const { AppModule } = (await import('../app.module')) as { AppModule: typeof AppModuleType };
      const { PrismaService } = (await import('../prisma/prisma.service')) as { PrismaService: typeof PrismaServiceType };
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(LEGACY_DNS_RESOLVER)
        .useValue(makeFakeDnsResolver())
        .overrideProvider(LEGACY_TRANSPORT)
        .useValue(makeFakeTransport(() => mockLegacy.url, transportCounter))
        .compile();

      app = moduleRef.createNestApplication<NestExpressApplication>();
      app.enableCors();
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

      const connRes = await jsonRequest<{ id: string }>(
        'POST',
        `${baseUrl}/api-connections`,
        { name: '비활성화연결', baseUrl: 'https://legacy.example.invalid', allowedMethods: ['GET'] },
        { Cookie: adminCookie },
      );
      expect(connRes.status).toBe(201);

      const testRes = await jsonRequest<{ outcome: string }>(
        'POST',
        `${baseUrl}/api-connections/${connRes.body.id}/test`,
        { path: '/' },
        { Cookie: adminCookie },
      );
      expect(testRes.status).toBe(200);
      expect(testRes.body.outcome).toBe('FEATURE_DISABLED');
      expect(transportCounter.calls).toBe(0);
      expect(legacyRequests.length).toBe(0);
    } finally {
      await app?.close();
      await mockLegacy.close();
      await safeCleanupTmpDir(tmpDir);
    }
  }, 30_000);
});
