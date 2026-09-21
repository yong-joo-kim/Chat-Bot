/**
 * 재export 셔임(ADR-0012) — 실제 로직은 `packages/shared-types/src/contrast.ts`로 이동했다
 * (`apps/widget`도 동일 로직을 서브패스로 값 import해야 하므로). 기존 import 경로
 * (`../lib/contrast`)와 `contrast.spec.ts`는 수정 없이 그대로 통과한다.
 */
// `export *`는 CJS 출처 모듈에서 Vite dev 서버가 정적 분석으로 named export를
// 합성하지 못한다(esbuild interop 경고) — 명시적으로 나열한다.
export { contrastRatio, evaluateHeaderContrast } from '@chat-bot/shared-types/contrast';
export type { ContrastCheckResult } from '@chat-bot/shared-types/contrast';
