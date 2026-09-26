import type { CustomerCard } from '@chat-bot/shared-types';
import { MESSAGES } from '../../constants/messages';
import { formatDateTime } from '../../lib/date';

/**
 * OI-2 고객 카드(`omnichannel-inbox-ui-spec.md` §2.3 `CustomerCardPanel`) — 사실 목록(문장 생성 0).
 */
export function CustomerCardPanel({ card }: { card: CustomerCard }): JSX.Element {
  const msg = MESSAGES.inbox;
  return (
    <section className="settings-card customer-card-panel">
      <p>{msg.cardConversations(card.conversations.total)}</p>
      <p>{msg.cardChatbotsCount(card.conversations.byChatbot.length)}</p>
      <p>
        {msg.cardFirstActivity}: {card.firstActivityAt ? formatDateTime(card.firstActivityAt) : '—'}
      </p>
      <p>
        {msg.cardLastActivity}: {card.lastActivityAt ? formatDateTime(card.lastActivityAt) : '—'}
      </p>
      {card.topMatches.length > 0 && (
        <p>
          {msg.cardTopMatches}: {card.topMatches.map((m) => `${m.name}(${m.count})`).join(', ')}
        </p>
      )}
      <p>{msg.cardUnanswered(card.unansweredTurns)}</p>
      <p>{msg.cardHandoffs(card.handoffs.count, card.handoffs.lastEndReason, card.handoffs.lastAgentName)}</p>
      <p>
        {msg.cardSurveys(card.surveysCompleted)} · {msg.cardNegativeFeedback(card.negativeFeedbacks)}
      </p>
      {card.tags.length > 0 && (
        <p>
          {msg.cardTagsLabel}: {card.tags.map((t) => t.name).join(', ')}
        </p>
      )}
      {card.latestNote && (
        <p>
          {msg.cardLatestNote}: "{card.latestNote.text}"
        </p>
      )}
    </section>
  );
}
