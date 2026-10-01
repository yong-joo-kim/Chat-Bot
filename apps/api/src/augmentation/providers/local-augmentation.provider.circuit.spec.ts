import * as http from 'node:http';
import { LocalAugmentationProvider } from './local-augmentation.provider';
import { AugmentationCircuit } from './lib/augmentation-circuit';
import { resetGovernanceRuntimeForTest } from '../../common/governance/governance-runtime';

/** K-1c — 공유 회로가 주입된 local Provider: 개방 중 네트워크 0 · 인프라 실패만 계수. */
describe('LocalAugmentationProvider 회로(K-1c)', () => {
  afterEach(() => resetGovernanceRuntimeForTest());

  let hits = 0;
  let status = 503;
  let server: http.Server;
  let baseUrl: string;
  const okBody = JSON.stringify({ modelId: 'm', candidates: ['보기 문장'] });
  const input = { seeds: ['시드 문장'], targetCount: 3, locale: 'ko' as const };

  beforeEach(async () => {
    hits = 0;
    status = 503;
    server = http.createServer((_req, res) => {
      hits += 1;
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(status === 200 ? okBody : '{}');
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const addr = server.address();
    baseUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  });
  afterEach(async () => {
    server.closeAllConnections?.();
    await new Promise<void>((r) => server.close(() => r()));
  });

  const circuit = (threshold = 2): AugmentationCircuit => new AugmentationCircuit({ threshold, openMs: 60_000 });
  // Job마다 새 Provider 인스턴스를 만들되 회로는 공유한다(팩토리 동작과 같다).
  const fresh = (c: AugmentationCircuit): LocalAugmentationProvider => new LocalAugmentationProvider({ baseUrl, circuit: c });

  it('5xx 임계 후 개방 → 다음 호출은 네트워크 호출 없이 CIRCUIT_OPEN', async () => {
    const c = circuit(2);
    expect((await fresh(c).generateWithOutcome(input)).failure).toBe('HTTP_5XX');
    expect((await fresh(c).generateWithOutcome(input)).failure).toBe('HTTP_5XX');
    expect(hits).toBe(2);
    expect(await fresh(c).generateWithOutcome(input)).toEqual({ candidates: [], failure: 'CIRCUIT_OPEN' });
    expect(hits).toBe(2);
  });

  it('429는 인프라 실패로 계수한다', async () => {
    status = 429;
    const c = circuit(2);
    await fresh(c).generateWithOutcome(input);
    await fresh(c).generateWithOutcome(input);
    expect(c.isOpen()).toBe(true);
  });

  it('400·형식 오류는 몇 번이어도 개방하지 않는다', async () => {
    const c = circuit(2);
    status = 400;
    for (let i = 0; i < 5; i += 1) expect((await fresh(c).generateWithOutcome(input)).failure).toBe('HTTP_4XX');
    status = 200;
    server.removeAllListeners('request');
    server.on('request', (_req, res) => {
      hits += 1;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"unexpected":true}');
    });
    for (let i = 0; i < 5; i += 1) expect((await fresh(c).generateWithOutcome(input)).failure).toBe('INVALID_RESPONSE');
    expect(c.isOpen()).toBe(false);
  });

  it('성공은 연속 실패를 0으로 되돌린다', async () => {
    const c = circuit(2);
    await fresh(c).generateWithOutcome(input); // 실패 1
    status = 200;
    expect((await fresh(c).generateWithOutcome(input)).candidates).toEqual(['보기 문장']);
    status = 503;
    await fresh(c).generateWithOutcome(input); // 다시 1
    expect(c.isOpen()).toBe(false);
  });

  it('네트워크 거부(NETWORK)는 계수한다', async () => {
    const c = circuit(2);
    const dead = new LocalAugmentationProvider({ baseUrl: 'http://127.0.0.1:1', circuit: c, timeoutMs: 2000 });
    await dead.generateWithOutcome(input);
    await dead.generateWithOutcome(input);
    expect(c.isOpen()).toBe(true);
  });

  it('회로를 주입하지 않으면 현행과 같다(몇 번이든 호출한다)', async () => {
    const p = new LocalAugmentationProvider({ baseUrl });
    for (let i = 0; i < 6; i += 1) expect((await p.generateWithOutcome(input)).failure).toBe('HTTP_5XX');
    expect(hits).toBe(6);
  });

  it('healthy()는 회로와 무관하게 실제 헬스 확인 결과를 쓴다', async () => {
    const c = circuit(1);
    await fresh(c).generateWithOutcome(input);
    expect(c.isOpen()).toBe(true);
    status = 200;
    server.removeAllListeners('request');
    server.on('request', (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"status":"ok"}');
    });
    expect(await fresh(c).healthy()).toBe(true);
  });
});
