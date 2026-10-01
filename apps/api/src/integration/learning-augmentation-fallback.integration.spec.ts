import * as http from 'node:http';
import type { AugmentationListResponse } from '@chat-bot/shared-types';
import { bootHarness } from './helpers/ai-guardrails.harness';
import type { Harness } from './helpers/ai-guardrails.harness';
import { waitFor } from './helpers/eventual.helper';

/**
 * K-1b — 증강 G1 폴백 통합 시험(pm-decisions-2026-10-01-설계 §2.12 · AC-K1b-1·4).
 * `AUGMENTATION_PROVIDER=local`이고 ml-worker 스텁이 503이면 Job이 G1(규칙 기반)로 대신 생성하고, 결과 요약에 폴백 표식이 실린다.
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

describe('증강 G1 폴백 통합 시험(K-1b)', () => {
  let h: Harness;
  let embedding: Awaited<ReturnType<typeof startServer>>;
  let mlWorker: Awaited<ReturnType<typeof startServer>>;

  beforeAll(async () => {
    embedding = await startServer((req, res) => {
      if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', modelId: 'fallback-test-model', dimension: DIM, warmedUp: true }));
        return;
      }
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        const texts = (JSON.parse(raw || '{}') as { texts?: string[] }).texts ?? [];
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ modelId: 'fallback-test-model', dimension: DIM, vectors: texts.map(embedText) }));
      });
    });
    mlWorker = await startServer((_req, res) => {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end('{}');
    });
    h = await bootHarness({
      tmpPrefix: 'learning-augmentation-fallback-',
      env: {
        EMBEDDING_BASE_URL: embedding.url,
        EMBEDDING_TIMEOUT_MS: '5000',
        EMBEDDING_BATCH_TIMEOUT_MS: '15000',
        AUGMENTATION_PROVIDER: 'local',
        AUGMENTATION_LOCAL_BASE_URL: mlWorker.url,
      },
    });
  }, 90_000);

  afterAll(async () => {
    await h?.close();
    await embedding?.close();
    await mlWorker?.close();
  }, 20_000);

  it('AC-K1b-1·4: ml-worker 503 → 규칙 기반 제안 · runResult.degraded=true · fallbackFrom=local · fallbackCause=HTTP_5XX · 승인 전 Intent.examples 불변', async () => {
    const bot = await h.createChatbot('증강폴백');
    const examples = ['환불 하고 싶어요', '주문을 환불 요청합니다', '환불 절차가 궁금합니다'];
    const created = await h.admin<{ intent: { id: string } }>('POST', `/chatbots/${bot.id}/intents`, { name: '환불 문의', examples });
    expect(created.status).toBe(201);
    const intentId = created.body.intent.id;

    // 의도 색인(시드 벡터)이 READY가 될 때까지 기다린 뒤 생성한다.
    await waitFor(async () => (await h.prisma.embeddingVector.count({ where: { chatbotId: bot.id, status: 'READY' } })) >= 1, { timeoutMs: 15_000, label: '색인 READY' });

    const gen = await h.admin<{ jobId: string }>('POST', `/chatbots/${bot.id}/intents/${intentId}/augmentations`, { count: 5 });
    expect(gen.status).toBe(202);

    const list = await waitFor(
      async () => {
        const res = await h.admin<AugmentationListResponse>('GET', `/chatbots/${bot.id}/intents/${intentId}/augmentations`);
        return res.body.runResult ? res.body : null;
      },
      { timeoutMs: 20_000, label: '증강 Job 완료' },
    );

    expect(list.runResult).toMatchObject({ providerId: 'rule', degraded: true, fallbackFrom: 'local', fallbackCause: 'HTTP_5XX' });
    expect(mlWorker.hits()).toBeGreaterThanOrEqual(1);

    // 폴백으로 저장된 제안은 모두 rule이고, 승인 전에는 자산이 바뀌지 않는다.
    const rows = await h.prisma.augmentationSuggestion.findMany({ where: { intentId } });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.providerId === 'rule')).toBe(true);
    const intent = await h.prisma.intent.findUnique({ where: { id: intentId }, select: { examples: true } });
    expect(JSON.parse(intent!.examples)).toEqual(examples);
  }, 60_000);
});
