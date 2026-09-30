import { MESSAGES } from '../../../../constants/messages';
import { EXPIRING_SOON_MINUTES, remainingMinutes } from '../../../../lib/approvalText';
import { formatDateTime } from '../../../../lib/date';
import { SeverityBadge } from '../../../../components/SeverityBadge';

/** "23시간 12분 남음 · 2026-10-01 14:02 만료" 형태의 남은 시간(분 단위 갱신 — `aria-live` 없음, 낭독 소음 방지). */
export function remainingLabel(expiresAt: Date | string, now: Date): string {
  const m = MESSAGES.switchApproval.remaining;
  const minutes = remainingMinutes(expiresAt, now);
  if (minutes < EXPIRING_SOON_MINUTES) return m.soon(Math.max(0, minutes));
  if (minutes < 60) return m.minutes(minutes);
  return m.hoursMinutes(Math.floor(minutes / 60), minutes % 60);
}

export function RemainingTimeText({ expiresAt, now, short = false, onRefresh }: { expiresAt: Date | string; now: Date; short?: boolean; onRefresh?: () => void }): JSX.Element {
  const m = MESSAGES.switchApproval.remaining;
  const minutes = remainingMinutes(expiresAt, now);
  if (minutes <= 0) {
    return (
      <span className="approval-remaining">
        {short ? m.expiredShort : m.expired}
        {onRefresh && (
          <>
            {' '}
            <button type="button" className="btn btn-secondary" onClick={onRefresh}>
              {m.refresh}
            </button>
          </>
        )}
      </span>
    );
  }
  const label = remainingLabel(expiresAt, now);
  const soon = minutes < EXPIRING_SOON_MINUTES;
  return (
    <span className="approval-remaining">
      {short ? label : m.withExpiry(label, formatDateTime(expiresAt))}
      {soon && (
        <>
          {' '}
          <SeverityBadge severity="WARNING" label={m.soonBadge} />
        </>
      )}
    </span>
  );
}
