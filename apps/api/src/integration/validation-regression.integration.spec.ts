import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import * as http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VersioningType } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { normalizeText } from '@chat-bot/shared-types';
import { AppModule } from '../app.module';
import { AllExceptionsFilter } from '../common/all-exceptions.filter';
import { PrismaService } from '../prisma/prisma.service';
import { loginAs, seedTestUsers } from './helpers/auth.helper';

const API_ROOT = join(__dirname, '..', '..');

/** Windows SQLite 파일 핸들 지연 해제 대비(기존 그룹 통합 테스트와 동일한 완화책). */
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
 * 검증/품질 고도화(No.19 대화검증시스템·TC테스트 / No.20 학습영향도 TEST) 통합 테스트.
 * `docs/requirements/validation-regression.md` §13이 명시한 필수 3종(AC-V2-10·AC-V4-3·AC-V2-12 —
 * AC-V4-3은 이 파일이 아니라 `validation/run/query-embedding-cache-isolation.spec.ts`가 담당한다)
 * 중 나머지 2종과, M2 쓰기 0건·VIEWER 21핸들러 게이팅·챗봇 영구삭제 동반 삭제를 HTTP 계약 레벨로
 * 검증한다. `EMBEDDING_BASE_URL`을 설정하지 않아 규칙 매칭만으로 동작한다(AC-V4-10과 동시에 충족).
 */
describe('검증/품질 고도화(No.19/20) 통합 테스트', () => {
  let app: NestExpressApplication;
  let baseUrl: string;
  let tmpDir: string;
  let prisma: PrismaService;
  let adminCookie = '';
  let viewerCookie = '';

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'chatbot-validation-regression-test-'));
    const dbPath = join(tmpDir, 'test.db').replace(/\\/g, '/');
    const testDatabaseUrl = `file:${dbPath}`;

    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.WIDGET_BASE_URL = process.env.WIDGET_BASE_URL ?? 'http://localhost:5174';
    process.env.PUBLIC_API_BASE_URL = process.env.PUBLIC_API_BASE_URL ?? 'http://localhost:3000/api/v1';
    delete process.env.EMBEDDING_BASE_URL; // 규칙 매칭만 — 이 그룹은 자체 GPU를 쓰지 않는다(§4.5).

    try {
      execSync('pnpm exec prisma db push --skip-generate --accept-data-loss', {
        cwd: API_ROOT,
        env: { ...process.env, DATABASE_URL: testDatabaseUrl },
        stdio: 'pipe',
      });
    } catch (e) {
      const err = e as { stdout?: Buffer; stderr?: Buffer };
      throw new Error(`prisma db push 실패:\n${err.stdout?.toString()}\n${err.stderr?.toString()}`);
    }

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
    viewerCookie = await loginAs(baseUrl, 'VIEWER');
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await safeCleanupTmpDir(tmpDir);
  }, 15_000);

  function admin<T = unknown>(method: string, path: string, body?: unknown): Promise<ApiResponse<T>> {
    return jsonRequest(method, `${baseUrl}${path}`, body, { Cookie: adminCookie });
  }

  function viewer<T = unknown>(method: string, path: string, body?: unknown): Promise<ApiResponse<T>> {
    return jsonRequest(method, `${baseUrl}${path}`, body, { Cookie: viewerCookie });
  }

  async function createChatbot(namePrefix: string): Promise<{ id: string; name: string; slug: string }> {
    const groupRes = await admin<{ id: string }>('POST', '/chatbot-groups', { name: `${namePrefix} 그룹` });
    const groupId = groupRes.body.id;
    const suffix = Math.random().toString(36).slice(2, 10);
    const slug = `vr-${suffix}`;
    const name = `${namePrefix}-${suffix}`;
    const res = await admin<{ id: string }>('POST', '/chatbots', { groupId, name, slug });
    return { id: res.body.id, name, slug };
  }

  async function createIntent(chatbotId: string, name: string, examples: string[]): Promise<string> {
    const res = await admin<{ intent: { id: string } }>('POST', `/chatbots/${chatbotId}/intents`, { name, examples });
    return res.body.intent.id;
  }

  async function createTestSet(chatbotId: string, name: string): Promise<string> {
    const res = await admin<{ id: string }>('POST', `/chatbots/${chatbotId}/test-sets`, { name });
    expect(res.status).toBe(201);
    return res.body.id;
  }

  async function createTestCase(
    chatbotId: string,
    setId: string,
    dto: { messages: string[]; expectedKind: string; expectedTargetId?: string },
  ): Promise<string> {
    const res = await admin<{ id: string }>('POST', `/chatbots/${chatbotId}/test-sets/${setId}/cases`, dto);
    expect(res.status).toBe(201);
    return res.body.id;
  }

  async function startRun(chatbotId: string, setId: string, body: Record<string, unknown> = { overlaySource: 'NONE', useRag: false }) {
    const res = await admin<{ runId: string; status: string }>('POST', `/chatbots/${chatbotId}/test-sets/${setId}/runs`, body);
    expect(res.status).toBe(202);
    return res.body.runId;
  }

  async function pollRun(chatbotId: string, runId: string, maxWaitMs = 20_000): Promise<Record<string, unknown>> {
    const start = Date.now();
    for (;;) {
      const res = await admin<Record<string, unknown>>('GET', `/chatbots/${chatbotId}/test-runs/${runId}`);
      const status = res.body.status as string;
      if (status === 'SUCCEEDED' || status === 'FAILED' || status === 'CANCELLED') return res.body;
      if (Date.now() - start > maxWaitMs) throw new Error(`실행이 ${maxWaitMs}ms 내에 끝나지 않았습니다(status=${status})`);
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  describe('AC-V2-10 — 대량 실행이 대화 로그·미응답 큐·RAG 호출 로그를 오염시키지 않는다(J-9)', () => {
    it('실행 전후로 ConversationLog·UnansweredQuestion·RagCallLog 행 수가 그대로다', async () => {
      const { id: chatbotId } = await createChatbot('V2-10 로그오염');
      const shippingIntentId = await createIntent(chatbotId, '배송문의', ['배송 조회']);

      // 운영 트래픽이 이미 남긴 로그(대화 1건·미응답 1건·RAG 호출 1건)를 baseline으로 시딩한다 —
      // "원래 0이었다"가 아니라 "원래 있던 것이 그대로 유지된다"를 증명해야 더 강한 신호다.
      await prisma.conversationLog.create({
        data: { chatbotId, channelType: 'WEB', userMessage: '기존 대화', botResponse: '기존 응답', dayBucket: '2026-09-23', hourBucket: 10 },
      });
      await prisma.unansweredQuestion.create({
        data: { chatbotId, questionText: '기존 미응답', questionNormalized: normalizeText('기존 미응답') },
      });
      await prisma.ragCallLog.create({ data: { chatbotId, outcome: 'SUCCESS', latencyMs: 120 } });

      const countAll = () =>
        Promise.all([
          prisma.conversationLog.count({ where: { chatbotId } }),
          prisma.unansweredQuestion.count({ where: { chatbotId } }),
          prisma.ragCallLog.count({ where: { chatbotId } }),
        ]);
      const before = await countAll();

      const setId = await createTestSet(chatbotId, '로그오염 회귀세트');
      await createTestCase(chatbotId, setId, { messages: ['배송 조회'], expectedKind: 'INTENT', expectedTargetId: shippingIntentId });
      await createTestCase(chatbotId, setId, { messages: ['전혀 관계없는 질문 asdf1234'], expectedKind: 'FALLBACK' });
      await createTestCase(chatbotId, setId, { messages: ['또 다른 무관 질문 qwer5678'], expectedKind: 'ANY' });

      const runId = await startRun(chatbotId, setId);
      const finished = await pollRun(chatbotId, runId);
      expect(finished.status).toBe('SUCCEEDED');

      const after = await countAll();
      expect(after).toEqual(before);
    }, 30_000);
  });

  describe('AC-V2-12 — 결정론: 같은 자산·같은 TC 세트를 2회 실행하면 판정이 완전히 동일하다(NFR-VM6)', () => {
    it('두 실행의 판정·매칭 대상·구간·응답 미리보기가 caseId 기준으로 완전히 일치한다', async () => {
      const { id: chatbotId } = await createChatbot('V2-12 결정론');
      const shippingIntentId = await createIntent(chatbotId, '배송문의', ['배송 조회']);
      const setId = await createTestSet(chatbotId, '결정론 세트');
      await createTestCase(chatbotId, setId, { messages: ['배송 조회'], expectedKind: 'INTENT', expectedTargetId: shippingIntentId });
      await createTestCase(chatbotId, setId, { messages: ['전혀 관계없는 질문 zzz111'], expectedKind: 'FALLBACK' });

      const runId1 = await startRun(chatbotId, setId);
      await pollRun(chatbotId, runId1);
      const runId2 = await startRun(chatbotId, setId);
      await pollRun(chatbotId, runId2);

      const results1 = await admin<{ items: Array<Record<string, unknown>> }>('GET', `/chatbots/${chatbotId}/test-runs/${runId1}/results?pageSize=100`);
      const results2 = await admin<{ items: Array<Record<string, unknown>> }>('GET', `/chatbots/${chatbotId}/test-runs/${runId2}/results?pageSize=100`);

      expect(results1.body.items).toHaveLength(2);
      expect(results2.body.items).toHaveLength(2);

      const byCaseId1 = new Map(results1.body.items.map((r) => [r.caseId, r]));
      for (const r2 of results2.body.items) {
        const r1 = byCaseId1.get(r2.caseId);
        expect(r1).toBeDefined();
        expect(r2.resultA).toBe(r1!.resultA);
        expect(r2.matchedIntentIdA).toBe(r1!.matchedIntentIdA);
        expect(r2.matchedFaqIdA).toBe(r1!.matchedFaqIdA);
        expect(r2.matchedNodeIdA).toBe(r1!.matchedNodeIdA);
        expect(r2.bandA).toBe(r1!.bandA);
        expect(r2.outputsPreviewA).toBe(r1!.outputsPreviewA);
      }
    }, 30_000);
  });

  describe('M2 — AUGMENTATION_SUGGESTIONS 오버레이 합성은 자산에 쓰기 0건이다(NFR-VS3, AC-V3-6)', () => {
    it('실행 후 AugmentationSuggestion·Intent·Keyword가 실행 전과 완전히 동일하다', async () => {
      const { id: chatbotId } = await createChatbot('M2 쓰기0');
      const intentId = await createIntent(chatbotId, '환불문의', ['환불하고 싶어요']);

      const suggestionText = 'TC오버레이제안문장';
      const suggestion = await prisma.augmentationSuggestion.create({
        data: {
          chatbotId,
          intentId,
          text: suggestionText,
          textNormalized: normalizeText(suggestionText),
          similarityToSeed: 0.9,
          providerId: 'mock',
          modelId: 'itest-model-v1',
          status: 'PENDING',
        },
      });

      const intentBefore = await prisma.intent.findUniqueOrThrow({ where: { id: intentId } });
      const suggestionBefore = await prisma.augmentationSuggestion.findUniqueOrThrow({ where: { id: suggestion.id } });
      const keywordCountBefore = await prisma.keyword.count({ where: { chatbotId } });

      const setId = await createTestSet(chatbotId, 'M2 쓰기0 세트');
      await createTestCase(chatbotId, setId, { messages: ['환불하고 싶어요'], expectedKind: 'INTENT', expectedTargetId: intentId });
      await createTestCase(chatbotId, setId, { messages: ['전혀 무관한 문장 m2test'], expectedKind: 'FALLBACK' });

      const runId = await startRun(chatbotId, setId, { overlaySource: 'AUGMENTATION_SUGGESTIONS', suggestionIds: [suggestion.id], useRag: false });
      const finished = await pollRun(chatbotId, runId);

      expect(finished.status).toBe('SUCCEEDED');
      expect(finished.mode).toBe('OVERLAY_COMPARE');
      const summary = finished.summary as { b?: unknown; excludedSuggestions?: number };
      expect(summary.b).toBeDefined();
      expect(summary.excludedSuggestions ?? 0).toBe(0);

      const intentAfter = await prisma.intent.findUniqueOrThrow({ where: { id: intentId } });
      const suggestionAfter = await prisma.augmentationSuggestion.findUniqueOrThrow({ where: { id: suggestion.id } });
      const keywordCountAfter = await prisma.keyword.count({ where: { chatbotId } });

      expect(intentAfter.examples).toEqual(intentBefore.examples);
      expect(intentAfter.updatedAt.getTime()).toBe(intentBefore.updatedAt.getTime());
      expect(suggestionAfter.status).toBe(suggestionBefore.status);
      expect(suggestionAfter.updatedAt.getTime()).toBe(suggestionBefore.updatedAt.getTime());
      expect(keywordCountAfter).toBe(keywordCountBefore);
    }, 30_000);
  });

  describe('AC-V4-9 — 챗봇 영구 삭제 시 검증 자산 4테이블이 동반 삭제된다(NFR-VS8)', () => {
    it('TestCaseSet·TestCase·TestRun·TestRunResult가 전부 제거된다', async () => {
      const { id: chatbotId, name } = await createChatbot('V4-9 영구삭제');
      // 영구삭제 사전검사(CHATBOT_HAS_CHILDREN)를 피하려고 의도·노드·채널 등은 만들지 않는다.
      const setId = await createTestSet(chatbotId, '삭제대상 세트');
      const caseId = await createTestCase(chatbotId, setId, { messages: ['아무 질문'], expectedKind: 'FALLBACK' });
      const runId = await startRun(chatbotId, setId);
      await pollRun(chatbotId, runId);

      expect(await prisma.testRunResult.count({ where: { runId } })).toBeGreaterThan(0);

      const archiveRes = await admin('DELETE', `/chatbots/${chatbotId}`);
      expect(archiveRes.status).toBe(204);
      const purgeRes = await admin('POST', `/chatbots/${chatbotId}/permanent-delete`, { confirmName: name });
      expect(purgeRes.status).toBe(204);

      expect(await prisma.testCaseSet.findUnique({ where: { id: setId } })).toBeNull();
      expect(await prisma.testCase.findUnique({ where: { id: caseId } })).toBeNull();
      expect(await prisma.testRun.findUnique({ where: { id: runId } })).toBeNull();
      expect(await prisma.testRunResult.count({ where: { runId } })).toBe(0);
    }, 30_000);
  });

  describe('VIEWER 권한 게이팅 — 21개 핸들러 전수 확인(AC-V4-5, S-13)', () => {
    it('쓰기 12개는 전부 403, 읽기 9개는 전부 200이다(누락 핸들러 없음을 개수로도 고정)', async () => {
      const { id: chatbotId } = await createChatbot('VIEWER 게이팅');
      const shippingIntentId = await createIntent(chatbotId, '배송문의', ['배송 조회']);
      const setId = await createTestSet(chatbotId, '게이팅 세트');
      const caseId = await createTestCase(chatbotId, setId, { messages: ['배송 조회'], expectedKind: 'INTENT', expectedTargetId: shippingIntentId });

      const runId1 = await startRun(chatbotId, setId);
      await pollRun(chatbotId, runId1);
      const runId2 = await startRun(chatbotId, setId);
      await pollRun(chatbotId, runId2);

      const base = `/chatbots/${chatbotId}`;
      const endpoints: Array<{ method: string; path: string; body?: unknown; kind: 'read' | 'write' }> = [
        { method: 'GET', path: `${base}/test-sets`, kind: 'read' },
        { method: 'POST', path: `${base}/test-sets`, kind: 'write', body: { name: 'VIEWER시도세트' } },
        { method: 'GET', path: `${base}/test-sets/template?format=csv`, kind: 'read' },
        { method: 'PATCH', path: `${base}/test-sets/${setId}`, kind: 'write', body: { name: '변경시도' } },
        { method: 'GET', path: `${base}/test-sets/${setId}/cases`, kind: 'read' },
        { method: 'POST', path: `${base}/test-sets/${setId}/cases`, kind: 'write', body: { messages: ['x'], expectedKind: 'FALLBACK' } },
        { method: 'POST', path: `${base}/test-sets/${setId}/cases/bulk-disable`, kind: 'write', body: { caseIds: [caseId] } },
        { method: 'POST', path: `${base}/test-sets/${setId}/cases/import/validate`, kind: 'write' },
        { method: 'POST', path: `${base}/test-sets/${setId}/cases/import/commit`, kind: 'write', body: { importToken: 'x' } },
        { method: 'GET', path: `${base}/test-sets/${setId}/cases/export`, kind: 'read' },
        { method: 'PATCH', path: `${base}/test-sets/${setId}/cases/${caseId}`, kind: 'write', body: { enabled: false } },
        { method: 'POST', path: `${base}/test-sets/${setId}/runs`, kind: 'write', body: { overlaySource: 'NONE', useRag: false } },
        { method: 'GET', path: `${base}/test-runs`, kind: 'read' },
        { method: 'GET', path: `${base}/test-runs/compare?baseRunId=${runId1}&targetRunId=${runId2}`, kind: 'read' },
        { method: 'GET', path: `${base}/test-runs/${runId1}`, kind: 'read' },
        { method: 'GET', path: `${base}/test-runs/${runId1}/results`, kind: 'read' },
        { method: 'POST', path: `${base}/test-runs/${runId1}/cancel`, kind: 'write' },
        { method: 'POST', path: `${base}/test-runs/${runId1}/pin`, kind: 'write', body: { pinned: true } },
        { method: 'GET', path: `${base}/test-runs/${runId1}/export`, kind: 'read' },
        // 파괴적 쓰기는 맨 뒤에 둔다 — 가드가 정상 동작하면 실제로 지워지지 않으므로 순서는
        // 무관하지만, 혹시 가드가 뚫려 있다면(버그) 뒤따르는 읽기 검증까지 오염시키지 않기 위함이다.
        { method: 'DELETE', path: `${base}/test-sets/${setId}/cases/${caseId}`, kind: 'write' },
        { method: 'DELETE', path: `${base}/test-sets/${setId}`, kind: 'write' },
      ];

      expect(endpoints).toHaveLength(21);
      expect(endpoints.filter((e) => e.kind === 'write')).toHaveLength(12);
      expect(endpoints.filter((e) => e.kind === 'read')).toHaveLength(9);

      for (const ep of endpoints) {
        const res = await viewer(ep.method, ep.path, ep.body);
        if (ep.kind === 'write') {
          expect(res.status).toBe(403);
        } else {
          expect(res.status).toBe(200);
        }
      }

      // 가드가 실제로 서비스 호출 전에 막았는지 부수 효과로도 확인한다 — VIEWER의 세트 생성
      // 시도가 DB에 반영되지 않았어야 한다.
      const setsAfter = await prisma.testCaseSet.findMany({ where: { chatbotId } });
      expect(setsAfter.map((s) => s.id)).toEqual([setId]); // VIEWER가 만들려던 세트는 존재하지 않는다.
      expect(await prisma.testCase.findUnique({ where: { id: caseId } })).not.toBeNull(); // VIEWER의 DELETE는 반영되지 않았다.
    }, 30_000);
  });
});
