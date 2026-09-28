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
import { textHashOf } from '../embedding/lib/text-hash';
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
    // ★ 간헐 실패의 확정된 직접 원인 — 배경 재색인의 upsert 배치(`IndexerService`가 31건을 `Promise.all`로 동시에 발행)가 Prisma
    // "Operations timed out"(SQLite 응답 없음)으로 실패해 그 행들이 FAILED로 남는다(재시도 없음). 그러면 이 시험은 재색인 완료를 영원히 기다리거나
    // 다음 재색인에 FAILED 행이 섞여 "기대 5, 실제 8"로 실패했다(단독 실행 약 5회 중 1회). `socket_timeout`을 60초로 늘려도 68초 동안 멈춘 채
    // 실패했으므로 느린 디스크보다는 **SQLite 다중 연결(Prisma 기본 풀 = CPU 수×2+1)의 락 경합**으로 추정한다(31건 upsert만의 단독 재현 실험은 실패 —
    // 시험의 폴링 읽기와 겹칠 때만 나타나는 것으로 보이며 확정하지 못했다). 시험 DB에만 `connection_limit=1`로 직렬화한다 — 30회 연속 통과(수정 전 21회 중 4회
    // 실패). 운영 코드는 그대로 둔다(자동시험_전략.md §20.5-b "운영 코드 결함 의심 사항").
    const testDatabaseUrl = `file:${dbPath}?connection_limit=1&socket_timeout=60`;

    embeddingServer = startMockEmbeddingServer(MODEL_ID, DIMENSION);
    const embeddingUrl = await embeddingServer.url;

    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.DEPLOY_SCHEDULE_ENABLED = 'false'; // [No.28] 실행 엔진 비활성 — 기존 그룹 통합 시험은 폴링 없이 수행(§7.10)
    process.env.WIDGET_BASE_URL = process.env.WIDGET_BASE_URL ?? 'http://localhost:5174';
    process.env.PUBLIC_API_BASE_URL = process.env.PUBLIC_API_BASE_URL ?? 'http://localhost:3000/api/v1';
    process.env.EMBEDDING_BASE_URL = embeddingUrl;
    process.env.EMBEDDING_TIMEOUT_MS = '5000';

    try {
      execSync('pnpm exec prisma migrate deploy', {
        cwd: API_ROOT,
        env: { ...process.env, DATABASE_URL: testDatabaseUrl },
        stdio: 'pipe',
      });
    } catch (e) {
      const err = e as { stdout?: Buffer; stderr?: Buffer };
      throw new Error(`prisma migrate deploy 실패:\n${err.stdout?.toString()}\n${err.stderr?.toString()}`);
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

  /**
   * [test-automation 2026-09-27 -- No.46 회귀 조사] 원래는 "30ms 고정 유예 후 isRunning()이 false가
   * 될 때까지 폴링"이었다 -- 전체 스위트 병렬 실행(CPU 경합)에서 schedule() 호출 자체가 30ms 안에
   * 아직 실행되지 않은 경우("시작 전")와 "이미 끝났음"을 구분하지 못해, patch2가 유발한 재색인이
   * 이 함수의 조기 반환 뒤 뒤늦게 실행되어 restore 측정 구간(reset() 이후)으로 새어 들어가는 것을
   * 재현·확인했다(AC-H3-7이 기대값 5 대신 10 = 2×5로 실패 -- patch2 몫 5 + restore 몫 5가 한 구간에
   * 합쳐짐). omnichannel-inbox-query-count.integration.spec.ts의 M-A 하드닝(연속 정적 샘플 요구)과
   * 같은 원칙을 적용한다 -- 고정 유예 없이 t=0부터 폴링하되, isRunning()===false를 연속 5회(100ms)
   * 관측해야 idle로 판정해 schedule() 호출 지연을 흡수한다(진짜 무한 대기는 여전히 timeoutMs 뒤
   * 실패로 드러난다 -- 불변식 자체는 여전히 정확한 값과의 등호로 검증한다).
   */
  async function waitForReindexIdle(chatbotId: string, timeoutMs = 15_000): Promise<void> {
    const start = Date.now();
    let stableStreak = 0;
    for (;;) {
      await new Promise((r) => setTimeout(r, 20));
      if (!reindexQueue.isRunning(chatbotId)) {
        stableStreak += 1;
        if (stableStreak >= 5) return;
      } else {
        stableStreak = 0;
      }
      if (Date.now() - start > timeoutMs) throw new Error('재색인 대기 타임아웃');
    }
  }

  /**
   * [test-automation 2026-09-27 -- No.46 회귀 조사, 2차 조치] `waitForReindexIdle`(isRunning() 연속
   * idle 샘플 방식)만으로는 부족했다 -- 전체 스위트 병렬 실행(특히 워커 수를 줄여 개별 파일의
   * 절대 실행 시간이 늘어난 조건)에서 schedule() 호출 자체가 관측 윈도(연속 5회 idle, 100ms)보다
   * 훨씬 크게 지연될 수 있어, 이전 단계가 유발한 재색인이 다음 reset() 이후 측정 구간으로 새어
   * 들어가 5의 배수(10 · 15)로 관측됐다. 인메모리 플래그를 도청하는 대신 이 시험이 실제로 확인
   *하고 싶은 것 -- "이 의도의 예문이 DB에 반영한 텍스트로 재색인을 마쳤다" -- 을 직접 DB에서
   * 확인한다(제품 코드의 실제 재색인 완료 신호 -- `embeddingVector.textHash`가 최신 텍스트와
   * 일치 + `status: READY`). 타이밍 가정이 전혀 없어 부하와 무관하게 결정적이다.
   */
  async function waitForIntentExamplesIndexed(chatbotId: string, intentId: string, examples: string[], timeoutMs = 20_000): Promise<void> {
    const expected = examples.map((e) => textHashOf(e));
    const start = Date.now();
    for (;;) {
      const rows = await prisma.embeddingVector.findMany({
        where: { chatbotId, ownerType: 'INTENT_EXAMPLE', ownerId: intentId, modelId: MODEL_ID },
        select: { slotIndex: true, textHash: true, status: true },
      });
      const bySlot = new Map(rows.map((r) => [r.slotIndex, r]));
      const ready = rows.length === expected.length && expected.every((h, i) => bySlot.get(i)?.status === 'READY' && bySlot.get(i)?.textHash === h);
      if (ready) return;
      // 시간 초과는 조용히 넘기지 않는다 — 조용히 반환하면 다음 `reset()` 뒤로 이 단계의 재색인이 새어 들어와 "기대 5, 실제 8"처럼
      // 원인과 무관한 숫자로 실패한다(전체 실행에서 1회 관찰, 원인 미확정). 여기서 원인이 드러나게 한다.
      if (Date.now() - start > timeoutMs) throw new Error(`재색인 완료 대기 시간 초과(${timeoutMs}ms): intentId=${intentId} — 예문 ${examples.length}건이 READY·최신 해시가 되지 않았다`);
      await new Promise((r) => setTimeout(r, 30));
    }
  }

  /**
   * 계측 구간(`embeddingServer.reset()`) 앞에서 호출한다 — 이 챗봇의 모든 색인 행(의도 이름 포함)이 `READY`이고 큐가 연속 idle임을 확인해,
   * 앞 단계(생성·수정)가 유발한 재색인이 측정 구간으로 새어 들어오지 않게 한다. `waitForIntentExamplesIndexed`는 한 의도의 **예문 행**만
   * 보므로, 이름 행이나 다른 의도의 뒤늦은 재실행은 못 잡는다(방어적 보강 — 자연 발생 실패의 원인은 확정하지 못했다).
   */
  async function waitForChatbotIndexSettled(chatbotId: string, timeoutMs = 30_000): Promise<void> {
    const start = Date.now();
    let idleStreak = 0;
    for (;;) {
      const notReady = await prisma.embeddingVector.count({ where: { chatbotId, modelId: MODEL_ID, status: { not: 'READY' } } });
      idleStreak = notReady === 0 && !reindexQueue.isRunning(chatbotId) ? idleStreak + 1 : 0;
      if (idleStreak >= 5) return;
      if (Date.now() - start > timeoutMs) throw new Error(`재색인 안정화 대기 시간 초과(${timeoutMs}ms): chatbotId=${chatbotId} notReady=${notReady}`);
      await new Promise((r) => setTimeout(r, 30));
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
    await waitForIntentExamplesIndexed(chatbotId, intentId, baseline);
    await waitForChatbotIndexSettled(chatbotId);
    embeddingServer.reset();

    // 예문 중 앞 5건만 텍스트를 바꾼다(같은 슬롯 수 유지 — ID 보존 시나리오의 "예문 배열 전체 교체"와 동일 모양).
    const edited = baseline.map((text, i) => (i < CHANGED_COUNT ? `${text}-수정본` : text));
    const patchRes = await editor('PATCH', `/chatbots/${chatbotId}/intents/${intentId}`, { examples: edited });
    expect(patchRes.status).toBe(200);
    await waitForIntentExamplesIndexed(chatbotId, intentId, edited);
    // 편집 직후 재색인은 바뀐 5건만 임베딩해야 한다(IndexerService의 textHash 재사용 규칙 자체의 사전 확인).
    expect(embeddingServer.totalTextsSinceReset()).toBe(CHANGED_COUNT);
    await waitForChatbotIndexSettled(chatbotId);

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
    await waitForIntentExamplesIndexed(chatbotId, intentId2, baseline.map((t) => `2차-${t}`));

    const saved = await editor<{ version: { id: string } }>('POST', `/chatbots/${chatbotId}/versions`, { label: '기준(원본 예문)' });
    expect(saved.status).toBe(201);
    const baseVersionId = saved.body.version.id;
    const baseHash = (await editor<{ contentHash: string }>('GET', `/chatbots/${chatbotId}/versions/current`)).body.contentHash;

    const editedAgain = baseline.map((t, i) => (i < CHANGED_COUNT ? `2차-${t}-재수정` : `2차-${t}`));
    const patch2 = await editor('PATCH', `/chatbots/${chatbotId}/intents/${intentId2}`, { examples: editedAgain });
    expect(patch2.status).toBe(200);
    await waitForIntentExamplesIndexed(chatbotId, intentId2, editedAgain);

    const currentHash = (await editor<{ contentHash: string }>('GET', `/chatbots/${chatbotId}/versions/current`)).body.contentHash;
    expect(currentHash).not.toBe(baseHash);

    // 측정 구간 시작 — 이제부터의 임베딩 호출만 복원이 유발한 것이다.
    await waitForChatbotIndexSettled(chatbotId);
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

    await waitForIntentExamplesIndexed(chatbotId, intentId2, baseline.map((t) => `2차-${t}`));
    await waitForReindexIdle(chatbotId); // 위 DB 확인 뒤에도 남을 수 있는 완전히 무관한 백그라운드 재실행(있다면)을 위한 보조 대기 -- 기존 방식을 안전망으로 유지.

    // 핵심 단언(AC-H3-7/NFR-HP6) — intentId2의 5개 예문만 원래 텍스트로 되돌아갔으므로 재색인
    // 임베딩 호출 대상 문장 수는 정확히 5건이다. intentId(변경하지 않고 둔 첫 번째 의도)의 31개
    // 문장·intentId2의 나머지 25개 예문·이름 2건은 textHash가 저장된 값과 동일해 재임베딩되지 않는다.
    expect(embeddingServer.totalTextsSinceReset()).toBe(CHANGED_COUNT);
    expect(embeddingServer.totalTextsSinceReset()).toBeLessThan(TOTAL_EXAMPLES); // 전체 재임베딩이 아님을 함께 못박는다(NFR-HP6)
  }, 120_000); // 느린 디스크에서 재색인 1회가 10초 넘게 걸리는 것이 관찰됐다(자동시험_전략.md §20.5) — 대기 상한(20~30초)보다 여유 있게.
});
