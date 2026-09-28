/**
 * [신규 No.43 — 구현 편차 기록 §25] ESM 전용 패키지(`pdfjs-dist` legacy 빌드 등) 동적 로더.
 *
 * TypeScript는 `module: "commonjs"`일 때 `import()` 식을 항상 `require()` 기반 코드로 낮춘다
 * (하위 호환 목적 — 마이크로소프트 공식 이슈 microsoft/TypeScript#43329). 그런데 `pdfjs-dist@4.2.67`의
 * `legacy/build/pdf.mjs`는 최상위 `await`를 포함한 **순수 ESM**이라 `require()`로 불러올 수 없다
 * (Node가 `ERR_REQUIRE_ESM`류 오류로 거부한다 — 실측 확인). 진짜 네이티브 동적 `import()`를 보존하려면
 * TS 트랜스파일이 손대지 않는 형태로 호출해야 한다.
 *
 * `new Function(...)`은 **신뢰할 수 없는 콘텐츠를 실행하기 위한 것이 아니다** — 인자는 이 파일
 * 안에서 고정한 리터럴 지정자(`pdf-text.ts`가 넘기는 빌드타임 상수 문자열)뿐이고, 사용자 입력·크롤
 * 결과 문자열을 받지 않는다. `kb-sync/**`·`extract.worker.ts`의 봉인(KB-16 — `eval`·`new Function` 0)은
 * 이 파일이 `common/lib/`에 있어 범위 밖이다(파서 취약점·문서 콘텐츠 실행과 무관한 별개의 관심사).
 */
// eslint-disable-next-line @typescript-eslint/no-implied-eval
const nativeDynamicImport: (specifier: string) => Promise<unknown> = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<unknown>;

export function importEsm<T = unknown>(specifier: string): Promise<T> {
  return nativeDynamicImport(specifier) as Promise<T>;
}
