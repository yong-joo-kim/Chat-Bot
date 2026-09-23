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
import { ReindexQueueService } from '../embedding/index/reindex-queue.service';
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
 * `GET /health` · `POST /embed`에 응답하는 mock 임베딩 서버 — `learning-augmentation.integration.spec.ts`의
 * 패턴을 재사용하되, 이 그룹은 **요청된 텍스트 수를 누적 계측**하는 레코더를 추가로 둔다(AC-H3-7).
 */
function startMockEmbeddingServer(modelId: string, dimension: number): {
  url: Promise<string>;
  close: () => Promise<void>;
  totalTextsSinceReset: () => number;
  reset: () => void;
} {
  let textCount = 0;
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
        textCount += texts.length;
        const vectors = texts.map(() => Array.from({ length: dimension }, () => 0));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ modelId, dimension, vectors }));
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });

  const url = new Promise<string>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      resolve(`http://127.0.0.1:${port}`);
    });
  });

  return {
    url,
    close: () => new Promise((r) => server.close(() => r())),
    totalTextsSinceReset: () => textCount,
    reset: () => {
      textCount = 0;
    },
  };
}

/**
 * 챗봇 복원/버전 이력관리(No.25) — AC-H3-7(증분 재색인) 전용 통합 시험(2026-09-23 신규).
 * `version-history-설계.md` §17이 지정한 필수 5종 중 "★ AC-H3-7"을 담당한다: 복원 후 재색인이
 * ID 보존 + textHash 재사용 덕분에 **바뀐 문장만** 임베딩하는지를 `EmbeddingProviderFactory`가
 * 최종적으로 호출하는 mock 임베딩 서버의 수신 텍스트 수로 직접 계측한다.
 *
 * 이 파일은 `version-history.integration.spec.ts`(공유 앱, `EMBEDDING_BASE_URL` 미설정)와 별도의
 * 전용 NestJS 앱 인스턴스를 띄운다 — 임베딩이 필요한 유일한 No.25 시나리오이기 때문이다.
 */
describe('챗봇 복원/버전 이력관리(No.25) — AC-H3-7 증분 재색인 통합 시험', () => {
  let app: NestExpressApplication;
  let baseUrl: string;
  let tmpDir: string;
  let prisma: PrismaService;
  let reindexQueue: ReindexQueueService;
  let editorCookie = '';
  let embeddingServer: ReturnType<typeof startMockEmbeddingServer>;

  const MODEL_ID = 'itest-version-reindex-v1';
  const DIMENSION = 4;
  const TOTAL_EXAMPLES = 30;
  const CHANGED_COUNT = 5;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'chatbot-version-reindex-test-'));
    const dbPath = join(tmpDir, 'test.db').replace(/\\/g, '/');
    const testDatabaseUrl = `file:${dbPath}`;

    embeddingServer = startMockEmbeddingServer(MODEL_ID, DIMENSION);
    const embeddingUrl = await embeddingServer.url;

    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.WIDGET_BASE_URL = process.env.WIDGET_BASE_URL ?? 'http://localhost:5174';
    process.env.PUBLIC_API_BASE_URL = process.env.PUBLIC_API_BASE_URL ?? 'http://localhost:3000/api/v1';
    process.env.EMBEDDING_BASE_URL = embeddingUrl;
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

    // env 오버라이드 이후 동적 import — `version-history.integration.spec.ts` 상단 주석과 동일한 이유.
    const { AppModule } = await import('../app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    app.enableCors();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalFilters(new AllExceptionsFilter());
    prisma = moduleRef.get(PrismaService);
    reindexQueue = moduleRef.get(ReindexQueueService, { strict: false });

    await app.listen(0);
    const server = app.getHttpServer() as http.Server;
    const address = server.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;
    baseUrl = `http://127.0.0.1:${port}/api/v1`;

    await seedTestUsers(prisma);
    editorCookie = await loginAs(baseUrl, 'EDITOR');
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await embeddingServer.close();
    delete process.env.EMBEDDING_BASE_URL;
    await safeCleanupTmpDir(tmpDir);
  }, 15_000);

  function editor<T = unknown>(method: string, path: string, body?: unknown): Promise<ApiResponse<T>> {
    return jsonRequest(method, `${baseUrl}${path}`, body, { Cookie: editorCookie });
  }

  async function waitForReindexIdle(chatbotId: string, timeoutMs = 15_000): Promise<void> {
    // schedule()은 동기로 running Set에 등록되지만, HTTP 응답이 먼저 돌아올 수 있어 짧은 유예를 둔다.
    await new Promise((r) => setTimeout(r, 30));
    const start = Date.now();
    while (reindexQueue.isRunning(chatbotId)) {
      if (Date.now() - start > timeoutMs) throw new Error('재색인 대기 타임아웃');
      await new Promise((r) => setTimeout(r, 20));
    }
  }

  async function createChatbot(namePrefix: string): Promise<{ id: string }> {
    const groupRes = await editor<{ id: string }>('POST', '/chatbot-groups', { name: `${namePrefix} 그룹` });
    const suffix = Math.random().toString(36).slice(2, 10);
    const res = await editor<{ id: string }>('POST', '/chatbots', { groupId: groupRes.body.id, name: `${namePrefix}-${suffix}`, slug: `vhr-${suffix}` });
    return { id: res.body.id };
  }

  it('AC-H3-7: 30건 중 5건만 다른 버전으로 복원하면 재색인 임베딩 호출 대상 문장 수가 5건이다(전체 재임베딩 아님)', async () => {
    const { id: chatbotId } = await createChatbot('증분재색인');

    const baseline = Array.from({ length: TOTAL_EXAMPLES }, (_, i) => `기준예문-${i}`);
    const createRes = await editor<{ intent: { id: string } }>('POST', `/chatbots/${chatbotId}/intents`, { name: '증분재색인의도', examples: baseline });
    expect(createRes.status).toBe(201);
    const intentId = createRes.body.intent.id;

    // 초기 색인(이름 1 + 예문 30 = 31건)이 끝날 때까지 대기 — 측정 대상이 아니므로 카운터를 리셋한다.
    await waitForReindexIdle(chatbotId);
    embeddingServer.reset();

    // 예문 중 앞 5건만 텍스트를 바꾼다(같은 슬롯 수 유지 — ID 보존 시나리오의 "예문 배열 전체 교체"와 동일 모양).
    const edited = baseline.map((text, i) => (i < CHANGED_COUNT ? `${text}-수정본` : text));
    const patchRes = await editor('PATCH', `/chatbots/${chatbotId}/intents/${intentId}`, { examples: edited });
    expect(patchRes.status).toBe(200);
    await waitForReindexIdle(chatbotId);
    // 편집 직후 재색인은 바뀐 5건만 임베딩해야 한다(IndexerService의 textHash 재사용 규칙 자체의 사전 확인).
    expect(embeddingServer.totalTextsSinceReset()).toBe(CHANGED_COUNT);

    // 이 상태(수정본)를 "현재"로 두고, 예문이 원본이었던 시점의 버전을 수동으로 재현한다 —
    // 수정 전(baseline)으로 복원하면 5건이 다시 바뀌므로 재색인 대상은 정확히 5건이어야 한다.
    // 버전은 "수정 전" 시점에 저장해 둔 게 없으므로, 먼저 원본으로 되돌려 저장한 뒤 다시 수정하는
    // 대신 — DB에 원본 상태의 스냅샷을 직접 만든다(캡처 API로 그 시점을 저장할 기회가 없었으므로).
    // 더 간단하고 실전과 동일한 방법: 원본 → 버전 저장 → 수정 → 복원 순서로 다시 구성한다.
    embeddingServer.reset();

    const secondCreate = await editor<{ intent: { id: string } }>('POST', `/chatbots/${chatbotId}/intents`, {
      name: '증분재색인의도2',
      examples: baseline.map((t) => `2차-${t}`),
    });
    expect(secondCreate.status).toBe(201);
    const intentId2 = secondCreate.body.intent.id;
    await waitForReindexIdle(chatbotId);

    const saved = await editor<{ version: { id: string } }>('POST', `/chatbots/${chatbotId}/versions`, { label: '기준(원본 예문)' });
    expect(saved.status).toBe(201);
    const baseVersionId = saved.body.version.id;
    const baseHash = (await editor<{ contentHash: string }>('GET', `/chatbots/${chatbotId}/versions/current`)).body.contentHash;

    const editedAgain = baseline.map((t, i) => (i < CHANGED_COUNT ? `2차-${t}-재수정` : `2차-${t}`));
    const patch2 = await editor('PATCH', `/chatbots/${chatbotId}/intents/${intentId2}`, { examples: editedAgain });
    expect(patch2.status).toBe(200);
    await waitForReindexIdle(chatbotId);

    const currentHash = (await editor<{ contentHash: string }>('GET', `/chatbots/${chatbotId}/versions/current`)).body.contentHash;
    expect(currentHash).not.toBe(baseHash);

    // 측정 구간 시작 — 이제부터의 임베딩 호출만 복원이 유발한 것이다.
    embeddingServer.reset();

    const preview = await editor<{ currentContentHash: string; restorable: boolean }>(
      'POST',
      `/chatbots/${chatbotId}/versions/${baseVersionId}/restore/preview`,
    );
    expect(preview.body.restorable).toBe(true);

    const restore = await editor<{ contentHash: string; reindexScheduled: boolean }>('POST', `/chatbots/${chatbotId}/versions/${baseVersionId}/restore`, {
      expectedCurrentHash: preview.body.currentContentHash,
    });
    expect(restore.status).toBe(200);
    expect(restore.body.contentHash).toBe(baseHash);
    expect(restore.body.reindexScheduled).toBe(true);

    await waitForReindexIdle(chatbotId);

    // 핵심 단언(AC-H3-7/NFR-HP6) — intentId2의 5개 예문만 원래 텍스트로 되돌아갔으므로 재색인
    // 임베딩 호출 대상 문장 수는 정확히 5건이다. intentId(변경하지 않고 둔 첫 번째 의도)의 31개
    // 문장·intentId2의 나머지 25개 예문·이름 2건은 textHash가 저장된 값과 동일해 재임베딩되지 않는다.
    expect(embeddingServer.totalTextsSinceReset()).toBe(CHANGED_COUNT);
    expect(embeddingServer.totalTextsSinceReset()).toBeLessThan(TOTAL_EXAMPLES); // 전체 재임베딩이 아님을 함께 못박는다(NFR-HP6)
  }, 60_000);
});
