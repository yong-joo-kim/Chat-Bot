import { useId } from 'react';
import type { UnansweredQuestionListItem } from '@chat-bot/shared-types';
import { MESSAGES } from '../../constants/messages';

/**
 * [신규 No.44] "직접 수정 완료" 버튼(feedback-loop-ui-spec.md §2.2/§3.3) — `NEGATIVE_FEEDBACK` ∧
 * `PENDING`일 때만 활성, 그 외에는 **숨기지 않고** 비활성 + 사유 텍스트로 렌더한다(권한 없으면 숨김,
 * 상태가 안 맞으면 비활성 — 두 규칙을 혼동하지 않는다, §3.3 인계 메모 #7).
 */
export function MarkAddressedButton({
  item,
  submitting,
  onClick,
}: {
  item: UnansweredQuestionListItem;
  submitting?: boolean;
  onClick: () => void;
}): JSX.Element {
  const descId = useId();
  const isNegativeFeedback = item.source === 'NEGATIVE_FEEDBACK';
  const isPending = item.status === 'PENDING';
  const eligible = isNegativeFeedback && isPending;
  const reason = !isNegativeFeedback
    ? MESSAGES.learning.markAddressedDisabledUnanswered
    : !isPending
      ? MESSAGES.learning.markAddressedDisabledResolved
      : undefined;

  return (
    <span className="mark-addressed-button-wrap">
      <button
        type="button"
        className="btn btn-secondary"
        disabled={!eligible || submitting}
        aria-describedby={reason ? descId : undefined}
        onClick={onClick}
      >
        {MESSAGES.learning.markAddressedAction}
      </button>
      {reason && (
        <span id={descId} className="field-hint">
          {reason}
        </span>
      )}
    </span>
  );
}
