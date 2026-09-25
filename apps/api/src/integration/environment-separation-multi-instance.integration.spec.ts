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

const API_ROOT = join(__dirname, '..', '..');

async function safeCleanupTmpDir(dir: string): Promise<void> {
  await new Promise((r) => setTimeout(r, 300));
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {
    // 정리 실패는 테스트 판정에 영향 없음.
  }
}

interface ApiResponse<T = unknown> {
  status: number;
  headers: http.IncomingHttpHeaders;
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
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: parsed as T });
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/**
 * [신규 No.40 — test-automation 보강, 2026-09-25] 환경 분리 / 버전 관리(No.40) 다중 인스턴스 통합
 * 시험 — AC-EN2-5("전환 커밋, When 두 인스턴스에 연속 요청, Then 두 번째 요청부터 두 인스턴스 모두
 * 새 버전으로 응답한다") · NFR-ENP2("전환은 다음 공개 요청부터 모든 인스턴스에 반영·TTL 대기 없음").
 * 기존 `environment-separation.integration.spec.ts`는 앱 인스턴스 1개만 썼다 — 포인터를 캐시하지
 * 않는다는 설계(FR-EN2-2)는 여러 프로세스가 있어야 실제로 검증된다. 하네스는 `scheduled-deploy-
 * multi-instance.integration.spec.ts`(같은 SQLite 파일을 보는 완전히 별도의 Nest DI 컨테이너 2개)를
 * 그대로 재사용한다 — 차이는 두 인스턴스 모두 HTTP 포트를 열어 "공개 대화"를 실제로 받는다는 점이다
 * (예약 엔진 `tick()`이 아니라 공개 대화 경로 자체가 대상이므로).
 */
describe('환경 분리 / 버전 관리(No.40) 다중 인스턴스 통합 테스트 — AC-EN2-5 · NFR-ENP2', () => {
  let app1: NestExpressApplication;
  let app2: NestExpressApplication;
  let baseUrl1: string;
  let baseUrl2: string;
  let tmpDir: string;
  let prisma1: PrismaService;
  let adminCookie = '';

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'environment-separation-multi-'));
    const dbPath = join(tmpDir, 'test.db').replace(/\\/g, '/');
    const testDatabaseUrl = `file:${dbPath}`;

    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.DEPLOY_SCHEDULE_ENABLED = 'false';
    process.env.WIDGET_BASE_URL = process.env.WIDGET_BASE_URL ?? 'http://localhost:5174';
    process.env.PUBLIC_API_BASE_URL = process.env.PUBLIC_API_BASE_URL ?? 'http://localhost:3000/api/v1';
    delete process.env.EMBEDDING_BASE_URL;

    try {
      execSync('pnpm exec prisma migrate deploy', { cwd: API_ROOT, env: { ...process.env, DATABASE_URL: testDatabaseUrl }, stdio: 'pipe' });
    } catch (e) {
      const err = e as { stdout?: Buffer; stderr?: Buffer };
      throw new Error(`prisma migrate deploy 실패:\n${err.stdout?.toString()}\n${err.stderr?.toString()}`);
    }

    const { AppModule } = await import('../app.module');

    // 인스턴스 1 — 관리자 HTTP(챗봇·버전·전환)와 공개 대화 둘 다 받는다.
    const moduleRef1 = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app1 = moduleRef1.createNestApplication<NestExpressApplication>();
    app1.enableCors();
    app1.setGlobalPrefix('api');
    app1.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app1.useGlobalFilters(new AllExceptionsFilter());
    prisma1 = moduleRef1.get(PrismaService);
    await app1.listen(0);
    const server1 = app1.getHttpServer() as http.Server;
    const address1 = server1.address();
    const port1 = typeof address1 === 'object' && address1 !== null ? address1.port : 0;
    baseUrl1 = `http://127.0.0.1:${port1}/api/v1`;

    await seedTestUsers(prisma1);
    adminCookie = await loginAs(baseUrl1, 'ADMIN');

    // 인스턴스 2 — 같은 DATABASE_URL을 보는 완전히 별도의 DI 컨테이너("다른 프로세스" 시뮬레이션).
    // 공개 대화만 받는다 — 포인터·번들 캐시가 인스턴스 로컬임을 보이는 것이 목적이다.
    const moduleRef2 = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app2 = moduleRef2.createNestApplication<NestExpressApplication>();
    app2.enableCors();
    app2.setGlobalPrefix('api');
    app2.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app2.useGlobalFilters(new AllExceptionsFilter());
    await app2.listen(0);
    const server2 = app2.getHttpServer() as http.Server;
    const address2 = server2.address();
    const port2 = typeof address2 === 'object' && address2 !== null ? address2.port : 0;
    baseUrl2 = `http://127.0.0.1:${port2}/api/v1`;
  }, 90_000);

  afterAll(async () => {
    await app1?.close();
    await app2?.close().catch(() => undefined);
    await safeCleanupTmpDir(tmpDir);
  }, 20_000);

  function admin<T = unknown>(method: string, path: string, body?: unknown): Promise<ApiResponse<T>> {
    return jsonRequest<T>(method, `${baseUrl1}${path}`, body, { Cookie: adminCookie });
  }
  function pub1<T = unknown>(method: string, path: string, body?: unknown): Promise<ApiResponse<T>> {
    return jsonRequest<T>(method, `${baseUrl1}${path}`, body);
  }
  function pub2<T = unknown>(method: string, path: string, body?: unknown): Promise<ApiResponse<T>> {
    return jsonRequest<T>(method, `${baseUrl2}${path}`, body);
  }

  function outputText(res: ApiResponse<{ outputs: Array<{ payload?: { text?: string } }> }>): string | undefined {
    return res.body.outputs?.[0]?.payload?.text;
  }

  let sessionCounter = 0;
  function sessionUuid(): string {
    sessionCounter += 1;
    const hex = sessionCounter.toString(16).padStart(12, '0');
    return `30000000-0000-4000-8000-${hex}`;
  }

  async function pollConversationLog(chatbotId: string, sessionId: string, timeoutMs = 3000): Promise<{ servedVersionId: string | null } | null> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const log = await prisma1.conversationLog.findFirst({ where: { chatbotId, sessionId }, orderBy: { createdAt: 'desc' } });
      if (log) return log;
      if (Date.now() > deadline) return null;
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  it('AC-EN2-5 — 운영 전환 커밋 직후, 두 인스턴스 모두 다음 요청부터 새 버전으로 응답한다(TTL 대기 없음, NFR-ENP2)', async () => {
    const groupRes = await admin<{ id: string }>('POST', '/chatbot-groups', { name: '다중인스턴스 환경분리 그룹' });
    const suffix = Math.random().toString(36).slice(2, 10);
    const slug = `envmi-${suffix}`;
    const chatbotRes = await admin<{ id: string }>('POST', '/chatbots', { groupId: groupRes.body.id, name: `다중인스턴스환경분리-${suffix}`, slug });
    const chatbotId = chatbotRes.body.id;

    await admin('PATCH', `/chatbots/${chatbotId}/status`, { status: 'ACTIVE' });
    await admin('PATCH', `/chatbots/${chatbotId}/channels/WEB`, { enabled: true, config: { allowedOrigins: [] } });

    const kwRes = await admin<{ id: string }>('POST', `/chatbots/${chatbotId}/keywords`, { name: `다중인스턴스-${suffix}`, synonyms: [] });
    const nodeRes = await admin<{ id: string }>('POST', `/chatbots/${chatbotId}/dialog-nodes`, {
      name: '노드-응답-v1',
      nodeType: 'NORMAL',
      keywordIds: [kwRes.body.id],
      outputs: [{ type: 'TEXT', payload: { text: '응답-v1' } }],
    });
    const nodeId = nodeRes.body.id;

    const preview = await admin<{ draftContentHash: string }>('POST', `/chatbots/${chatbotId}/environment/enable/preview`);
    const enableRes = await admin<{ prod: { versionId: string } }>('POST', `/chatbots/${chatbotId}/environment/enable`, { expectedDraftHash: preview.body.draftContentHash });
    expect(enableRes.status).toBe(201);

    const message = `다중인스턴스-${suffix} 문의`;

    // 전환 전 — 두 인스턴스 모두 v1로 답한다(기준선).
    const before1 = await pub1<{ outputs: Array<{ payload?: { text?: string } }> }>('POST', `/public/chatbots/${slug}/messages`, { sessionId: sessionUuid(), message });
    const before2 = await pub2<{ outputs: Array<{ payload?: { text?: string } }> }>('POST', `/public/chatbots/${slug}/messages`, { sessionId: sessionUuid(), message });
    expect(outputText(before1)).toBe('응답-v1');
    expect(outputText(before2)).toBe('응답-v1');

    // 초안을 고치고(v2) 승격 → 운영 전환 — 전부 인스턴스 1(관리자 경로)에서 한다.
    await admin('PATCH', `/chatbots/${chatbotId}/dialog-nodes/${nodeId}`, { outputs: [{ type: 'TEXT', payload: { text: '응답-v2' } }] });
    const statusRes = await admin<{ staging: { versionId: string } }>('GET', `/chatbots/${chatbotId}/environment`);
    const promoteRes = await admin<{ staging: { versionId: string } }>('POST', `/chatbots/${chatbotId}/environment/staging/promote`, {
      expectedStagingVersionId: statusRes.body.staging.versionId,
    });
    const v2Id = promoteRes.body.staging.versionId;
    const switchPreview = await admin<{ expectedProdVersionId: string }>('POST', `/chatbots/${chatbotId}/environment/prod/preview`, { kind: 'SWITCH', targetVersionId: v2Id });
    const switchRes = await admin<{ outcome: string }>('POST', `/chatbots/${chatbotId}/environment/prod/switch`, {
      targetVersionId: v2Id,
      expectedProdVersionId: switchPreview.body.expectedProdVersionId,
      acknowledgeWarnings: true,
    });
    expect(switchRes.status).toBe(201);
    expect(switchRes.body.outcome).toBe('APPLIED');

    // 전환 커밋 직후, 지연·TTL 대기 없이 곧바로 — 두 인스턴스 모두(전환을 수행한 인스턴스 1도, 전혀
    // 관여하지 않은 인스턴스 2도) 다음 공개 요청부터 새 버전으로 응답해야 한다.
    const session1 = sessionUuid();
    const session2 = sessionUuid();
    const after1 = await pub1<{ outputs: Array<{ payload?: { text?: string } }> }>('POST', `/public/chatbots/${slug}/messages`, { sessionId: session1, message });
    const after2 = await pub2<{ outputs: Array<{ payload?: { text?: string } }> }>('POST', `/public/chatbots/${slug}/messages`, { sessionId: session2, message });
    expect(outputText(after1)).toBe('응답-v2');
    expect(outputText(after2)).toBe('응답-v2'); // 인스턴스 2는 전환을 몰랐지만(로컬 캐시 없음) 즉시 반영된다.

    const log1 = await pollConversationLog(chatbotId, session1);
    const log2 = await pollConversationLog(chatbotId, session2);
    expect(log1?.servedVersionId).toBe(v2Id);
    expect(log2?.servedVersionId).toBe(v2Id);
  }, 30_000);
});
