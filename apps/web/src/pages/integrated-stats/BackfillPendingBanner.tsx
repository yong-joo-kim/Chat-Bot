import { MESSAGES } from '../../constants/messages';

/**
 * §2.3 — 5개 응답 중 하나라도 `backfillPending: true`이면 상시 노출(닫기 버튼 없음). 문제가 스스로
 * 해소될 때까지 계속 알린다(`PendingLimitBanner` 선례와 동일 철학, UIUX §8 "부분 정정 상태" 규칙).
 */
export function BackfillPendingBanner(): JSX.Element {
  return (
    <div className="backfill-pending-banner" role="status">
      <span aria-hidden="true">ℹ</span> {MESSAGES.integratedStats.backfillPendingBanner}
    </div>
  );
}
