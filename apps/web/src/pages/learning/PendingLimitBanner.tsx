import { LEARNING_LIMITS } from '@chat-bot/shared-types';
import { MESSAGES } from '../../constants/messages';

/** FR-15-8 — PENDING 상한 도달 배너. 상시 표시(닫기 불가 — 문제가 스스로 해소되지 않는다). */
export function PendingLimitBanner({ maxPending = LEARNING_LIMITS.maxPendingPerChatbot }: { maxPending?: number }): JSX.Element {
  return (
    <div className="pending-limit-banner" role="status">
      <span aria-hidden="true">ℹ</span> {MESSAGES.learning.pendingLimitBanner(maxPending)}
    </div>
  );
}
