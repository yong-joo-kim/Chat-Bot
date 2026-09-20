import { MESSAGES } from '../../../constants/messages';
import { SeverityBadge } from '../../../components/SeverityBadge';

/** `allowedOrigins` 빈 배열 경고 배지(FR-11-9, AC-11-7). */
export function OriginAllowAllBadge(): JSX.Element {
  return <SeverityBadge severity="WARNING" label={MESSAGES.channels.allOriginsWarning} />;
}
