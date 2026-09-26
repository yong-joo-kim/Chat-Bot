import * as http from 'node:http';
import { LocalAugmentationProvider } from './local-augmentation.provider';
import { installGovernanceRuntime, resetGovernanceRuntimeForTest } from '../../common/governance/governance-runtime';

/**
 * M-1(코드 리뷰 R1) 회귀 시험 — 실제 `http` 서버로 리다이렉트를 재현한다(jest 목 fetch는
 * `redirect:'manual'` 의미를 실제로 검증하지 못한다). 모드 ON(enforce)에서는 허용 호스트가 비허용
 * 호스트로 3xx를 돌려줘도 그 호스트로 넘어가지 않고 기존 실패 경로(빈 배열/`false` · G1 폴백)로
 * 수렴해야 한다. 모드 OFF에서는 기존(`follow`) 동작이 그대로 유지되어야 한다(§27 I-11 결정).
 */
describe('LocalAugmentationProvider — 리다이렉트로 출구 게이트 우회 차단(M-1)', () => {
  afterEach(() => {
    resetGovernanceRuntimeForTest();
  });

  function startRedirectServer(locationUrl: string): Promise<{ url: string; close: () => Promise<void>; hitCount: () => number }> {
    return new Promise((resolve) => {
      let hits = 0;
      const server = http.createServer((_req, res) => {
        hits += 1;
        res.writeHead(302, { Location: locationUrl });
        res.end();
      });
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        const port = typeof address === 'object' && address ? address.port : 0;
        resolve({ url: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(() => r())), hitCount: () => hits });
      });
    });
  }

  function startTargetServer(kind: 'augment' | 'health'): Promise<{ url: string; close: () => Promise<void>; hitCount: () => number }> {
    return new Promise((resolve) => {
      let hits = 0;
      const server = http.createServer((_req, res) => {
        hits += 1;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify(
            kind === 'augment'
              ? { modelId: 'g3-model', candidates: ['보기 문장'] }
              : { status: 'ok', modelId: 'g3-model', device: 'cpu', warmedUp: true },
          ),
        );
      });
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        const port = typeof address === 'object' && address ? address.port : 0;
        resolve({ url: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(() => r())), hitCount: () => hits });
      });
    });
  }

  it('모드 ON — generate(): 허용 호스트가 비허용 호스트로 3xx를 돌려주면 그 호스트로 넘어가지 않고 빈 배열(G1 폴백)로 수렴한다', async () => {
    const target = await startTargetServer('augment'); // 비허용 호스트(리다이렉트 대상) — 절대 호출되면 안 된다
    const redirector = await startRedirectServer(`${target.url}/augment`);
    try {
      const allowedHost = new URL(redirector.url).host;
      installGovernanceRuntime({ mode: 'ON', egress: { allowlist: [allowedHost], enforce: true }, encryptionEnabled: false });
      const provider = new LocalAugmentationProvider({ baseUrl: redirector.url });

      const result = await provider.generate({ seeds: ['시드 문장'], targetCount: 3, locale: 'ko' });

      expect(result).toEqual([]);
      expect(target.hitCount()).toBe(0);
      expect(redirector.hitCount()).toBe(1);
    } finally {
      await redirector.close();
      await target.close();
    }
  });

  it('모드 ON — healthy(): 리다이렉트를 따라가지 않고 false로 수렴한다', async () => {
    const target = await startTargetServer('health');
    const redirector = await startRedirectServer(`${target.url}/augment/health`);
    try {
      const allowedHost = new URL(redirector.url).host;
      installGovernanceRuntime({ mode: 'ON', egress: { allowlist: [allowedHost], enforce: true }, encryptionEnabled: false });
      const provider = new LocalAugmentationProvider({ baseUrl: redirector.url });

      const result = await provider.healthy();

      expect(result).toBe(false);
      expect(target.hitCount()).toBe(0);
    } finally {
      await redirector.close();
      await target.close();
    }
  });

  it('모드 OFF(기본): 기존 follow 동작이 그대로 유지되어 리다이렉트를 따라간다', async () => {
    const target = await startTargetServer('augment');
    const redirector = await startRedirectServer(`${target.url}/augment`);
    try {
      const provider = new LocalAugmentationProvider({ baseUrl: redirector.url });

      const result = await provider.generate({ seeds: ['시드 문장'], targetCount: 3, locale: 'ko' });

      expect(result).toEqual(['보기 문장']);
      expect(target.hitCount()).toBe(1);
    } finally {
      await redirector.close();
      await target.close();
    }
  });
});
