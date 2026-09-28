import { randomUUID } from 'node:crypto';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import * as http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VersioningType } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import { AllExceptionsFilter } from '../common/all-exceptions.filter';
import { PrismaService } from '../prisma/prisma.service';
import { loginAs, seedTestUsers } from './helpers/auth.helper';
import { KB_DNS_RESOLVER } from '../kb-sync/crawl/kb-crawl-http.fetcher';
import type { LegacyDnsResolver } from '../legacy-api/transport/legacy-transport.port';

/**
 * 지식베이스 소스 수정·실행 선점(No.43) pass 4 — 설계 §9.2·§9.8·§9.9 근거:
 *  · 위반 4  `configVersion`은 저장된 값이 **실제로 바뀔 때만** 올린다(같은 값을 다시 보내거나 순서만 바꾼 경우 제외).
 *  · 위반 5  소스 선점(CAS)과 실행 행 생성은 한 트랜잭션이다(실패하면 둘 다 없던 일).
 *  · 그 밖  수정에도 서버 상한(maxPages·maxFileBytes) 적용 · 스코프 변경 시 `SCOPE_CHANGED` · 일시중지 시 진행 중 실행 중지.
 * (PATCH 거버넌스 검사는 `kb-sources-governance-validation.integration.spec.ts`가 본다.)
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

function sourcePayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const suffix = Math.random().toString(36).slice(2, 10);
  return {
    name: `수정의미-${suffix}`,
    seedUrls: [`https://203.0.113.10/${suffix}/`, `https://203.0.113.10/${suffix}/faq/`],
    sitemapUrls: [],
    pathPrefixes: [`/${suffix}/`, '/extra/'],
    excludePatterns: ['/old/*'],
    noisePatterns: ['목차'],
    allowQueryUrls: false,
    maxDepth: 3,
    maxPages: 50,
    fileTypes: ['PDF'],
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

describe('지식베이스 소스 수정·실행 선점(No.43) pass 4', () => {
  let app: NestExpressApplication;
  let baseUrl: string;
  let tmpDir: string;
  let prisma: PrismaService;
  let moduleRef: TestingModule;
  let adminCookie = '';

  async function admin<T = unknown>(method: string, path: string, body?: unknown): Promise<ApiResponse<T>> {
    return jsonRequest(method, `${baseUrl}${path}`, body, { Cookie: adminCookie });
  }

  async function createSource(overrides: Record<string, unknown> = {}): Promise<{ id: string; payload: Record<string, unknown> }> {
    const payload = sourcePayload(overrides);
    const created = await admin<{ id: string }>('POST', '/kb-sources', payload);
    expect(created.status).toBe(201);
    return { id: created.body.id, payload };
  }

  const row = (id: string) => prisma.kbSource.findUnique({ where: { id } });

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'chatbot-kb-update-semantics-test-'));
    const testDatabaseUrl = `file:${join(tmpDir, 'test.db').replace(/\\/g, '/')}`;
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.DEPLOY_SCHEDULE_ENABLED = 'false';
    process.env.WIDGET_BASE_URL = process.env.WIDGET_BASE_URL ?? 'http://localhost:5174';
    process.env.PUBLIC_API_BASE_URL = process.env.PUBLIC_API_BASE_URL ?? 'http://localhost:3000/api/v1';
    process.env.EMBEDDING_BASE_URL = '';
    process.env.RAG_BASE_URL = '';
    process.env.KB_SYNC_ENABLED = 'true';
    process.env.DATA_GOVERNANCE_MODE = 'OFF';
    process.env.DATA_EGRESS_ALLOWED_HOSTS = '';
    process.env.KB_CRAWL_MAX_PAGES_CAP = '1000';
    process.env.KB_CRAWL_MAX_FILE_BYTES = '5242880';

    try {
      execSync('pnpm exec prisma migrate deploy', { cwd: API_ROOT, env: { ...process.env, DATABASE_URL: testDatabaseUrl }, stdio: 'pipe' });
    } catch (e) {
      const err = e as { stdout?: Buffer; stderr?: Buffer };
      throw new Error(`prisma migrate deploy 실패:\n${err.stdout?.toString()}\n${err.stderr?.toString()}`);
    }

    const dns: LegacyDnsResolver = { lookupAll: async () => ['203.0.113.10'] };
    const { AppModule } = await import('../app.module');
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(KB_DNS_RESOLVER).useValue(dns).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    app.enableCors();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalFilters(new AllExceptionsFilter());
    prisma = moduleRef.get(PrismaService);
    await app.listen(0);
    const address = (app.getHttpServer() as http.Server).address();
    baseUrl = `http://127.0.0.1:${typeof address === 'object' && address !== null ? address.port : 0}/api/v1`;

    await seedTestUsers(prisma);
    adminCookie = await loginAs(baseUrl, 'ADMIN');
    const { KbSyncJob } = await import('../kb-sync/engine/kb-sync.job');
    await (moduleRef.get(KbSyncJob) as unknown as { onModuleDestroy(): Promise<void> }).onModuleDestroy();
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await safeCleanupTmpDir(tmpDir);
  }, 15_000);

  describe('★ configVersion — 값이 실제로 바뀔 때만 올린다(위반 4)', () => {
    it('저장 폼 전체를 그대로 다시 보내도(값 동일) configVersion은 1로 그대로다', async () => {
      const { id, payload } = await createSource();
      const { rightsConfirmed: _rc, ...resend } = payload;
      void _rc;
      const res = await admin<{ configVersion: number }>('PATCH', `/kb-sources/${id}`, resend);
      expect(res.status).toBe(200);
      expect(res.body.configVersion).toBe(1);
      expect((await row(id))?.configVersion).toBe(1);
    });

    it('이름·주기·인증·요청 간격·일시중지만 바꾸면 올리지 않는다', async () => {
      const { id } = await createSource();
      const res = await admin<{ configVersion: number }>('PATCH', `/kb-sources/${id}`, {
        name: `개명-${randomUUID().slice(0, 6)}`,
        schedule: { kind: 'DAILY', time: '03:00' },
        auth: { kind: 'STATIC_HEADER', headerName: 'X-Api-Key', secretRef: 'INTRA_KEY' },
        minIntervalMs: 2000,
        enabled: false,
      });
      expect(res.status).toBe(200);
      expect(res.body.configVersion).toBe(1);
    });

    it('목록의 순서만 바꾼 저장은 같은 범위다 — 올리지 않는다', async () => {
      const { id, payload } = await createSource();
      const res = await admin<{ configVersion: number }>('PATCH', `/kb-sources/${id}`, {
        seedUrls: [...(payload.seedUrls as string[])].reverse(),
        pathPrefixes: [...(payload.pathPrefixes as string[])].reverse(),
      });
      expect(res.status).toBe(200);
      expect(res.body.configVersion).toBe(1);
    });

    it('서버 상한을 넘는 값을 다시 보내도 저장값(상한)이 그대로면 변경이 아니다', async () => {
      const { id } = await createSource({ maxPages: 999_999, maxFileBytes: 999_999_999 }); // 등록 때 상한(1000 · 5MB)으로 잘려 저장된다.
      expect((await row(id))?.maxPages).toBe(1000);
      expect((await row(id))?.maxFileBytes).toBe(5242880);
      const res = await admin<{ configVersion: number }>('PATCH', `/kb-sources/${id}`, { maxPages: 999_999, maxFileBytes: 999_999_999 });
      expect(res.status).toBe(200);
      expect(res.body.configVersion).toBe(1);
    });

    it.each([
      ['seedUrls 추가', (p: Record<string, unknown>) => ({ seedUrls: [...(p.seedUrls as string[]), 'https://203.0.113.10/new/'] })],
      ['pathPrefixes 변경', () => ({ pathPrefixes: ['/only/'] })],
      ['excludePatterns 비움', () => ({ excludePatterns: [] })],
      ['noisePatterns 변경', () => ({ noisePatterns: ['다른 줄'] })],
      ['fileTypes 변경', () => ({ fileTypes: ['PDF', 'DOCX'] })],
      ['allowQueryUrls 켬', () => ({ allowQueryUrls: true })],
      ['maxDepth 변경', () => ({ maxDepth: 1 })],
      ['maxPages 변경', () => ({ maxPages: 10 })],
      ['maxFileBytes 변경', () => ({ maxFileBytes: 1_048_576 })],
      ['scope 변경', () => ({ scope: { company: '예시공사', category: '테스트', subcategory: '다른값' } })],
      ['piiMask 끔', () => ({ piiMask: false })],
      ['allowRawFileIngest 켬', () => ({ allowRawFileIngest: true })],
    ])('실제로 바뀌면 정확히 1 올린다 — %s', async (_label, change) => {
      const { id, payload } = await createSource();
      const res = await admin<{ configVersion: number }>('PATCH', `/kb-sources/${id}`, change(payload));
      expect(res.status).toBe(200);
      expect(res.body.configVersion).toBe(2);
    });

    it('진행 중인 실행이 있어도 값이 같으면 409가 아니고, 실제로 바꾸면 409 KB_SOURCE_BUSY다', async () => {
      const { id, payload } = await createSource();
      await prisma.kbSource.update({ where: { id }, data: { activeRunId: randomUUID() } });
      const same = await admin('PATCH', `/kb-sources/${id}`, { seedUrls: payload.seedUrls, maxDepth: 3, name: `개명-${randomUUID().slice(0, 6)}` });
      expect(same.status).toBe(200);
      const changed = await admin<{ code: string }>('PATCH', `/kb-sources/${id}`, { maxDepth: 2 });
      expect(changed.status).toBe(409);
      expect(changed.body.code).toBe('KB_SOURCE_BUSY');
      expect((await row(id))?.maxDepth).toBe(3);
      await prisma.kbSource.update({ where: { id }, data: { activeRunId: null } });
    });

    it('승인 상태와의 연결 — 같은 값 저장은 승인(ingestApproved)을 잃지 않고, 실제 변경은 미리보기를 다시 요구한다', async () => {
      const { id } = await createSource();
      await prisma.kbSource.update({ where: { id }, data: { approvedConfigVersion: 1 } });
      const same = await admin<{ ingestApproved: boolean; needsPreview: boolean }>('PATCH', `/kb-sources/${id}`, { maxDepth: 3 });
      expect(same.body.ingestApproved).toBe(true);
      const changed = await admin<{ ingestApproved: boolean; needsPreview: boolean }>('PATCH', `/kb-sources/${id}`, { maxDepth: 2 });
      expect(changed.body.ingestApproved).toBe(false);
    });
  });

  describe('수정에도 서버 상한이 적용된다(등록과 같은 규칙)', () => {
    it('PATCH { maxPages, maxFileBytes }가 KB_CRAWL_MAX_PAGES_CAP·KB_CRAWL_MAX_FILE_BYTES로 잘려 저장된다', async () => {
      const { id } = await createSource();
      const res = await admin<{ maxPages: number; maxFileBytes: number }>('PATCH', `/kb-sources/${id}`, { maxPages: 500_000, maxFileBytes: 900_000_000 });
      expect(res.status).toBe(200);
      expect(res.body.maxPages).toBe(1000);
      expect(res.body.maxFileBytes).toBe(5242880);
      expect((await row(id))?.maxPages).toBe(1000);
    });
  });

  describe('스코프 변경(§9.8)', () => {
    it('★ 스코프가 바뀌면 이전에 적재된 ACTIVE 문서에 SCOPE_CHANGED를 단다 · 같은 스코프 저장은 표시하지 않는다', async () => {
      const { id, payload } = await createSource();
      const mk = (over: Record<string, unknown>) =>
        prisma.kbDocument.create({ data: { sourceId: id, url: `https://203.0.113.10/${randomUUID()}`, urlHash: randomUUID().slice(0, 16), kind: 'HTML', externalFileName: 'x.docx', ...over } });
      const ingested = await mk({ lastIngestedAt: new Date() });
      const fresh = await mk({});

      await admin('PATCH', `/kb-sources/${id}`, { scope: payload.scope });
      expect((await prisma.kbDocument.findUnique({ where: { id: ingested.id } }))?.cleanupReason).toBeNull();

      const res = await admin<{ needsCleanupCount: number }>('PATCH', `/kb-sources/${id}`, { scope: { company: '예시공사', category: '테스트', subcategory: '옮김' } });
      expect(res.status).toBe(200);
      expect((await prisma.kbDocument.findUnique({ where: { id: ingested.id } }))?.cleanupReason).toBe('SCOPE_CHANGED');
      expect((await prisma.kbDocument.findUnique({ where: { id: fresh.id } }))?.cleanupReason).toBeNull();
      expect(res.body.needsCleanupCount).toBe(1); // 응답도 바로 반영한다.
    });
  });

  describe('일시중지(§9.9)', () => {
    it('★ enabled=false면 진행 중인 실행을 중지와 같은 방식으로 끝낸다(실행 CANCELLED · 대기 작업 CANCELLED · activeRunId 해제) + STATUS_CHANGE 감사', async () => {
      const { id } = await createSource();
      const source = (await row(id))!;
      const run = await prisma.kbSyncRun.create({ data: { id: randomUUID(), sourceId: id, sourceName: source.name, kind: 'SYNC', trigger: 'MANUAL', status: 'INGESTING', configVersion: 1, counts: '{}' } });
      const doc = await prisma.kbDocument.create({ data: { sourceId: id, url: `https://203.0.113.10/${randomUUID()}`, urlHash: randomUUID().slice(0, 16), kind: 'HTML', externalFileName: 'p.docx' } });
      const job = await prisma.kbIngestJob.create({ data: { runId: run.id, sourceId: id, documentId: doc.id, lane: 'BULK', reason: 'NEW', status: 'PENDING' } });
      await prisma.kbDocument.update({ where: { id: doc.id }, data: { activeIngestJobId: job.id } });
      await prisma.kbSource.update({ where: { id }, data: { activeRunId: run.id } });

      const res = await admin<{ enabled: boolean; activeRun: unknown }>('PATCH', `/kb-sources/${id}`, { enabled: false });
      expect(res.status).toBe(200);
      expect(res.body.enabled).toBe(false);
      expect(res.body.activeRun).toBeNull();

      expect((await prisma.kbSyncRun.findUnique({ where: { id: run.id } }))?.status).toBe('CANCELLED');
      expect((await prisma.kbIngestJob.findUnique({ where: { id: job.id } }))?.status).toBe('CANCELLED');
      expect((await prisma.kbDocument.findUnique({ where: { id: doc.id } }))?.activeIngestJobId).toBeNull();
      const after = await row(id);
      expect(after?.activeRunId).toBeNull();
      expect(after?.lastRunStatus).toBe('CANCELLED');
      const audits = await prisma.auditLog.findMany({ where: { targetType: 'KbSource', targetId: id, action: 'STATUS_CHANGE' } });
      expect(audits.some((a) => a.summary === '[일시중지]')).toBe(true);
    });

    it('재개(enabled=true)는 STATUS_CHANGE 감사를 남기고, 같은 값을 다시 보내는 것은 남기지 않는다', async () => {
      const { id } = await createSource();
      await admin('PATCH', `/kb-sources/${id}`, { enabled: true }); // 이미 켜져 있다 — 변화 없음.
      expect(await prisma.auditLog.count({ where: { targetType: 'KbSource', targetId: id, action: 'STATUS_CHANGE' } })).toBe(0);
      await admin('PATCH', `/kb-sources/${id}`, { enabled: false });
      await admin('PATCH', `/kb-sources/${id}`, { enabled: true });
      const summaries = (await prisma.auditLog.findMany({ where: { targetType: 'KbSource', targetId: id, action: 'STATUS_CHANGE' }, orderBy: { createdAt: 'asc' } })).map((a) => a.summary);
      expect(summaries).toEqual(['[일시중지]', '[재개]']);
    });
  });

  describe('★ 소스 선점(CAS)과 실행 행 생성은 한 트랜잭션이다(위반 5)', () => {
    async function servicesOf() {
      const { KbSourcesService } = await import('../kb-sync/kb-sources.service');
      const { KbRunStore } = await import('../kb-sync/core/kb-run.store');
      return { sources: moduleRef.get(KbSourcesService), store: moduleRef.get(KbRunStore) };
    }

    it('실행 행 생성이 실패하면 선점도 되돌아간다 — activeRunId가 존재하지 않는 실행을 가리키지 않는다', async () => {
      const { id } = await createSource();
      const source = (await row(id))!;
      const { sources, store } = await servicesOf();
      const spy = jest.spyOn(store, 'createRun').mockRejectedValueOnce(new Error('시험용: 실행 행 생성 실패'));

      await expect(
        sources.claimAndCreateRun({ sourceId: id, sourceName: source.name, kind: 'PREVIEW', trigger: 'MANUAL', configVersion: source.configVersion, nextRunAt: null }),
      ).rejects.toThrow('시험용');
      spy.mockRestore();

      const after = await row(id);
      expect(after?.activeRunId).toBeNull(); // 선점이 남지 않았다.
      expect(await prisma.kbSyncRun.count({ where: { sourceId: id } })).toBe(0);

      // 정상 경로는 둘 다 만든다 — 같은 id다.
      const ok = await sources.claimAndCreateRun({ sourceId: id, sourceName: source.name, kind: 'PREVIEW', trigger: 'MANUAL', configVersion: source.configVersion, nextRunAt: null });
      expect(ok).not.toBeNull();
      expect((await row(id))?.activeRunId).toBe(ok!.id);
      expect((await prisma.kbSyncRun.findUnique({ where: { id: ok!.id } }))?.status).toBe('QUEUED');
    });

    it('이미 실행 중이면 null을 돌려주고 아무것도 만들지 않는다 · 승인 기록도 남지 않는다(approval 동승)', async () => {
      const { id } = await createSource();
      const source = (await row(id))!;
      const { sources } = await servicesOf();
      await prisma.kbSource.update({ where: { id }, data: { activeRunId: randomUUID() } });

      const result = await sources.claimAndCreateRun({
        sourceId: id,
        sourceName: source.name,
        kind: 'SYNC',
        trigger: 'APPROVAL',
        configVersion: source.configVersion,
        nextRunAt: null,
        approval: { configVersion: source.configVersion, userId: 'admin' },
      });
      expect(result).toBeNull();
      const after = await row(id);
      expect(after?.approvedConfigVersion).toBeNull(); // 선점에 실패했는데 승인만 남는 일이 없다.
      expect(await prisma.kbSyncRun.count({ where: { sourceId: id } })).toBe(0);
    });

    it('승인 실행은 승인 기록·선점·실행 행이 함께 생긴다 · 승인 도중 실행 행 생성이 실패하면 승인도 되돌아간다', async () => {
      const { id } = await createSource();
      const source = (await row(id))!;
      const { sources, store } = await servicesOf();

      const spy = jest.spyOn(store, 'createRun').mockRejectedValueOnce(new Error('시험용'));
      await expect(
        sources.claimAndCreateRun({ sourceId: id, sourceName: source.name, kind: 'SYNC', trigger: 'APPROVAL', configVersion: 1, nextRunAt: null, approval: { configVersion: 1, userId: 'admin' } }),
      ).rejects.toThrow();
      spy.mockRestore();
      expect((await row(id))?.approvedConfigVersion).toBeNull();
      expect((await row(id))?.activeRunId).toBeNull();

      const ok = await sources.claimAndCreateRun({ sourceId: id, sourceName: source.name, kind: 'SYNC', trigger: 'APPROVAL', configVersion: 1, nextRunAt: null, approval: { configVersion: 1, userId: 'admin' } });
      expect(ok).not.toBeNull();
      const after = await row(id);
      expect(after?.approvedConfigVersion).toBe(1);
      expect(after?.approvedById).toBe('admin');
      expect(after?.activeRunId).toBe(ok!.id);
    });

    it('두 호출이 동시에 같은 소스를 선점하면 정확히 1건만 성공하고 실행 행도 1건뿐이다', async () => {
      const { id } = await createSource();
      const source = (await row(id))!;
      const { sources } = await servicesOf();
      const attempt = () => sources.claimAndCreateRun({ sourceId: id, sourceName: source.name, kind: 'PREVIEW', trigger: 'MANUAL', configVersion: 1, nextRunAt: null });
      const results = await Promise.allSettled([attempt(), attempt()]);
      const fulfilled = results.filter((r) => r.status === 'fulfilled' && r.value !== null);
      expect(fulfilled).toHaveLength(1);
      expect(await prisma.kbSyncRun.count({ where: { sourceId: id } })).toBe(1);
      expect((await row(id))?.activeRunId).toBe((fulfilled[0] as PromiseFulfilledResult<{ id: string }>).value.id);
    });
  });
});
