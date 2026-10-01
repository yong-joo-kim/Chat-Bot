import * as http from 'node:http';
import type { AugmentationListResponse } from '@chat-bot/shared-types';
import { bootHarness } from './helpers/ai-guardrails.harness';
import type { Harness } from './helpers/ai-guardrails.harness';
import { waitFor } from './helpers/eventual.helper';

/**
 * K-1c — 증강 회로차단 통합 시험(followup-defects-2026-10-01-설계 §5.7 · AC-K1c-1).
 * `AUGMENTATION_PROVIDER=local` · 임계 2 · ml-worker 스텁이 계속 503: Job 1·2는 스텁을 호출해 `HTTP_5XX`로 G1 폴백하고, Job 3은 회로가 열려
 * 스텁 호출 없이 `CIRCUIT_OPEN`으로 G1 폴백한다. 개방 시간은 기본 60초라 시험 시간보다 훨씬 길다 — half-open·재개방은 가짜 시계 단위 시험에서만 본다(T-3 교훈).
 * 환경 스냅샷은 AppModule 첫 import 시점에 고정되므로 값을 먼저 설정한 뒤 `bootHarness`(동적 import)로 기동한다(CLAUDE.md 규약).
 */
const DIM = 16;

/** 글자 코드 히스토그램 임베딩 — 같은 글자가 많은 문장일수록 가깝다(결정론). */
function embedText(text: string): number[] {
  const v = new Array<number>(DIM).fill(0);
  for (const ch of text) v[ch.charCodeAt(0) % DIM] += 1;
  const norm = Math.sqrt(v.reduce((a, b) => a + b * b, 0)) || 1;
  return v.map((x) => x / norm);
}

function startServer(handler: http.RequestListener): Promise<{ url: string; close: () => Promise<void>; hits: () => number }> {
  return new Promise((resolve) => {
    let hits = 0;
    const server = http.createServer((req, res) => {
      hits += 1;
      handler(req, res);
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}`,
        hits: () => hits,
        close: () =>
          new Promise((r) => {
            server.closeAllConnections?.();
            server.close(() => r());
          }),
      });
    });
  });
}

describe('증강 회로차단 통합 시험(K-1c)', () => {
  let augmentPosts = 0;
  let h: Harness;
  let embedding: Awaited<ReturnType<typeof startServer>>;
  let mlWorker: Awaited<ReturnType<typeof startServer>>;

  beforeAll(async () => {
    embedding = await startServer((req, res) => {
      if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', modelId: 'circuit-test-model', dimension: DIM, warmedUp: true }));
        return;
      }
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        const texts = (JSON.parse(raw || '{}') as { texts?: string[] }).texts ?? [];
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ modelId: 'circuit-test-model', dimension: DIM, vectors: texts.map(embedText) }));
      });
    });
    // 호출 횟수는 POST /augment만 센다(목록 조회의 capability 헬스 확인 GET /augment/health는 제외).
    mlWorker = await startServer((req, res) => {
      if (req.method === 'POST' && req.url === '/augment') augmentPosts += 1;
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end('{}');
    });
    h = await bootHarness({
      tmpPrefix: 'learning-augmentation-circuit-',
      env: {
        EMBEDDING_BASE_URL: embedding.url,
        EMBEDDING_TIMEOUT_MS: '5000',
        EMBEDDING_BATCH_TIMEOUT_MS: '15000',
        AUGMENTATION_PROVIDER: 'local',
        AUGMENTATION_LOCAL_BASE_URL: mlWorker.url,
        AUGMENTATION_CIRCUIT_FAILURE_THRESHOLD: '2',
        // AUGMENTATION_CIRCUIT_OPEN_MS는 기본 60000 — 시험 시간(수 초)보다 훨씬 길다.
      },
    });
  }, 90_000);

  afterAll(async () => {
    await h?.close();
    await embedding?.close();
    await mlWorker?.close();
  }, 20_000);

  it('AC-K1c-1: 임계 2 · Job 3개 순차 → 스텁 호출 2회 · HTTP_5XX ×2 후 CIRCUIT_OPEN(스텁 호출 증가 0) · G1 제안 PENDING', async () => {
    const bot = await h.createChatbot('증강회로');
    const examples = ['환불 하고 싶어요', '주문을 환불 요청합니다', '환불 절차가 궁금합니다'];
    const intentIds: string[] = [];
    for (const name of ['환불 문의A', '환불 문의B', '환불 문의C']) {
      const created = await h.admin<{ intent: { id: string } }>('POST', `/chatbots/${bot.id}/intents`, { name, examples });
      expect(created.status).toBe(201);
      intentIds.push(created.body.intent.id);
    }
    for (const id of intentIds) {
      await waitFor(async () => (await h.prisma.embeddingVector.count({ where: { chatbotId: bot.id, ownerId: id, status: 'READY' } })) >= 1, { timeoutMs: 15_000, label: '색인 READY' });
    }

    const runJob = async (intentId: string): Promise<AugmentationListResponse> => {
      const gen = await h.admin<{ jobId: string }>('POST', `/chatbots/${bot.id}/intents/${intentId}/augmentations`, { count: 5 });
      expect(gen.status).toBe(202);
      return waitFor(
        async () => {
          const res = await h.admin<AugmentationListResponse>('GET', `/chatbots/${bot.id}/intents/${intentId}/augmentations`);
          return res.body.runResult ? res.body : null;
        },
        { timeoutMs: 20_000, label: '증강 Job 완료' },
      );
    };

    const j1 = await runJob(intentIds[0]);
    const j2 = await runJob(intentIds[1]);
    expect(j1.runResult).toMatchObject({ providerId: 'rule', degraded: true, fallbackFrom: 'local', fallbackCause: 'HTTP_5XX' });
    expect(j2.runResult).toMatchObject({ providerId: 'rule', degraded: true, fallbackFrom: 'local', fallbackCause: 'HTTP_5XX' });
    expect(augmentPosts).toBe(2);

    const j3 = await runJob(intentIds[2]);
    expect(j3.runResult).toMatchObject({ providerId: 'rule', degraded: true, fallbackFrom: 'local', fallbackCause: 'CIRCUIT_OPEN' });
    // Job 3은 스텁을 호출하지 않았다(회로 개방 중 네트워크 0).
    expect(augmentPosts).toBe(2);

    const rows = await h.prisma.augmentationSuggestion.findMany({ where: { intentId: intentIds[2] } });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.providerId === 'rule' && r.status === 'PENDING')).toBe(true);
  }, 90_000);
});
