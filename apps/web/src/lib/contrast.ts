/**
 * 재export 셔임(ADR-0012) — 실제 로직은 `packages/shared-types/src/contrast.ts`로 이동했다
 * (`apps/widget`도 동일 로직을 서브패스로 값 import해야 하므로). 기존 import 경로
 * (`../lib/contrast`)와 `contrast.spec.ts`는 수정 없이 그대로 통과한다.
 */
export * from '@chat-bot/shared-types/contrast';
