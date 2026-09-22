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
});
