import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
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
import { encodeVector } from '../embedding/lib/vector-codec';
import { loginAs, seedTestUsers } from './helpers/auth.helper';

const API_ROOT = join(__dirname, '..', '..');

/**
 * Windows에서 SQLite 파일 핸들 해제가 `app.close()` 직후 완전히 끝나지 않아 `rmSync`가
 * EPERM/EBUSY로 실패하는 경우가 있다(테스트 인프라 안정성 문제 — 프로덕션 코드와 무관, 기존
 * `오류검출_프로세스.md` 결함이력의 Low 등급 판정과 같은 성격). 짧은 유예 + 재시도로 흡수하고,
 * 그래도 실패하면 임시 디렉터리 정리만 건너뛴다(OS 임시 폴더 정리 대상 — 테스트 결과에는 무해).
 */
async function safeCleanupTmpDir(dir: string): Promise<void> {
  await new Promise((r) => setTimeout(r, 300));
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {
    // 정리 실패는 무시한다 — OS 임시 폴더 청소 대상일 뿐 테스트 판정에 영향 없음.
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
 * GET /health · POST /embed에 응답하는 mock 임베딩 서버. `/embed`까지 성공으로 만들어 두는 이유는
 * `semanticEnabled`가 기본 false라 공개 대화 경로에서는 어차피 호출되지 않지만, 의도 생성 시
 * 백그라운드 재색인 큐(`EMBEDDING_BASE_URL`이 살아있어 활성화됨)가 같은 임베딩 벡터 행을 향해
 * 비동기로 경합할 수 있기 때문이다 — `/embed`가 항상 실패(404)하면 재색인이 그 행을 나중에
 * `FAILED`로 덮어써 테스트가 타이밍에 따라 간헐적으로 깨진다(직접 시딩과 배경 재색인 중 어느
 * 쪽이 나중에 끝나는지에 좌우됨). `/embed`를 성공시키면 어느 쪽이 이기든 최종 상태가 `READY`로
 * 수렴해 결정론적이다 — 이 테스트는 실제 벡터 값(정확도)이 아니라 학습 성립 여부만 검증한다.
 */
function startMockEmbeddingServer(modelId: string, dimension: number): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', modelId, dimension, warmedUp: true }));
        return;
      }
      if (req.method === 'POST' && req.url === '/embed') {
        let raw = '';
        req.on('data', (chunk) => {
          raw += chunk;
        });
        req.on('end', () => {
          let texts: string[] = [];
          try {
            texts = (JSON.parse(raw) as { texts?: string[] }).texts ?? [];
          } catch {
            texts = [];
          }
          const vectors = texts.map(() => Array.from({ length: dimension }, () => 0));
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ modelId, dimension, vectors }));
        });
        return;
      }
      res.writeHead(404);
      res.end();
    });
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

/**
 * 학습 고도화(No.16/23) 통합 테스트 — `docs/requirements/learning-augmentation.md`의
 * ① 분류기 대화 무영향(J-6, AC-L4-5의 행동적 증거 — 정적 검사는 `public-conversation-classifier-
 *    isolation.spec.ts`가 별도로 담당한다) ② VIEWER 403 게이팅(AC-L3-4, 백엔드 축) ③ 기동 시
 *    고아 Job 정리(EX-L2-7)를 HTTP 계약 레벨로 검증한다.
 */
describe('학습 고도화(No.16/23) 통합 테스트', () => {
  let app: NestExpressApplication;
  let baseUrl: string;
  let tmpDir: string;
  let prisma: PrismaService;
  let embeddingServer: { url: string; close: () => Promise<void> };
  let adminCookie = '';
  let viewerCookie = '';

  const MODEL_ID = 'itest-embedding-v1';
  const DIMENSION = 4;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'chatbot-learning-augmentation-test-'));
    const dbPath = join(tmpDir, 'test.db').replace(/\\/g, '/');
    const testDatabaseUrl = `file:${dbPath}`;

    embeddingServer = await startMockEmbeddingServer(MODEL_ID, DIMENSION);

    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.DEPLOY_SCHEDULE_ENABLED = 'false'; // [No.28] 실행 엔진 비활성 — 기존 그룹 통합 시험은 폴링 없이 수행(§7.10)
    process.env.WIDGET_BASE_URL = process.env.WIDGET_BASE_URL ?? 'http://localhost:5174';
    process.env.PUBLIC_API_BASE_URL = process.env.PUBLIC_API_BASE_URL ?? 'http://localhost:3000/api/v1';
    process.env.EMBEDDING_BASE_URL = embeddingServer.url;
    // 전체 스위트를 병렬로 돌릴 때(CPU 경합)의 헬스체크 타임아웃 여유(기본 300ms는 부하 상황에 빠듯하다).
    process.env.EMBEDDING_TIMEOUT_MS = '5000';

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
    await embeddingServer?.close();
    await safeCleanupTmpDir(tmpDir);
  }, 15_000);

  function admin<T = unknown>(method: string, path: string, body?: unknown): Promise<ApiResponse<T>> {
    return jsonRequest(method, `${baseUrl}${path}`, body, { Cookie: adminCookie });
  }

  function viewer<T = unknown>(method: string, path: string, body?: unknown): Promise<ApiResponse<T>> {
    return jsonRequest(method, `${baseUrl}${path}`, body, { Cookie: viewerCookie });
  }

  function sendPublicMessage(slug: string, sessionId: string, message: string) {
    return jsonRequest('POST', `${baseUrl}/public/chatbots/${slug}/messages`, { sessionId, message });
  }

  async function createChatbot(): Promise<{ id: string; slug: string }> {
    const groupRes = await admin<{ id: string }>('POST', '/chatbot-groups', { name: '학습고도화 테스트 그룹' });
    const groupId = groupRes.body.id;
    const suffix = Math.random().toString(36).slice(2, 10);
    const slug = `la-bot-${suffix}`;
    const res = await admin<{ id: string }>('POST', '/chatbots', { groupId, name: '학습고도화 테스트봇', slug });
    return { id: res.body.id, slug };
  }

  async function setupPublicChatbot(): Promise<{ chatbotId: string; slug: string }> {
    const { id: chatbotId, slug } = await createChatbot();
    const statusRes = await admin('PATCH', `/chatbots/${chatbotId}/status`, { status: 'ACTIVE' });
    expect(statusRes.status).toBe(200);
    const channelRes = await admin('PATCH', `/chatbots/${chatbotId}/channels/WEB`, {
      enabled: true,
      config: { allowedOrigins: [], greetingMessage: '무엇을 도와드릴까요?' },
    });
    expect(channelRes.status).toBe(200);
    return { chatbotId, slug };
  }

  async function createIntent(chatbotId: string, name: string, examples: string[]): Promise<string> {
    const res = await admin<{ intent: { id: string } }>('POST', `/chatbots/${chatbotId}/intents`, { name, examples });
    return res.body.intent.id;
  }

  async function seedEmbeddingVectorsForIntent(chatbotId: string, intentId: string, exampleCount: number, base: number[]): Promise<void> {
    for (let i = 0; i < exampleCount; i += 1) {
      const vector = new Float32Array(base.length);
      for (let d = 0; d < base.length; d += 1) vector[d] = base[d] + (d === base.length - 1 ? i * 0.001 : 0); // 완전 동일 벡터 dedupe 회피용 미세 변주
      // upsert()로 시딩한다 — 배경 재색인이 같은 키로 행을 먼저 만들어 뒀어도(mock /embed는
      // 항상 200을 반환하므로 둘 다 결국 READY로 수렴하지만) 순서에 의존하지 않기 위함이다.
      await prisma.embeddingVector.upsert({
        where: {
          chatbotId_ownerType_ownerId_slotIndex_modelId: {
            chatbotId,
            ownerType: 'INTENT_EXAMPLE',
            ownerId: intentId,
            slotIndex: i,
            modelId: MODEL_ID,
          },
        },
        create: {
          chatbotId,
          ownerType: 'INTENT_EXAMPLE',
          ownerId: intentId,
          slotIndex: i,
          textHash: `itest-hash-${intentId}-${i}`,
          modelId: MODEL_ID,
          dimension: DIMENSION,
          vector: encodeVector(vector),
          status: 'READY',
        },
        update: {
          dimension: DIMENSION,
          vector: encodeVector(vector),
          status: 'READY',
          failureReason: null,
        },
      });
    }
  }

  async function pollClassifierStatus(chatbotId: string, maxWaitMs = 15_000): Promise<{ state: string }> {
    const start = Date.now();
    for (;;) {
      const res = await admin<{ state: string }>('GET', `/chatbots/${chatbotId}/intent-classifier/status`);
      if (res.body.state !== 'TRAINING' && res.body.state !== 'NONE') return res.body;
      if (Date.now() - start > maxWaitMs) throw new Error(`분류기 학습이 ${maxWaitMs}ms 안에 끝나지 않았습니다(state=${res.body.state})`);
      await new Promise((r) => setTimeout(r, 150));
    }
  }

  describe('① 분류기 학습이 공개 대화 응답에 영향을 주지 않는다(J-6, AC-L4-5 행동적 증거)', () => {
    it('분류기를 학습시킨 상태에서 공개 대화 API를 호출해도 응답이 학습 전과 동일하다(messageId 제외)', async () => {
      const { chatbotId, slug } = await setupPublicChatbot();
      const fixedMessage = '배송 언제 오나요';

      const shippingExamples = Array.from({ length: 12 }, (_, i) => (i === 0 ? fixedMessage : `배송 문의 예문 ${i}`));
      const refundExamples = Array.from({ length: 12 }, (_, i) => `환불 문의 예문 ${i}`);
      const shippingIntentId = await createIntent(chatbotId, '배송문의', shippingExamples);
      const refundIntentId = await createIntent(chatbotId, '환불문의', refundExamples);

      const nodeRes = await admin<{ id: string }>('POST', `/chatbots/${chatbotId}/dialog-nodes`, {
        name: '배송문의_응답',
        intentIds: [shippingIntentId],
        outputs: [{ type: 'TEXT', payload: { text: '운송장을 확인해 드릴게요.' } }],
      });
      expect(nodeRes.status).toBe(201);

      // 학습 최소 조건(의도 2개·의도당 3건 이상·총 20건 이상)을 만족하는 임베딩 벡터를 직접 시딩한다
      // (재임베딩 없이 이미 저장된 벡터로 학습한다는 FR-L2-14 전제를 그대로 재현).
      await seedEmbeddingVectorsForIntent(chatbotId, shippingIntentId, shippingExamples.length, [1, 0, 0, 0]);
      await seedEmbeddingVectorsForIntent(chatbotId, refundIntentId, refundExamples.length, [0, 1, 0, 0]);

      const before = await sendPublicMessage(slug, randomUUID(), fixedMessage);
      expect(before.status).toBe(200);
      const beforeBody = before.body as { messageId: string; outputs: unknown; state: unknown; stateReset: boolean };
      expect(beforeBody.outputs).toBeTruthy();

      const trainRes = await admin<{ jobId: string; status: string }>('POST', `/chatbots/${chatbotId}/intent-classifier/train`);
      expect(trainRes.status).toBe(202);
      expect(trainRes.body.status).toBe('QUEUED');

      const finalStatus = await pollClassifierStatus(chatbotId);
      expect(finalStatus.state).toBe('READY');

      const after = await sendPublicMessage(slug, randomUUID(), fixedMessage);
      expect(after.status).toBe(200);
      const afterBody = after.body as { messageId: string; outputs: unknown; state: unknown; stateReset: boolean };

      // messageId는 매 요청 randomUUID()라 항상 다르다 — 그 외 필드는 바이트 단위로 동일해야 한다.
      expect(afterBody.outputs).toEqual(beforeBody.outputs);
      expect(afterBody.state).toEqual(beforeBody.state);
      expect(afterBody.stateReset).toBe(beforeBody.stateReset);
      expect(afterBody.messageId).not.toBe(beforeBody.messageId);
    }, 30_000);
  });

  describe('② VIEWER 403 게이팅(AC-L3-4, 백엔드 축)', () => {
    it('VIEWER는 증강 생성·승인·분류기 재학습 API를 호출할 수 없고(403) DB도 변하지 않는다', async () => {
      const { chatbotId } = await setupPublicChatbot();
      const intentId = await createIntent(chatbotId, 'VIEWER게이팅의도', ['예문 하나']);

      const jobCountBefore = await prisma.trainingJob.count({ where: { chatbotId } });
      const suggestionCountBefore = await prisma.augmentationSuggestion.count({ where: { chatbotId } });

      const generateRes = await viewer('POST', `/chatbots/${chatbotId}/intents/${intentId}/augmentations`, {});
      expect(generateRes.status).toBe(403);

      const acceptRes = await viewer('POST', `/chatbots/${chatbotId}/intents/${intentId}/augmentations/accept`, { suggestionIds: ['x'] });
      expect(acceptRes.status).toBe(403);

      const rejectRes = await viewer('POST', `/chatbots/${chatbotId}/intents/${intentId}/augmentations/reject`, { suggestionIds: ['x'] });
      expect(rejectRes.status).toBe(403);

      const trainRes = await viewer('POST', `/chatbots/${chatbotId}/intent-classifier/train`);
      expect(trainRes.status).toBe(403);

      const jobCountAfter = await prisma.trainingJob.count({ where: { chatbotId } });
      const suggestionCountAfter = await prisma.augmentationSuggestion.count({ where: { chatbotId } });
      expect(jobCountAfter).toBe(jobCountBefore);
      expect(suggestionCountAfter).toBe(suggestionCountBefore);

      // 대조군 — VIEWER도 조회(dialogue:read)는 허용된다(동일 권한 매트릭스의 반대쪽 확인).
      const listRes = await viewer('GET', `/chatbots/${chatbotId}/intents/${intentId}/augmentations`);
      expect(listRes.status).toBe(200);
      const statusRes = await viewer('GET', `/chatbots/${chatbotId}/intent-classifier/status`);
      expect(statusRes.status).toBe(200);
    });
  });

  describe('③ 미응답 요소분해 통합 반영(No.15 무회귀 포함, AC-L2-5/8)', () => {
    it('기존 POST .../resolve(No.15)는 그대로 동작하고, resolve-decomposed는 의도+키워드를 함께 반영한다', async () => {
      const { chatbotId } = await setupPublicChatbot();
      const intentId = await createIntent(chatbotId, '반품문의', ['반품 방법 안내']);

      const legacyRow = await prisma.unansweredQuestion.create({
        data: {
          chatbotId,
          questionText: '기존 방식 질문',
          questionNormalized: normalizeText('기존 방식 질문'),
          variants: JSON.stringify(['기존 방식 질문']),
        },
      });
      const legacyResolveRes = await admin('POST', `/chatbots/${chatbotId}/unanswered-questions/${legacyRow.id}/resolve`, {
        intentId,
      });
      expect(legacyResolveRes.status).toBe(200); // AC-L2-8 — 기존 경로 무회귀.

      const decomposedRow = await prisma.unansweredQuestion.create({
        data: {
          chatbotId,
          questionText: '해외로 반품 보낼 수 있나요',
          questionNormalized: normalizeText('해외로 반품 보낼 수 있나요'),
          variants: JSON.stringify(['해외로 반품 보낼 수 있나요']),
        },
      });

      const resolveDecomposedRes = await admin<{ appliedImmediately: boolean; keywordCount: number; created: boolean }>(
        'POST',
        `/chatbots/${chatbotId}/unanswered-questions/${decomposedRow.id}/resolve-decomposed`,
        { intentId, entities: [{ action: 'CREATE', name: '해외', synonym: '해외' }] },
      );
      expect(resolveDecomposedRes.status).toBe(200);
      expect(resolveDecomposedRes.body.appliedImmediately).toBe(true);
      expect(resolveDecomposedRes.body.keywordCount).toBe(1);

      const keyword = await prisma.keyword.findFirst({ where: { chatbotId, name: '해외' } });
      expect(keyword).not.toBeNull();
    });
  });
});

/**
 * 기동 시 고아 Job 정리(EX-L2-7, ADR-0027 §4) — 앞선 describe와 별도의 DB·앱 인스턴스를 써서
 * "이전 프로세스가 QUEUED 상태로 죽었다"를 재현한다(app1에서 직접 행을 만들고 종료 → app2를
 * 같은 DB에 새로 띄워 onModuleInit()이 실제로 정리하는지 확인).
 */
describe('학습 고도화 — 기동 시 고아 Job 정리(EX-L2-7)', () => {
  it('QUEUED 상태로 남은 TrainingJob은 다음 기동 시 FAILED(SERVER_RESTART)로 정리된다', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'chatbot-orphan-job-test-'));
    const dbPath = join(tmpDir, 'test.db').replace(/\\/g, '/');
    const testDatabaseUrl = `file:${dbPath}`;

    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.DEPLOY_SCHEDULE_ENABLED = 'false'; // [No.28] 실행 엔진 비활성 — 기존 그룹 통합 시험은 폴링 없이 수행(§7.10)
    process.env.WIDGET_BASE_URL = process.env.WIDGET_BASE_URL ?? 'http://localhost:5174';
    process.env.PUBLIC_API_BASE_URL = process.env.PUBLIC_API_BASE_URL ?? 'http://localhost:3000/api/v1';
    delete process.env.EMBEDDING_BASE_URL;

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

    let app1: NestExpressApplication | undefined;
    let app2: NestExpressApplication | undefined;
    try {
      const moduleRef1 = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app1 = moduleRef1.createNestApplication<NestExpressApplication>();
      await app1.init();
      const prisma1 = moduleRef1.get(PrismaService);

      const group = await prisma1.chatbotGroup.create({ data: { name: '고아잡 테스트 그룹' } });
      const chatbot = await prisma1.chatbot.create({
        data: { groupId: group.id, name: '고아잡 테스트봇', slug: `orphan-bot-${Math.random().toString(36).slice(2, 8)}` },
      });
      const job = await prisma1.trainingJob.create({ data: { chatbotId: chatbot.id, kind: 'CLASSIFIER_TRAIN', status: 'QUEUED' } });

      // "죽은 프로세스" 시뮬레이션 — 정상 종료 훅 없이(onModuleDestroy 스킵) 바로 리소스를 닫는다.
      await app1.close();

      const moduleRef2 = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app2 = moduleRef2.createNestApplication<NestExpressApplication>();
      await app2.init(); // onModuleInit() 전체가 여기서 실행된다 — TrainingJobService도 포함.
      const prisma2 = moduleRef2.get(PrismaService);

      const reloaded = await prisma2.trainingJob.findUniqueOrThrow({ where: { id: job.id } });
      expect(reloaded.status).toBe('FAILED');
      expect(reloaded.failureReason).toBe('SERVER_RESTART');
      expect(reloaded.finishedAt).not.toBeNull();
    } finally {
      await app2?.close();
      await app1?.close().catch(() => undefined);
      await safeCleanupTmpDir(tmpDir);
    }
  }, 30_000);
});
