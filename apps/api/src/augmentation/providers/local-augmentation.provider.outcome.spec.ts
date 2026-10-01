import * as http from 'node:http';
import { LocalAugmentationProvider } from './local-augmentation.provider';
import { installGovernanceRuntime, resetGovernanceRuntimeForTest } from '../../common/governance/governance-runtime';

/**
 * K-1b — `generateWithOutcome()` 원인 분류(§2.3). 실제 `http` 서버로 응답을 재현한다(리다이렉트 시험과 같은 방식).
 * `generate()`는 모든 경우 `candidates`와 같아야 한다(C-1 계약 불변).
 */
describe('LocalAugmentationProvider.generateWithOutcome — 실패 원인(K-1b)', () => {
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

  async function check(handler: Handler, expected: string | undefined, timeoutMs?: number) {
    const s = await start(handler);
    try {
      const p = new LocalAugmentationProvider({ baseUrl: s.url, timeoutMs });
      const outcome = await p.generateWithOutcome(input);
      expect(outcome.failure).toBe(expected);
      expect(await p.generate(input)).toEqual(outcome.candidates);
      return outcome;
    } finally {
      await s.close();
    }
  }

  it('400 → HTTP_4XX', async () => {
    expect((await check(reply(400, '{}'), 'HTTP_4XX')).candidates).toEqual([]);
  });
  it('503 → HTTP_5XX', async () => {
    await check(reply(503, '{}'), 'HTTP_5XX');
  });
  it('스키마 불일치 → INVALID_RESPONSE', async () => {
    await check(reply(200, '{"foo":1}'), 'INVALID_RESPONSE');
  });
  it('비 JSON → INVALID_RESPONSE', async () => {
    await check(reply(200, 'not json'), 'INVALID_RESPONSE');
  });
  it('지연 응답(타임아웃 100ms) → TIMEOUT', async () => {
    await check(() => undefined, 'TIMEOUT', 100);
  });
  it('닫힌 포트 → NETWORK', async () => {
    const s = await start(reply(200, '{}'));
    const url = s.url;
    await s.close();
    const outcome = await new LocalAugmentationProvider({ baseUrl: url }).generateWithOutcome(input);
    expect(outcome).toEqual({ candidates: [], failure: 'NETWORK' });
  });
  it('모드 ON 허용 목록 밖 → EGRESS_BLOCKED', async () => {
    const s = await start(reply(200, '{"modelId":"m","candidates":["a"]}'));
    try {
      installGovernanceRuntime({ mode: 'ON', egress: { allowlist: ['other.example.com'], enforce: true }, encryptionEnabled: false });
      const outcome = await new LocalAugmentationProvider({ baseUrl: s.url }).generateWithOutcome(input);
      expect(outcome).toEqual({ candidates: [], failure: 'EGRESS_BLOCKED' });
    } finally {
      await s.close();
    }
  });
  it('정상 → failure 없음', async () => {
    const outcome = await check(reply(200, '{"modelId":"m","candidates":["보기 문장"]}'), undefined);
    expect(outcome).toEqual({ candidates: ['보기 문장'] });
    expect('failure' in outcome).toBe(false);
  });
});
