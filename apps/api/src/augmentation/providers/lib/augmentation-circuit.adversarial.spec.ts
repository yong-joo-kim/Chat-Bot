import * as http from 'node:http';
import type { ConfigService } from '@nestjs/config';
import { AugmentationProviderFactory } from '../augmentation-provider.factory';
import { resetGovernanceRuntimeForTest } from '../../../common/governance/governance-runtime';

/**
 * [후속 결함 최종 회귀 · 적대적 확인 — test-automation 2026-10-01] K-1c: 팩토리를 거친 실제 배선에서
 * (1) 임계 도달 후 개방 중 네트워크 호출 0 (2) 개방 시간 후 탐침 1건(동시 호출은 거부) (3) 4xx는 비계수 — 가짜 시계 + 실제 로컬 HTTP 서버.
 */
describe('K-1c 팩토리 경유 회로 — 적대적 확인', () => {
  afterEach(() => resetGovernanceRuntimeForTest());

  let hits = 0;
  let status = 503;
  let holdMs = 0;
  let server: http.Server;
  let baseUrl: string;
  const clock = { t: 1_000_000 };
  const input = { seeds: ['시드 문장'], targetCount: 3, locale: 'ko' as const };

  beforeEach(async () => {
    hits = 0;
    status = 503;
    holdMs = 0;
    clock.t = 1_000_000;
    server = http.createServer((_req, res) => {
      hits += 1;
      const reply = (): void => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(status === 200 ? JSON.stringify({ modelId: 'm', candidates: ['보기 문장'] }) : '{}');
      };
      if (holdMs > 0) setTimeout(reply, holdMs);
      else reply();
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const addr = server.address();
    baseUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  });
  afterEach(async () => {
    server.closeAllConnections?.();
    await new Promise<void>((r) => server.close(() => r()));
  });

  const makeFactory = (threshold: number, openMs = 60_000): AugmentationProviderFactory => {
    const values: Record<string, unknown> = {
      AUGMENTATION_PROVIDER: 'local',
      AUGMENTATION_LOCAL_BASE_URL: baseUrl,
      AUGMENTATION_CIRCUIT_FAILURE_THRESHOLD: threshold,
      AUGMENTATION_CIRCUIT_OPEN_MS: openMs,
      AUGMENTATION_TIMEOUT_MS: 30_000,
    };
    const config = { get: (k: string) => values[k] } as unknown as ConfigService;
    return new AugmentationProviderFactory(config, () => clock.t);
  };
  // Job마다 getProvider()를 새로 호출한다(러너와 같다).
  const job = (f: AugmentationProviderFactory) => (f.getProvider() as unknown as { generateWithOutcome(i: typeof input): Promise<{ candidates: readonly string[]; failure?: string }> }).generateWithOutcome(input);

  it('임계 3 도달 후 개방 중 호출 20건은 네트워크 호출 0', async () => {
    const f = makeFactory(3);
    for (let i = 0; i < 3; i += 1) expect((await job(f)).failure).toBe('HTTP_5XX');
    expect(hits).toBe(3);
    for (let i = 0; i < 20; i += 1) {
      clock.t += 1_000; // 개방 시간(60초) 안
      expect(await job(f)).toEqual({ candidates: [], failure: 'CIRCUIT_OPEN' });
    }
    expect(hits).toBe(3);
  });

  it('개방 시간 경과 후 탐침 정확히 1건 — 탐침 진행 중 동시 호출은 거부, 실패하면 재개방', async () => {
    const f = makeFactory(2);
    await job(f);
    await job(f);
    expect(hits).toBe(2);
    clock.t += 60_000; // half-open
    holdMs = 150; // 탐침이 끝나기 전에 동시 호출이 들어오게 한다
    const probe = job(f);
    await new Promise((r) => setTimeout(r, 30));
    const concurrent = await Promise.all([job(f), job(f), job(f)]);
    for (const c of concurrent) expect(c.failure).toBe('CIRCUIT_OPEN');
    expect((await probe).failure).toBe('HTTP_5XX'); // 탐침 실패
    expect(hits).toBe(3); // 3번째 = 탐침 1건뿐
    // 재개방 — 직후 호출은 다시 0건
    holdMs = 0;
    expect((await job(f)).failure).toBe('CIRCUIT_OPEN');
    expect(hits).toBe(3);
    // 다시 개방 시간 경과 + 서버 복구 → 탐침 성공 → 닫힘
    clock.t += 60_000;
    status = 200;
    expect((await job(f)).failure).toBeUndefined();
    expect(hits).toBe(4);
    expect((await job(f)).failure).toBeUndefined();
    expect(hits).toBe(5);
  });

  it('4xx(400·404·422)는 몇 번이어도 비계수 — 개방하지 않는다 / 429는 계수한다', async () => {
    const f = makeFactory(2);
    for (const s of [400, 404, 422, 400, 404, 422]) {
      status = s;
      expect((await job(f)).failure).toBe('HTTP_4XX');
    }
    expect(hits).toBe(6); // 6번 모두 실제 호출 — 회로가 막지 않았다
    status = 429;
    await job(f);
    await job(f);
    expect(hits).toBe(8);
    expect((await job(f)).failure).toBe('CIRCUIT_OPEN');
    expect(hits).toBe(8);
  });

  it('성공이 연속 실패를 0으로 되돌린다(5xx, 5xx, 성공, 5xx 는 개방 아님 — 임계 3)', async () => {
    const f = makeFactory(3);
    status = 503;
    await job(f);
    await job(f);
    status = 200;
    await job(f);
    status = 503;
    expect((await job(f)).failure).toBe('HTTP_5XX');
    expect((await job(f)).failure).toBe('HTTP_5XX'); // 연속 2 — 아직 열리지 않음
    expect(hits).toBe(5);
  });

  it('다른 팩토리(=다른 프로세스)는 회로를 공유하지 않는다', async () => {
    const a = makeFactory(1);
    const b = makeFactory(1);
    await job(a);
    expect((await job(a)).failure).toBe('CIRCUIT_OPEN');
    expect((await job(b)).failure).toBe('HTTP_5XX');
  });
});
