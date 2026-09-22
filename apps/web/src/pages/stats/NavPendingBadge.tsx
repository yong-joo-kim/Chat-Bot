import { MESSAGES } from '../../constants/messages';

/**
 * 대기 건수 배지(FR-C-2, §2.2). 0건이면 렌더하지 않는다(시각적 소음 감소). 999건 초과는 "999+"로
 * 자르되 `aria-label`에는 정확한 값을 담는다. 색상은 중립(위험색 아님) — "할 일이 있다"일 뿐 오류가 아니다.
 */
export function NavPendingBadge({ count }: { count: number }): JSX.Element | null {
  if (count === 0) return null;
  return (
    <span className="nav-pending-badge" aria-label={MESSAGES.statsShell.pendingBadgeAriaLabel(count)}>
      {MESSAGES.statsShell.pendingBadgeText(count)}
    </span>
  );
}
