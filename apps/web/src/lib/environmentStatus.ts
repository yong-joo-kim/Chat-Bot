import type { EnvironmentStatus } from '@chat-bot/shared-types';

/**
 * `ChatbotDetailContext.environmentStatus`에서 반복적으로 파생되는 값(No.40,
 * `environment-separation-ui-spec.md` §3.2 `useEnvironmentStatus`)을 계산하는 순수 헬퍼다.
 * 컨텍스트 접근 자체는 관행대로 호출부가 `useChatbotDetailContext()`로 직접 하고, 그 결과를
 * 이 함수에 넘긴다(라우터 밖에서도 시험 가능한 순수 함수로 유지하기 위함).
 */
export interface EnvironmentStatusView {
  isEnabled: boolean;
  stagingVersionNo?: number;
  prodVersionNo?: number;
  draftDiffersFromProd: boolean;
}

export function deriveEnvironmentStatusView(status: EnvironmentStatus | null | undefined): EnvironmentStatusView {
  if (!status?.enabled) {
    return { isEnabled: false, draftDiffersFromProd: false };
  }
  return {
    isEnabled: true,
    stagingVersionNo: status.staging?.versionNo,
    prodVersionNo: status.prod.versionNo,
    draftDiffersFromProd: !status.draft.sameAsProd,
  };
}
