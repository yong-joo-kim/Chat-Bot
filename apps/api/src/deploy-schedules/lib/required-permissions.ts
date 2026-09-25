import type { DeployScheduleAction, Permission } from '@chat-bot/shared-types';

/**
 * [신규 2026-09-23 No.28] 동작 → 요구 권한(AND, §8.1) — 생성·수정·취소·재개·확인 판정과 실행 직전
 * 재검증(`engine/creator-verifier.ts`)이 모두 이 함수 1개를 호출한다. 신규 권한 0종(FR-0-80).
 * BE 전용(FE는 하드코딩된 `can()` 조합을 쓴다 — 이 함수를 import하지 않는다).
 */
export function requiredPermissions(
  action: DeployScheduleAction,
  params: { versionId?: string; enableWebChannel?: boolean; enabled?: boolean; targetVersionId?: string },
): Permission[] {
  switch (action) {
    case 'RESTORE_VERSION':
      return ['dialogue:write', 'chatbot:write'];
    case 'PUBLISH':
      return params.enableWebChannel ? ['chatbot:write', 'channel:write'] : ['chatbot:write'];
    case 'SET_WEB_CHANNEL':
      return ['channel:write'];
    // [신규 No.40] 예약 전환 생성·수정·취소·재개·확인 + 예약자 재검증(§17.2) 전부 `chatbot:deploy`.
    case 'SWITCH_PROD_VERSION':
      return ['chatbot:deploy'];
  }
}

/** G3(실행 직후 TC) 생성 시 추가로 필요한 권한(§11) — 실행 시 부족하면 G3만 SKIPPED(예약 결과 불변). */
export const POST_RUN_TEST_PERMISSION: Permission = 'simulation:write';

/** G3 허용 동작(§11) — `RESTORE_VERSION`·`PUBLISH`·`SWITCH_PROD_VERSION`. `SET_WEB_CHANNEL`은 응답
 * 내용이 바뀌지 않는다. */
export const POST_RUN_TEST_APPLICABLE_ACTIONS: readonly DeployScheduleAction[] = ['RESTORE_VERSION', 'PUBLISH', 'SWITCH_PROD_VERSION'];

export function isPostRunTestApplicable(action: DeployScheduleAction): boolean {
  return POST_RUN_TEST_APPLICABLE_ACTIONS.includes(action);
}
