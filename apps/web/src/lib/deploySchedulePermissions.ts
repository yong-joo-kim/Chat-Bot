import type { DeployScheduleAction, Permission } from '@chat-bot/shared-types';

export interface DeployScheduleActionParamsLike {
  enableWebChannel?: boolean | null;
}

/**
 * No.28 리뷰 2라운드 M-3 — 동작별 필요 권한(설계서 §8.1 그대로, 생성=수정=취소=재개=확인함 전부
 * 동일). 순수 함수로 두어 화면(목록 행/상세)과 테스트가 동일한 판정을 공유한다 — 서버가 최종 통제.
 */
export function deployScheduleRequiredPermissions(action: DeployScheduleAction, params: DeployScheduleActionParamsLike = {}): Permission[] {
  switch (action) {
    case 'RESTORE_VERSION':
      return ['dialogue:write', 'chatbot:write'];
    case 'PUBLISH':
      return params.enableWebChannel ? ['chatbot:write', 'channel:write'] : ['chatbot:write'];
    case 'SET_WEB_CHANNEL':
      return ['channel:write'];
    // [신규 No.40] 환경 분리 — 운영 버전 전환 예약(§17 권한 매트릭스).
    case 'SWITCH_PROD_VERSION':
      return ['chatbot:deploy'];
    default:
      return [];
  }
}

/** 지정 동작(+params)에 필요한 권한을 사용자가 전부 보유했는지 판정한다. */
export function canManageDeploySchedule(
  can: (permission: Permission) => boolean,
  action: DeployScheduleAction,
  params: DeployScheduleActionParamsLike = {},
): boolean {
  return deployScheduleRequiredPermissions(action, params).every((p) => can(p));
}
