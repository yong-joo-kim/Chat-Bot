import * as http from 'node:http';
import { GeminiAugmentationProvider } from './gemini-augmentation.provider';
import { installGovernanceRuntime, resetGovernanceRuntimeForTest } from '../../common/governance/governance-runtime';

/** K-1b — Gemini `generateWithOutcome()` 원인 분류(§2.3). `generate()`는 항상 `candidates`와 같다. */
describe('GeminiAugmentationProvider.generateWithOutcome — 실패 원인(K-1b)', () => {
  afterEach(() => resetGovernanceRuntimeForTest());

  type Handler = (req: http.IncomingMessage, res: http.ServerResponse) => void;
  function start(handler: Handler): Promise<{ url: string; close: () => Promise<void> }> {
    return new Promise((resolve) => {
      const server = http.createServer(handler);
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        const port = typeof addr === 'object' && addr ? addr.port : 0;
        resolve({
          url: `http://127.0.0.1:${port}`,
          close: () =>
            new Promise((r) => {
              server.closeAllConnections?.();
              server.close(() => r());
            }),
        });
      });
    });
  }
  const input = { seeds: ['시드 문장'], targetCount: 3, locale: 'ko' as const };
  const reply =
    (status: number, body: string): Handler =>
    (_req, res) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(body);
    };
  const okBody = JSON.stringify({ candidates: [{ content: { parts: [{ text: '["보기 문장"]' }] } }] });

  async function check(handler: Handler, expected: string | undefined, extra: { timeoutMs?: number } = {}) {
    const s = await start(handler);
    try {
      const p = new GeminiAugmentationProvider({ apiKey: 'k', baseUrl: s.url, ...extra });
      const outcome = await p.generateWithOutcome(input);
      expect(outcome.failure).toBe(expected);
      return outcome;
    } finally {
      await s.close();
    }
  }

  it('400 → HTTP_4XX · generate()와 같다', async () => {
    const s = await start(reply(400, '{}'));
    try {
      const p = new GeminiAugmentationProvider({ apiKey: 'k', baseUrl: s.url });
      expect(await p.generateWithOutcome(input)).toEqual({ candidates: [], failure: 'HTTP_4XX' });
      expect(await p.generate(input)).toEqual([]);
    } finally {
      await s.close();
    }
  });
  it('500 → HTTP_5XX', async () => {
    await check(reply(500, '{}'), 'HTTP_5XX');
  });
  it('스키마 불일치 → INVALID_RESPONSE', async () => {
    await check(reply(200, '{"candidates":"x"}'), 'INVALID_RESPONSE');
  });
  it('비 JSON → INVALID_RESPONSE', async () => {
    await check(reply(200, 'oops'), 'INVALID_RESPONSE');
  });
  it('지연 응답 → TIMEOUT', async () => {
    await check(() => undefined, 'TIMEOUT', { timeoutMs: 100 });
  });
  it('닫힌 포트 → NETWORK', async () => {
    const s = await start(reply(200, okBody));
    const url = s.url;
    await s.close();
    const outcome = await new GeminiAugmentationProvider({ apiKey: 'k', baseUrl: url }).generateWithOutcome(input);
    expect(outcome).toEqual({ candidates: [], failure: 'NETWORK' });
  });
  it('모드 ON 허용 목록 밖 → EGRESS_BLOCKED', async () => {
    const s = await start(reply(200, okBody));
    try {
      installGovernanceRuntime({ mode: 'ON', egress: { allowlist: ['other.example.com'], enforce: true }, encryptionEnabled: false });
      const outcome = await new GeminiAugmentationProvider({ apiKey: 'k', baseUrl: s.url }).generateWithOutcome(input);
      expect(outcome.failure).toBe('EGRESS_BLOCKED');
    } finally {
      await s.close();
    }
  });
  it('정상 → failure 없음', async () => {
    const outcome = await check(reply(200, okBody), undefined);
    expect(outcome).toEqual({ candidates: ['보기 문장'] });
  });
  it('회로 open(임계 1) → 두 번째 호출은 CIRCUIT_OPEN', async () => {
    const s = await start(reply(500, '{}'));
    try {
      const p = new GeminiAugmentationProvider({ apiKey: 'k', baseUrl: s.url, circuitFailureThreshold: 1, circuitOpenMs: 60_000 });
      expect((await p.generateWithOutcome(input)).failure).toBe('HTTP_5XX');
      expect(await p.generateWithOutcome(input)).toEqual({ candidates: [], failure: 'CIRCUIT_OPEN' });
    } finally {
      await s.close();
    }
  });
  it('시드 금지어 → SEED_BLOCKED (외부 호출 0)', async () => {
    let hits = 0;
    const s = await start((_q, r) => {
      hits += 1;
      r.writeHead(200);
      r.end(okBody);
    });
    try {
      const p = new GeminiAugmentationProvider({ apiKey: 'k', baseUrl: s.url, bannedWords: ['시드'] });
      expect(await p.generateWithOutcome(input)).toEqual({ candidates: [], failure: 'SEED_BLOCKED' });
      expect(hits).toBe(0);
    } finally {
      await s.close();
    }
  });
  it('키 없음 → NOT_CONFIGURED', async () => {
    expect(await new GeminiAugmentationProvider({ apiKey: '' }).generateWithOutcome(input)).toEqual({ candidates: [], failure: 'NOT_CONFIGURED' });
  });
});
