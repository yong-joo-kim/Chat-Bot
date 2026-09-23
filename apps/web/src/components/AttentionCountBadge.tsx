import { MESSAGES } from '../constants/messages';

/**
 * "확인 필요 n" 배지(`scheduled-deploy-ui-spec.md` §3.2). `NavPendingBadge`(대기 건수, 중립색)와
 * 관행은 같지만 의미가 다르다 — FAILED/MISSED/HELD 미확인 건은 "주의가 필요하다"는 경고 의미이므로
 * 주황 계열(WARNING)로 표시한다. 0건이면 렌더하지 않는다.
 */
export function AttentionCountBadge({ count }: { count: number }): JSX.Element | null {
  if (count === 0) return null;
  const msg = MESSAGES.deploySchedules;
  return (
    <span className="attention-count-badge" aria-label={msg.attentionBadgeAriaLabel(count)}>
      <span aria-hidden="true">⚠</span> {msg.attentionBadgeText(count)}
    </span>
  );
}
