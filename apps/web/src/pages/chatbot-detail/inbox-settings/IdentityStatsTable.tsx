import type { ChatbotInboxSettingsResponse } from '@chat-bot/shared-types';
import { MESSAGES } from '../../../constants/messages';

/** OI-9 최근 24시간 식별 현황(`omnichannel-inbox-ui-spec.md` §2.3 `IdentityStatsTable`, "이 서버 기준"). */
export function IdentityStatsTable({ stats24h }: { stats24h: ChatbotInboxSettingsResponse['identity']['stats24h'] }): JSX.Element {
  const msg = MESSAGES.inboxSettings;
  const f = stats24h.failures;
  return (
    <div className="identity-stats-table">
      <h4>{msg.stats24hTitle}</h4>
      <p>
        {msg.statVerified} {stats24h.verified} · {msg.statSignature} {f.SIGNATURE} · {msg.statExpired} {f.EXPIRED} · {msg.statMalformed} {f.MALFORMED} ·{' '}
        {msg.statConflict} {f.CONFLICT} · {msg.statSecretMissing} {f.SECRET_MISSING} · {msg.statTtlTooLong} {f.TTL_TOO_LONG} · {msg.statNotYetValid} {f.NOT_YET_VALID}
      </p>
    </div>
  );
}
