import { randomUUID } from 'node:crypto';
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

/**
 * 지식베이스 자동 크롤링/동기화(No.43) 3차 보완 — 계약 누락 4건(경고 `warnings[]` · `etaSeconds` ·
 * `REVIEW_REQUIRED` 구분 · `activeDocumentCount`) 통합 시험.
 *
 * 이 시험은 실제 크롤링·외부 RAG를 쓰지 않는다(항목들이 전부 "저장 응답 계산"·"DB 행 기반 집계"라
 * 실제 네트워크 왕복이 필요 없다) — 시드 URL은 DNS 조회 없이 통과하는 IP 리터럴(TEST-NET-3,
 * `203.0.113.0/24` — 문서화용 공인 대역)을 쓴다. 실행·작업 행은 `prisma`로 직접 구성해 타이밍 경합
 * 없이 결정적으로 검증한다.
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

function baseSourcePayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const suffix = randomUUID().slice(0, 8);
  return {
    name: `계약보완-${suffix}`,
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
    scope: { company: `회사-${suffix}`, category: '카테고리', subcategory: '서브카테고리' },
    schedule: { kind: 'MANUAL' },
    auth: { kind: 'NONE' },
    piiMask: true,
    allowRawFileIngest: false,
    rightsConfirmed: true,
    ...overrides,
  };
}

describe('지식베이스 소스 API 계약 보완(3차) — warnings · etaSeconds · REVIEW_REQUIRED · activeDocumentCount', () => {
  let app: NestExpressApplication;
  let baseUrl: string;
  let tmpDir: string;
  let prisma: PrismaService;
  let adminCookie = '';

  async function admin<T = unknown>(method: string, path: string, body?: unknown): Promise<ApiResponse<T>> {
    return jsonRequest(method, `${baseUrl}${path}`, body, { Cookie: adminCookie });
  }

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'chatbot-kb-sources-contract-test-'));
    const dbPath = join(tmpDir, 'test.db').replace(/\\/g, '/');
    const testDatabaseUrl = `file:${dbPath}`;

    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.DEPLOY_SCHEDULE_ENABLED = 'false';
    process.env.WIDGET_BASE_URL = process.env.WIDGET_BASE_URL ?? 'http://localhost:5174';
    process.env.PUBLIC_API_BASE_URL = process.env.PUBLIC_API_BASE_URL ?? 'http://localhost:3000/api/v1';
    delete process.env.EMBEDDING_BASE_URL;
    process.env.KB_SYNC_ENABLED = 'true';

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

    const { KbSyncJob } = await import('../kb-sync/engine/kb-sync.job');
    const kbSyncJob = moduleRef.get(KbSyncJob);
    await (kbSyncJob as unknown as { onModuleDestroy(): Promise<void> }).onModuleDestroy();
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await safeCleanupTmpDir(tmpDir);
  }, 15_000);

  /* ──────────────────────────────── 항목1 — 스코프 경고 warnings[] ──────────────────────────────── */
  describe('항목1 — 저장 응답 warnings[](설계서 :1078)', () => {
    const scope = { company: `공유회사-${randomUUID().slice(0, 8)}`, category: '인사', subcategory: '규정' };
    let sourceAId = '';
    let sourceBId = '';

    it('처음 등록하는 소스는 스코프가 겹치지 않지만, 읽는 챗봇이 없어 SCOPE_NOT_READ_BY_ANY_CHATBOT만 뜬다', async () => {
      const res = await admin<{ id: string; warnings?: Array<{ code: string }> }>('POST', '/kb-sources', baseSourcePayload({ scope }));
      expect(res.status).toBe(201);
      sourceAId = res.body.id;
      expect(res.body.warnings).toEqual([{ code: 'SCOPE_NOT_READ_BY_ANY_CHATBOT' }]);
    });

    it('같은 3단 스코프로 두 번째 소스를 등록하면 두 경고가 모두 뜬다(공유 + 미독)', async () => {
      const res = await admin<{ id: string; warnings?: Array<{ code: string }> }>('POST', '/kb-sources', baseSourcePayload({ scope }));
      expect(res.status).toBe(201);
      sourceBId = res.body.id;
      expect(res.body.warnings).toEqual(expect.arrayContaining([{ code: 'SCOPE_SHARED_WITH_OTHER_SOURCE' }, { code: 'SCOPE_NOT_READ_BY_ANY_CHATBOT' }]));
      expect(res.body.warnings).toHaveLength(2);
    });

    it('먼저 등록한 소스를 수정(PATCH)하면 이제는 그 응답에도 SCOPE_SHARED_WITH_OTHER_SOURCE가 뜬다', async () => {
      const res = await admin<{ warnings?: Array<{ code: string }> }>('PATCH', `/kb-sources/${sourceAId}`, { minIntervalMs: 600 });
      expect(res.status).toBe(200);
      expect(res.body.warnings).toEqual(expect.arrayContaining([{ code: 'SCOPE_SHARED_WITH_OTHER_SOURCE' }]));
    });

    it('★ 이 스코프를 읽는 챗봇이 생기면 SCOPE_NOT_READ_BY_ANY_CHATBOT가 사라진다(카테고리·서브카테고리 없음 = 전부 매칭)', async () => {
      const group = await prisma.chatbotGroup.create({ data: { name: `그룹-계약보완-${randomUUID().slice(0, 8)}` } });
      const chatbot = await prisma.chatbot.create({ data: { groupId: group.id, name: '계약보완 챗봇', slug: `contract-${randomUUID().slice(0, 8)}` } });
      await prisma.chatbotAnswerSetting.create({ data: { chatbotId: chatbot.id, ragEnabled: true, ragCompany: scope.company, ragCategory: null, ragSubcategory: null } });

      const res = await admin<{ warnings?: Array<{ code: string }> }>('PATCH', `/kb-sources/${sourceAId}`, { minIntervalMs: 700 });
      expect(res.status).toBe(200);
      expect(res.body.warnings).toEqual([{ code: 'SCOPE_SHARED_WITH_OTHER_SOURCE' }]);
    });

    it('단건 조회(GET)·목록 조회는 warnings를 계산하지 않는다(조회 비용 절감 — optional 필드)', async () => {
      const single = await admin<{ warnings?: unknown }>('GET', `/kb-sources/${sourceAId}`);
      expect(single.status).toBe(200);
      expect(single.body.warnings).toBeUndefined();

      const list = await admin<{ items: Array<{ warnings?: unknown }> }>('GET', '/kb-sources');
      expect(list.status).toBe(200);
      expect(list.body.items.every((i) => i.warnings === undefined)).toBe(true);
    });

    afterAll(async () => {
      // sourceBId는 뒤 시험(activeDocumentCount 등)과 스코프 독립성을 위해 정리하지 않고 둔다(격리된 고유 스코프 사용).
      void sourceBId;
    });
  });

  /* ──────────────────────────────── 항목3 — REVIEW_REQUIRED vs PREVIEW_REQUIRED ──────────────────────────────── */
  describe('항목3 — KB_INGEST_NOT_ALLOWED 사유 구분(설계서 :613)', () => {
    let sourceId = '';

    it('한 번도 승인된 적 없는 소스는 PREVIEW_REQUIRED다', async () => {
      const created = await admin<{ id: string }>('POST', '/kb-sources', baseSourcePayload());
      sourceId = created.body.id;

      const res = await admin<{ code: string; details: Array<{ field: string; message: string }> }>('POST', `/kb-sources/${sourceId}/runs`, { kind: 'SYNC' });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('KB_INGEST_NOT_ALLOWED');
      expect(res.body.details).toEqual([{ field: 'kind', message: 'PREVIEW_REQUIRED' }]);
    });

    it('★ 자동 미리보기 복귀(강등) 사유가 있으면 REVIEW_REQUIRED로 구분된다', async () => {
      await prisma.kbSource.update({ where: { id: sourceId }, data: { approvedConfigVersion: 1, reviewRequiredReason: 'NEW_RATIO' } });

      const res = await admin<{ code: string; details: Array<{ field: string; message: string }> }>('POST', `/kb-sources/${sourceId}/runs`, { kind: 'SYNC' });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('KB_INGEST_NOT_ALLOWED');
      expect(res.body.details).toEqual([{ field: 'kind', message: 'REVIEW_REQUIRED' }]);
    });
  });

  /* ──────────────────────────────── 항목5 — previewStale(R1 리뷰 M-1 계약 보완) ──────────────────────────────── */
  describe('항목5 — previewStale(설정 변경 전후 값 확인, approve-ingest의 PREVIEW_STALE 기준과 공유)', () => {
    let sourceId = '';

    it('미리보기가 아예 없으면 false다(그 경우는 needsPreview로 따로 판단)', async () => {
      const created = await admin<{ id: string; previewStale: boolean; configVersion: number }>('POST', '/kb-sources', baseSourcePayload());
      sourceId = created.body.id;
      expect(created.body.previewStale).toBe(false);
      expect(created.body.configVersion).toBe(1);
    });

    it('현재 configVersion과 같은 성공 PREVIEW가 있으면 false다', async () => {
      await prisma.kbSyncRun.create({
        data: { id: randomUUID(), sourceId, sourceName: 'previewStale-소스', kind: 'PREVIEW', trigger: 'MANUAL', status: 'SUCCEEDED', configVersion: 1, counts: '{}' },
      });
      const res = await admin<{ previewStale: boolean }>('GET', `/kb-sources/${sourceId}`);
      expect(res.body.previewStale).toBe(false);
    });

    it('★ 범위 설정을 바꾸면(configVersion 증가) 옛 미리보기가 낡은 것으로 바뀐다', async () => {
      const patched = await admin<{ configVersion: number }>('PATCH', `/kb-sources/${sourceId}`, { noisePatterns: ['광고'] });
      expect(patched.status).toBe(200);
      expect(patched.body.configVersion).toBe(2);

      const res = await admin<{ previewStale: boolean }>('GET', `/kb-sources/${sourceId}`);
      expect(res.body.previewStale).toBe(true);

      const list = await admin<{ items: Array<{ id: string; previewStale: boolean }> }>('GET', '/kb-sources?pageSize=50');
      expect(list.body.items.find((i) => i.id === sourceId)?.previewStale).toBe(true);
    });

    it('새 configVersion으로 다시 미리보기를 성공시키면 false로 돌아온다', async () => {
      await prisma.kbSyncRun.create({
        data: { id: randomUUID(), sourceId, sourceName: 'previewStale-소스', kind: 'PREVIEW', trigger: 'MANUAL', status: 'SUCCEEDED', configVersion: 2, counts: '{}' },
      });
      const res = await admin<{ previewStale: boolean }>('GET', `/kb-sources/${sourceId}`);
      expect(res.body.previewStale).toBe(false);
    });
  });

  /* ──────────────────────────────── 항목4 — activeDocumentCount ──────────────────────────────── */
  describe('항목4 — activeDocumentCount(설계서에 없는 추가 필드 — 편차)', () => {
    let sourceId = '';

    it('문서가 없으면 0이다', async () => {
      const created = await admin<{ id: string; activeDocumentCount: number }>('POST', '/kb-sources', baseSourcePayload());
      sourceId = created.body.id;
      expect(created.body.activeDocumentCount).toBe(0);
    });

    it('ACTIVE 문서만 센다(GONE·EXCLUDED는 제외) — 단건 조회·목록 조회 둘 다', async () => {
      const mkDoc = (state: string, seq: number) =>
        prisma.kbDocument.create({
          data: {
            sourceId,
            url: `https://203.0.113.10/doc-${seq}`,
            urlHash: randomUUID().replace(/-/g, '').slice(0, 16),
            kind: 'HTML',
            externalFileName: `kb_${randomUUID().slice(0, 8)}_${randomUUID().replace(/-/g, '').slice(0, 16)}.docx`,
            state,
          },
        });
      await Promise.all([mkDoc('ACTIVE', 1), mkDoc('ACTIVE', 2), mkDoc('GONE', 3), mkDoc('EXCLUDED', 4)]);

      const single = await admin<{ activeDocumentCount: number }>('GET', `/kb-sources/${sourceId}`);
      expect(single.body.activeDocumentCount).toBe(2);

      const list = await admin<{ items: Array<{ id: string; activeDocumentCount: number }> }>('GET', '/kb-sources?pageSize=50');
      const found = list.body.items.find((i) => i.id === sourceId);
      expect(found?.activeDocumentCount).toBe(2);
    });
  });

  /* ──────────────────────────────── 항목2 — etaSeconds ──────────────────────────────── */
  describe('항목2 — etaSeconds(설계서 §9.6) — 남은 작업 × 최근 평균 소요 ÷ 슬롯 수', () => {
    let sourceId = '';
    let runId = '';

    it('결정적 실행/작업 행을 직접 구성한다(타이밍 경합 없이 검증하기 위해 실제 크롤 대신 DB로 조립)', async () => {
      const created = await admin<{ id: string }>('POST', '/kb-sources', baseSourcePayload());
      sourceId = created.body.id;

      const mkDoc = (kind: string, seq: number) =>
        prisma.kbDocument.create({
          data: { sourceId, url: `https://203.0.113.10/eta-${seq}`, urlHash: randomUUID().replace(/-/g, '').slice(0, 16), kind, externalFileName: `kb_${randomUUID().slice(0, 8)}_${seq}.bin` },
        });
      const [htmlDoc, fileDoc] = await Promise.all([mkDoc('HTML', 1), mkDoc('PDF', 2)]);

      runId = randomUUID();
      const now = new Date();
      await prisma.kbSyncRun.create({
        data: { id: runId, sourceId, sourceName: 'eta-소스', kind: 'SYNC', trigger: 'MANUAL', status: 'INGESTING', configVersion: 1, counts: '{}', startedAt: now, crawlFinishedAt: now },
      });

      // 남은 작업 2건(HTML 1 · 파일 1) — 아직 제출 전이라 fileKind는 비어 있다(문서 kind로 보충 조회하는 경로를 검증).
      await prisma.kbIngestJob.create({ data: { runId, sourceId, documentId: htmlDoc.id, lane: 'INCREMENTAL', reason: 'NEW', status: 'PENDING' } });
      await prisma.kbIngestJob.create({ data: { runId, sourceId, documentId: fileDoc.id, lane: 'INCREMENTAL', reason: 'NEW', status: 'PENDING' } });

      // 최근 성공 작업 표본(제출→완료) — HTML 30초 · 파일 100초.
      await prisma.kbIngestJob.create({
        data: {
          runId,
          sourceId,
          documentId: htmlDoc.id,
          lane: 'INCREMENTAL',
          reason: 'NEW',
          status: 'SUCCEEDED',
          fileKind: 'HTML',
          submittedAt: new Date(now.getTime() - 30_000),
          completedAt: now,
        },
      });
      await prisma.kbIngestJob.create({
        data: {
          runId,
          sourceId,
          documentId: fileDoc.id,
          lane: 'INCREMENTAL',
          reason: 'NEW',
          status: 'SUCCEEDED',
          fileKind: 'PDF',
          submittedAt: new Date(now.getTime() - 100_000),
          completedAt: now,
        },
      });
    });

    it('★ 남은 작업 × 최근 평균(HTML 30초·파일 100초) ÷ 슬롯 수(기본 1) = 130초', async () => {
      const res = await admin<{ etaSeconds: number | null; ingest: { pending: number } | null }>('GET', `/kb-sources/${sourceId}/runs/${runId}`);
      expect(res.status).toBe(200);
      expect(res.body.ingest?.pending).toBe(2);
      expect(res.body.etaSeconds).toBe(130);
    });

    it('소스 응답의 activeRun에도 같은 etaSeconds가 실린다(kb-sources.service.ts:316 자리 — 이전엔 null 하드코딩)', async () => {
      await prisma.kbSource.update({ where: { id: sourceId }, data: { activeRunId: runId } });
      const res = await admin<{ activeRun: { etaSeconds: number | null } | null }>('GET', `/kb-sources/${sourceId}`);
      expect(res.body.activeRun?.etaSeconds).toBe(130);
      await prisma.kbSource.update({ where: { id: sourceId }, data: { activeRunId: null } }); // 원복.
    });

    it('남은 작업이 0건이면(전부 완료) 0을 낸다(null이 아니다)', async () => {
      await prisma.kbIngestJob.updateMany({ where: { runId, status: 'PENDING' }, data: { status: 'SUCCEEDED', fileKind: 'HTML', submittedAt: new Date(), completedAt: new Date() } });
      const res = await admin<{ etaSeconds: number | null }>('GET', `/kb-sources/${sourceId}/runs/${runId}`);
      expect(res.body.etaSeconds).toBe(0);
    });

    it('아직 크롤 단계(INGESTING 이전)면 추정할 수 없어 null이다', async () => {
      const crawlingRunId = randomUUID();
      await prisma.kbSyncRun.create({
        data: { id: crawlingRunId, sourceId, sourceName: 'eta-소스', kind: 'SYNC', trigger: 'MANUAL', status: 'CRAWLING', configVersion: 1, counts: '{}', startedAt: new Date() },
      });
      const res = await admin<{ etaSeconds: number | null }>('GET', `/kb-sources/${sourceId}/runs/${crawlingRunId}`);
      expect(res.body.etaSeconds).toBeNull();
    });
  });
});
