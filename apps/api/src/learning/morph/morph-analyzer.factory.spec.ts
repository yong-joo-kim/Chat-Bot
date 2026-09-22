import { ConfigService } from '@nestjs/config';
import { MorphAnalyzerFactory } from './morph-analyzer.factory';
import { HeuristicAnalyzer } from './heuristic-analyzer';

function factoryWith(env: Record<string, string | undefined>): MorphAnalyzerFactory {
  const config = { get: (key: string) => env[key] } as unknown as ConfigService;
  return new MorphAnalyzerFactory(config);
}

describe('MorphAnalyzerFactory', () => {
  it('초기값은 항상 HeuristicAnalyzer다(초기화 완료 전에도 즉시 사용 가능)', () => {
    const factory = factoryWith({});
    expect(factory.getAnalyzer()).toBeInstanceOf(HeuristicAnalyzer);
  });

  it('MORPH_ANALYZER=heuristic이면 항상 HeuristicAnalyzer로 초기화된다', async () => {
    const factory = factoryWith({ MORPH_ANALYZER: 'heuristic' });
    await factory.initialize();
    expect(factory.getAnalyzer()).toBeInstanceOf(HeuristicAnalyzer);
  });

  it(
    'MORPH_ANALYZER=auto(기본)이면 garu-ko 로드를 시도한다 — Jest는 --experimental-vm-modules 없이는 ' +
      '순수 ESM 동적 import를 실행할 수 없으므로(ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING_FLAG), 이 테스트' +
      ' 환경에서는 항상 M0(HeuristicAnalyzer)로 안전하게 내려가야 한다(ADR-0028 §1 — "API 기동은 절대' +
      ' 실패하지 않는다"를 이 제약 상황 자체로 증명한다). 실제 Node 런타임에서의 성공 경로는' +
      ' `garu-analyzer.spec.ts`가 모킹으로 검증한다.',
    async () => {
      const factory = factoryWith({});
      await factory.initialize();
      const analyzer = factory.getAnalyzer();
      expect(analyzer).toBeInstanceOf(HeuristicAnalyzer);
      expect(analyzer.ready).toBe(true);
    },
  );

  it('garu-ko 로드가 성공하면(모킹) GaruAnalyzer를 쓴다', async () => {
    jest.resetModules();
    jest.mock('./garu-esm-loader');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const loader = require('./garu-esm-loader');
    loader.loadGaruModule.mockImplementation(async () => ({
      Garu: { load: async () => ({ analyze: () => ({ tokens: [] }), destroy: () => undefined }) },
    }));
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { MorphAnalyzerFactory: ReloadedFactory } = require('./morph-analyzer.factory');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { GaruAnalyzer: ReloadedGaruAnalyzer } = require('./garu-analyzer');
    const config = { get: () => undefined } as unknown as ConfigService;
    const factory = new ReloadedFactory(config);
    await factory.initialize();
    expect(factory.getAnalyzer()).toBeInstanceOf(ReloadedGaruAnalyzer);
    jest.dontMock('./garu-esm-loader');
    jest.resetModules();
  });

  it('알 수 없는 값이면 heuristic으로 안전하게 수렴한다', async () => {
    const factory = factoryWith({ MORPH_ANALYZER: 'not-a-real-analyzer' });
    await factory.initialize();
    expect(factory.getAnalyzer()).toBeInstanceOf(HeuristicAnalyzer);
  });
});
