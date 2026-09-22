/**
 * `garu-ko`(M1)는 순수 ESM 전용 패키지다(`package.json` `"type": "module"`, CJS `require` 진입점
 * 없음). 이 프로젝트는 `apps/api`를 CommonJS로 빌드하는데(`tsconfig.json` `module: "CommonJS"`),
 * TypeScript는 일반적인 `await import(...)` 문법을 **`require(...)`로 다운레벨**한다 — 컴파일
 * 산출물을 직접 검사해 확인했다(`require('garu-ko')`가 그대로 생성됨). 그 상태로 실행하면 순수
 * ESM 패키지에서 `ERR_REQUIRE_ESM`이 발생한다.
 *
 * `new Function(...)`으로 감싸 컴파일러(tsc)가 문자열 내부를 손대지 못하게 하면, 실행 시점에는
 * Node의 **진짜 동적 `import()`**가 그대로 평가되어 CJS 프로세스 안에서도 ESM 패키지를 정상
 * 로드한다(Node 공식 CJS→ESM interop 방법). 컴파일된 산출물을 plain Node로 직접 실행해 정상
 * 동작을 확인했다.
 *
 * ⚠ 이 로더를 별도 파일로 분리한 이유: Jest의 기본(vm 기반) 테스트 환경은 `--experimental-vm-modules`
 * 없이는 실제 동적 `import()`를 실행할 수 없다(`ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING_FLAG`).
 * `garu-analyzer.ts`가 이 함수를 **일반 `import`로만** 가져오게 하면(동적 import를 직접 품지 않으면),
 * 테스트에서는 `jest.mock('./garu-esm-loader', ...)`로 이 함수 자체를 갈아 끼워 실제 ESM 로딩을
 * 우회하고 `GaruAnalyzer`의 래핑 로직만 검증할 수 있다(`garu-analyzer.spec.ts`).
 */
export interface GaruToken {
  text: string;
  pos: string;
  start: number;
  end: number;
}

export interface GaruInstance {
  analyze(text: string): { tokens: GaruToken[] };
  destroy(): void;
}

export interface GaruModule {
  Garu: { load(): Promise<GaruInstance> };
}

export function loadGaruModule(): Promise<GaruModule> {
  return new Function('specifier', 'return import(specifier)')('garu-ko');
}
