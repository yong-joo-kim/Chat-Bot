import { MESSAGES } from '../../constants/messages';

/**
 * [신규 No.44] 부정 평가 전용 배지(feedback-loop-ui-spec.md §2.1/§3.5) — 기존 `NavPendingBadge`(미응답
 * 전용, 중립색)와 나란히 배치되는 별도 인스턴스. 색상(주황)·아이콘(👎)·`aria-label`로 명확히 구분한다.
 * 0건이면 렌더하지 않는다(기존 배지 규칙 상속).
 */
export function NegativeFeedbackNavBadge({ count }: { count: number }): JSX.Element | null {
  if (count === 0) return null;
  return (
    <span className="negative-feedback-nav-badge" aria-label={MESSAGES.statsShell.negativeFeedbackBadgeAriaLabel(count)}>
      <span aria-hidden="true">👎</span> {MESSAGES.statsShell.negativeFeedbackBadgeText(count)}
    </span>
  );
}
