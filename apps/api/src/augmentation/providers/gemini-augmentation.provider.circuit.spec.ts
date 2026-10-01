import * as http from 'node:http';
import { GeminiAugmentationProvider } from './gemini-augmentation.provider';
import { AugmentationCircuit } from './lib/augmentation-circuit';
import { resetGovernanceRuntimeForTest } from '../../common/governance/governance-runtime';

/** K-1c — 공유 회로가 주입된 Gemini Provider: 확인 순서(시드 금지어 → 회로) · 계수 분류 · healthy() 읽기 전용. */
describe('GeminiAugmentationProvider 회로(K-1c)', () => {
  afterEach(() => resetGovernanceRuntimeForTest());

  let hits = 0;
  let status = 500;
  let server: http.Server;
  let baseUrl: string;
  const okBody = JSON.stringify({ candidates: [{ content: { parts: [{ text: '["보기 문장"]' }] } }] });
  const input = { seeds: ['시드 문장'], targetCount: 3, locale: 'ko' as const };

  beforeEach(async () => {
    hits = 0;
    status = 500;
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

  const clock = { t: 10_000 };
  const circuit = (threshold = 2): AugmentationCircuit => new AugmentationCircuit({ threshold, openMs: 60_000, now: () => clock.t });
  const fresh = (c: AugmentationCircuit, bannedWords?: string[]): GeminiAugmentationProvider =>
    new GeminiAugmentationProvider({ apiKey: 'k', baseUrl, circuit: c, bannedWords });

  it('새 Provider 인스턴스를 Job마다 만들어도 개방 상태가 이어진다(미발동 결함 재현 → 수정)', async () => {
    const c = circuit(2);
    expect((await fresh(c).generateWithOutcome(input)).failure).toBe('HTTP_5XX');
    expect((await fresh(c).generateWithOutcome(input)).failure).toBe('HTTP_5XX');
    expect(await fresh(c).generateWithOutcome(input)).toEqual({ candidates: [], failure: 'CIRCUIT_OPEN' });
    expect(hits).toBe(2);
  });

  it('시드 금지어는 회로 확인보다 먼저다 — 개방 중에도 SEED_BLOCKED이고 탐침을 소모하지 않는다(AC-K1c-5)', async () => {
    const c = circuit(1);
    await fresh(c).generateWithOutcome(input); // 개방
    expect(await fresh(c, ['시드']).generateWithOutcome(input)).toEqual({ candidates: [], failure: 'SEED_BLOCKED' });
    clock.t += 60_000; // half-open
    expect(await fresh(c, ['시드']).generateWithOutcome(input)).toEqual({ candidates: [], failure: 'SEED_BLOCKED' });
    expect(hits).toBe(1);
    status = 200;
    // 시드 차단이 탐침을 소모하지 않았으므로 정상 호출이 탐침으로 통과한다.
    expect((await fresh(c).generateWithOutcome(input)).candidates).toEqual(['보기 문장']);
    expect(c.isOpen()).toBe(false);
  });

  it('시드 차단은 회로 상태를 바꾸지 않는다(몇 번이어도 개방 없음)', async () => {
    const c = circuit(1);
    for (let i = 0; i < 5; i += 1) await fresh(c, ['시드']).generateWithOutcome(input);
    expect(c.isOpen()).toBe(false);
    expect(hits).toBe(0);
  });

  it('429는 계수 · 400은 미계수', async () => {
    const c4 = circuit(2);
    status = 400;
    for (let i = 0; i < 5; i += 1) await fresh(c4).generateWithOutcome(input);
    expect(c4.isOpen()).toBe(false);
    const c429 = circuit(2);
    status = 429;
    await fresh(c429).generateWithOutcome(input);
    await fresh(c429).generateWithOutcome(input);
    expect(c429.isOpen()).toBe(true);
  });

  it('half-open 탐침 성공 → 닫힘 · 탐침 실패 → 재개방(가짜 시계)', async () => {
    const c = circuit(1);
    await fresh(c).generateWithOutcome(input);
    clock.t += 60_000;
    expect((await fresh(c).generateWithOutcome(input)).failure).toBe('HTTP_5XX'); // 탐침 실패
    expect((await fresh(c).generateWithOutcome(input)).failure).toBe('CIRCUIT_OPEN');
    clock.t += 60_000;
    status = 200;
    expect((await fresh(c).generateWithOutcome(input)).candidates).toEqual(['보기 문장']);
    expect(c.isOpen()).toBe(false);
  });

  it('healthy()는 회로를 읽기만 한다 — 개방 중 false · half-open에서 호출해도 탐침을 소모하지 않는다', async () => {
    const c = circuit(1);
    await fresh(c).generateWithOutcome(input);
    expect(await fresh(c).healthy()).toBe(false);
    clock.t += 60_000;
    expect(await fresh(c).healthy()).toBe(true);
    expect(await fresh(c).healthy()).toBe(true);
    status = 200;
    expect((await fresh(c).generateWithOutcome(input)).candidates).toEqual(['보기 문장']);
  });

  it('회로 주입 없이 만든 Provider는 자기 회로를 쓴다(기존 동작 호환)', async () => {
    const p = new GeminiAugmentationProvider({ apiKey: 'k', baseUrl, circuitFailureThreshold: 1, circuitOpenMs: 60_000 });
    expect((await p.generateWithOutcome(input)).failure).toBe('HTTP_5XX');
    expect((await p.generateWithOutcome(input)).failure).toBe('CIRCUIT_OPEN');
  });
});
