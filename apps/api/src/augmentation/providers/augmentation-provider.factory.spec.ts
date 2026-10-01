import { ConfigService } from '@nestjs/config';
import { AugmentationProviderFactory } from './augmentation-provider.factory';
import { RuleBasedAugmentationProvider } from './rule-augmentation.provider';
import { GeminiAugmentationProvider } from './gemini-augmentation.provider';
import { LocalAugmentationProvider } from './local-augmentation.provider';
import { MockAugmentationProvider } from './mock-augmentation.provider';

function factoryWith(env: Record<string, string | number | undefined>): AugmentationProviderFactory {
  const config = { get: (key: string) => env[key] } as unknown as ConfigService;
  return new AugmentationProviderFactory(config);
}

describe('AugmentationProviderFactory', () => {
  it('환경변수 미설정 시 기본값은 rule이다', () => {
    const factory = factoryWith({});
    expect(factory.getProvider()).toBeInstanceOf(RuleBasedAugmentationProvider);
  });

  it('AUGMENTATION_PROVIDER=gemini + 키 있음이면 GeminiAugmentationProvider를 만든다', () => {
    const factory = factoryWith({ AUGMENTATION_PROVIDER: 'gemini', AUGMENTATION_GEMINI_API_KEY: 'k' });
    expect(factory.getProvider()).toBeInstanceOf(GeminiAugmentationProvider);
  });

  it('AUGMENTATION_PROVIDER=gemini인데 키가 없으면 rule로 저하한다(기동 실패 아님)', () => {
    const factory = factoryWith({ AUGMENTATION_PROVIDER: 'gemini' });
    expect(factory.getProvider()).toBeInstanceOf(RuleBasedAugmentationProvider);
  });

  it('AUGMENTATION_PROVIDER=local인데 base url이 없으면 rule로 저하한다', () => {
    const factory = factoryWith({ AUGMENTATION_PROVIDER: 'local' });
    expect(factory.getProvider()).toBeInstanceOf(RuleBasedAugmentationProvider);
  });

  it('AUGMENTATION_PROVIDER=local + base url 있음이면 LocalAugmentationProvider를 만든다', () => {
    const factory = factoryWith({ AUGMENTATION_PROVIDER: 'local', AUGMENTATION_LOCAL_BASE_URL: 'http://x' });
    expect(factory.getProvider()).toBeInstanceOf(LocalAugmentationProvider);
  });

  it('getFallbackProvider(): 설정과 무관하게 항상 G1(rule)이다(K-1b)', () => {
    const envs = [{}, { AUGMENTATION_PROVIDER: 'gemini', AUGMENTATION_GEMINI_API_KEY: 'k' }, { AUGMENTATION_PROVIDER: 'local', AUGMENTATION_LOCAL_BASE_URL: 'http://x' }, { AUGMENTATION_PROVIDER: 'mock' }];
    for (const env of envs) expect(factoryWith(env).getFallbackProvider()).toBeInstanceOf(RuleBasedAugmentationProvider);
  });

  it('AUGMENTATION_PROVIDER=mock이면 MockAugmentationProvider를 만든다', () => {
    const factory = factoryWith({ AUGMENTATION_PROVIDER: 'mock' });
    expect(factory.getProvider()).toBeInstanceOf(MockAugmentationProvider);
  });

  it('알 수 없는 값이면 rule로 수렴한다', () => {
    const factory = factoryWith({ AUGMENTATION_PROVIDER: 'unknown-vendor' });
    expect(factory.getProvider()).toBeInstanceOf(RuleBasedAugmentationProvider);
  });

  it('getCapability(): gemini 키 없음이면 degraded=true, reason=API_KEY_MISSING', async () => {
    const factory = factoryWith({ AUGMENTATION_PROVIDER: 'gemini' });
    const cap = await factory.getCapability();
    expect(cap).toMatchObject({
      providerId: 'rule',
      configuredProviderId: 'gemini',
      degraded: true,
      degradeReason: 'API_KEY_MISSING',
    });
  });

  it('getCapability(): rule 구성이면 degraded=false다', async () => {
    const factory = factoryWith({});
    const cap = await factory.getCapability();
    expect(cap).toMatchObject({ providerId: 'rule', configuredProviderId: 'rule', degraded: false });
  });

  // K-1c — 회로 상태는 팩토리가 공급자별로 소유한다(Provider 인스턴스는 호출마다 새로 만든다).
  describe('회로 소유(K-1c)', () => {
    type Internals = { circuits: Map<string, unknown> };
    const circuitsOf = (f: AugmentationProviderFactory): Map<string, unknown> => (f as unknown as Internals).circuits;
    const geminiEnv = { AUGMENTATION_PROVIDER: 'gemini', AUGMENTATION_GEMINI_API_KEY: 'k' };

    it('같은 팩토리의 두 getProvider()는 서로 다른 인스턴스지만 같은 회로를 공유한다', () => {
      const f = factoryWith(geminiEnv);
      const a = f.getProvider();
      const b = f.getProvider();
      expect(a).not.toBe(b);
      expect(circuitsOf(f).size).toBe(1);
      expect((a as unknown as { circuit: unknown }).circuit).toBe((b as unknown as { circuit: unknown }).circuit);
    });

    it('다른 팩토리는 독립 회로를 가진다', () => {
      const a = factoryWith(geminiEnv).getProvider() as unknown as { circuit: unknown };
      const b = factoryWith(geminiEnv).getProvider() as unknown as { circuit: unknown };
      expect(a.circuit).not.toBe(b.circuit);
    });

    it('rule·mock 구성과 키 없는 저하 구성은 회로를 만들지 않는다(AC-K1c-4)', () => {
      for (const env of [{}, { AUGMENTATION_PROVIDER: 'mock' }, { AUGMENTATION_PROVIDER: 'gemini' }, { AUGMENTATION_PROVIDER: 'local' }]) {
        const f = factoryWith(env);
        f.getProvider();
        f.getFallbackProvider();
        expect(circuitsOf(f).size).toBe(0);
      }
    });

    it('local도 회로를 소유한다', () => {
      const f = factoryWith({ AUGMENTATION_PROVIDER: 'local', AUGMENTATION_LOCAL_BASE_URL: 'http://x' });
      f.getProvider();
      expect([...circuitsOf(f).keys()]).toEqual(['local']);
    });

    it('설정 임계·개방 시간·주입 시계를 따른다(임계 1 · 개방 5초 · 가짜 시계) — 개방 중 capability는 UNHEALTHY', async () => {
      const clock = { t: 1_000 };
      const config = {
        get: (k: string) => ({ ...geminiEnv, AUGMENTATION_CIRCUIT_FAILURE_THRESHOLD: 1, AUGMENTATION_CIRCUIT_OPEN_MS: 5_000 })[k as never],
      } as unknown as ConfigService;
      const f = new AugmentationProviderFactory(config, () => clock.t);
      const circuit = circuitsOf(f).get('gemini') ?? (f.getProvider(), circuitsOf(f).get('gemini'));
      const c = circuit as { tryAcquire(): unknown; record(p: unknown, o: string): void; isOpen(): boolean };
      c.record(c.tryAcquire(), 'infra');
      expect(c.isOpen()).toBe(true);
      expect(await f.getCapability()).toMatchObject({ providerId: 'rule', configuredProviderId: 'gemini', degraded: true, degradeReason: 'UNHEALTHY' });
      clock.t += 5_000;
      expect(c.isOpen()).toBe(false);
      expect(await f.getCapability()).toMatchObject({ providerId: 'gemini', degraded: false });
    });
  });
});
