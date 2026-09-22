/**
 * `GaruAnalyzer`는 실제 로딩을 `garu-esm-loader.ts`(별도 파일)에 위임한다 — 그 파일의 동적
 * `import()`는 Jest의 기본(vm 기반) 테스트 환경에서 `--experimental-vm-modules` 없이 실행할 수
 * 없으므로(`ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING_FLAG`), 여기서는 `./garu-esm-loader` 자체를
 * `jest.mock()`으로 갈아 끼워 **래핑 로직**(오프셋 매핑·`ready` 플래그·예외 흡수)만 검증한다.
 *
 * 모킹 데이터는 이 프로젝트의 실측(스크래치패드 스크립트로 실제 `garu-ko@0.9.18`를 호출)에서
 * 얻은 진짜 출력을 그대로 옮긴 것이다 — 실제 컴파일 산출물을 plain Node로 실행해 로딩 자체가
 * 정상 동작함은 별도로 확인했다(`garu-esm-loader.ts` 상단 주석 참고).
 */
import { GaruInstance } from './garu-esm-loader';

jest.mock('./garu-esm-loader');

// 실측(스크래치패드 스크립트) 출력 그대로 — '해외로 반품 보낼 수 있나요'
const REAL_TOKENS_1 = [
  { text: '해외', pos: 'NNG', start: 0, end: 3 },
  { text: '로', pos: 'JKB', start: 0, end: 3 },
  { text: '반품', pos: 'NNG', start: 4, end: 6 },
  { text: '보내', pos: 'VV', start: 7, end: 9 },
  { text: 'ㄹ', pos: 'ETM', start: 7, end: 9 },
  { text: '수', pos: 'NNB', start: 10, end: 11 },
  { text: '있', pos: 'VA', start: 12, end: 15 },
  { text: '나요', pos: 'EF', start: 12, end: 15 },
];
// 실측 출력 — '해외배송비' (엔티티 gazetteer 관점에서 유용한 2-way 분리)
const REAL_TOKENS_2 = [
  { text: '해외', pos: 'NNG', start: 0, end: 5 },
  { text: '배송비', pos: 'NNG', start: 0, end: 5 },
];

function mockLoad(instanceFactory: () => Promise<GaruInstance>) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const loader = require('./garu-esm-loader');
  loader.loadGaruModule.mockImplementation(async () => ({ Garu: { load: instanceFactory } }));
}

beforeEach(() => {
  jest.resetAllMocks();
});

describe('GaruAnalyzer (M1) — 래핑 로직(모킹, 근거: 실측 출력)', () => {
  it('실측 토큰 형태를 MorphToken[]으로 정확히 매핑한다', async () => {
    mockLoad(async () => ({
      analyze: (text: string) => ({ tokens: text === '해외배송비' ? REAL_TOKENS_2 : REAL_TOKENS_1 }),
      destroy: () => undefined,
    }));
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { GaruAnalyzer } = require('./garu-analyzer');
    const analyzer = await GaruAnalyzer.load();

    expect(analyzer.ready).toBe(true);
    expect(analyzer.analyzerId).toBe('garu-ko@0.9.18');

    const tokens = analyzer.analyze('해외로 반품 보낼 수 있나요');
    expect(tokens).toEqual([
      { surface: '해외', start: 0, end: 3, pos: 'NNG' },
      { surface: '로', start: 0, end: 3, pos: 'JKB' },
      { surface: '반품', start: 4, end: 6, pos: 'NNG' },
      { surface: '보내', start: 7, end: 9, pos: 'VV' },
      { surface: 'ㄹ', start: 7, end: 9, pos: 'ETM' },
      { surface: '수', start: 10, end: 11, pos: 'NNB' },
      { surface: '있', start: 12, end: 15, pos: 'VA' },
      { surface: '나요', start: 12, end: 15, pos: 'EF' },
    ]);
  });

  it('gazetteer 대상 복합어(해외배송비)를 엔티티 그룹으로 유용하게 분리한다', async () => {
    mockLoad(async () => ({ analyze: () => ({ tokens: REAL_TOKENS_2 }), destroy: () => undefined }));
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { GaruAnalyzer } = require('./garu-analyzer');
    const analyzer = await GaruAnalyzer.load();
    const surfaces = analyzer.analyze('해외배송비').map((t: { surface: string }) => t.surface);
    expect(surfaces).toEqual(['해외', '배송비']);
  });

  it('같은 어절 안의 형태소는 동일한 어절 단위 오프셋을 공유한다(알려진 한계 — 문서화된 동작)', async () => {
    mockLoad(async () => ({ analyze: () => ({ tokens: REAL_TOKENS_1 }), destroy: () => undefined }));
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { GaruAnalyzer } = require('./garu-analyzer');
    const analyzer = await GaruAnalyzer.load();
    const tokens = analyzer.analyze('해외로 반품 보낼 수 있나요');
    const [hae, ro] = tokens; // '해외', '로' — 같은 어절 "해외로"
    expect(hae.start).toBe(ro.start);
    expect(hae.end).toBe(ro.end);
  });

  it('analyze() 호출 중 예외가 나면 그 호출만 빈 배열로 흡수한다(예외 전파 금지)', async () => {
    mockLoad(async () => ({
      analyze: () => {
        throw new Error('WASM 내부 오류(시뮬레이션)');
      },
      destroy: () => undefined,
    }));
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { GaruAnalyzer } = require('./garu-analyzer');
    const analyzer = await GaruAnalyzer.load();
    expect(() => analyzer.analyze('아무 문장')).not.toThrow();
    expect(analyzer.analyze('아무 문장')).toEqual([]);
  });

  it('garu-ko 로드 자체가 실패하면 ready=false이고 analyze()는 빈 배열을 반환한다(ADR-0028 §1)', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const loader = require('./garu-esm-loader');
    loader.loadGaruModule.mockImplementation(() => Promise.reject(new Error('WASM 초기화 실패(시뮬레이션)')));
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { GaruAnalyzer } = require('./garu-analyzer');
    const analyzer = await GaruAnalyzer.load();
    expect(analyzer.ready).toBe(false);
    expect(analyzer.analyze('아무 문장')).toEqual([]);
  });
});
