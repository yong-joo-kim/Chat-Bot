import { LEARNING_LIMITS } from '@chat-bot/shared-types';
import { MESSAGES } from '../../constants/messages';

/**
 * [신규 No.44] 부정 평가 `PENDING` 상한(2,000) 도달 배너 — 기존 `PendingLimitBanner`(미응답 5,000건)와
 * 별도 인스턴스로 동시에 뜰 수 있다(feedback-loop-ui-spec.md §3.3). 상시 표시(닫기 불가).
 */
export function NegativeFeedbackLimitBanner({
  maxPending = LEARNING_LIMITS.maxPendingNegativeFeedback,
}: {
  maxPending?: number;
}): JSX.Element {
  return (
    <div className="pending-limit-banner negative-feedback-limit-banner" role="status">
      <span aria-hidden="true">ℹ</span> {MESSAGES.learning.negativeFeedbackLimitBanner(maxPending)}
    </div>
  );
}
