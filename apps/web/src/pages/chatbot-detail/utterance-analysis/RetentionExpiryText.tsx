import { MESSAGES } from '../../../constants/messages';
import { toKstDateInputValue } from '../../../lib/date';

/** 보존 만료 글자 — 7일 이내면 "곧 삭제됩니다"를 글자로 병기하고, 지났으면 그대로 알린다(색 단독 금지). */
export function RetentionExpiryText({ expiresAt, now }: { expiresAt: string | Date; now: Date }): JSX.Element {
  const msg = MESSAGES.utteranceAnalysis;
  const expires = new Date(expiresAt);
  const date = toKstDateInputValue(expires);
  const msLeft = expires.getTime() - now.getTime();
  if (msLeft < 0) return <span>{msg.expiryPassed}</span>;
  const daysLeft = Math.max(1, Math.ceil(msLeft / 86_400_000));
  if (daysLeft <= 7) return <span className="ua-expiry-soon">{msg.expirySoon(date, daysLeft)}</span>;
  return <span>{msg.expiryDate(date)}</span>;
}
