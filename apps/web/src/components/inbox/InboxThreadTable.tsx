import { Link } from 'react-router-dom';
import type { InboxThreadListItem, RecordChannel } from '@chat-bot/shared-types';
import { MESSAGES } from '../../constants/messages';
import { formatDateTime } from '../../lib/date';
import { ChannelFamilyBadge, CustomerKindBadge, InboxThreadStatusBadge } from './badges';

function CustomerCell({ item }: { item: InboxThreadListItem }): JSX.Element {
  return (
    <>
      <bdi>{item.customer.displayName ?? item.customer.alias}</bdi> <CustomerKindBadge kind={item.customer.kind} />
    </>
  );
}

function LastChannelCell({ item }: { item: InboxThreadListItem }): JSX.Element {
  const msg = MESSAGES.inbox;
  if (!item.lastChannel) return <>{item.noParticipatingChatbot ? msg.noParticipatingChatbotBadge : '—'}</>;
  const { family, label } = item.lastChannel;
  return (
    <>
      {family === 'RECORD' ? (
        <ChannelFamilyBadge family="RECORD" recordChannel={item.lastChannel.type as RecordChannel} />
      ) : family === 'SIMULATED' ? (
        <ChannelFamilyBadge family="SIMULATED" label={label} />
      ) : (
        <ChannelFamilyBadge family="DEPLOY" label={label} />
      )}
      {item.lastChatbot && ` / ${item.lastChatbot.name}`}
    </>
  );
}

function PreviewCell({ item }: { item: InboxThreadListItem }): JSX.Element {
  if (item.lastEntryPurged) return <span className="purged-text">{MESSAGES.inbox.purgedEntryNotice}</span>;
  return <>{item.lastEntryPreview ?? '—'}</>;
}

/**
 * OI-1 목록(`omnichannel-inbox-ui-spec.md` §2.3 `InboxThreadTable`) — 데스크톱 표 + `<640px` 카드
 * 리스트 이중 렌더(`LiveSessionTable` 패턴).
 */
export function InboxThreadTable({ items }: { items: InboxThreadListItem[] }): JSX.Element {
  const msg = MESSAGES.inbox;
  return (
    <div className="live-session-table-responsive">
      <div className="import-report-table-wrap live-session-table--wide">
        <table className="import-report-table">
          <thead>
            <tr>
              <th scope="col">{msg.columnCustomer}</th>
              <th scope="col">{msg.columnStatus}</th>
              <th scope="col">{msg.columnAssignee}</th>
              <th scope="col">{msg.columnTags}</th>
              <th scope="col">{msg.columnLastChannel}</th>
              <th scope="col">{msg.columnConversations}</th>
              <th scope="col">{msg.columnHandoffs}</th>
              <th scope="col">{msg.columnLastActivity}</th>
              <th scope="col">{msg.columnPreview}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.threadId}>
                <td>
                  <Link to={`/inbox/${item.threadId}`}>
                    <CustomerCell item={item} />
                  </Link>
                </td>
                <td>
                  <InboxThreadStatusBadge status={item.status} snoozeUntil={item.snoozeUntil} snoozeExpired={item.snoozeExpired} />
                </td>
                <td>{item.assignee ? `${item.assignee.name}${!item.assignee.active ? ` (${msg.assigneeInactiveBadge})` : ''}` : '—'}</td>
                <td>{item.tags.length > 0 ? item.tags.map((t) => t.name).join(', ') : '—'}</td>
                <td>
                  <LastChannelCell item={item} />
                </td>
                <td>{item.linkedConversationCount}</td>
                <td>{item.activeHandoffCount > 0 ? msg.handoffInProgressBadge(item.activeHandoffCount) : 0}</td>
                <td>{formatDateTime(item.lastActivityAt)}</td>
                <td>
                  <PreviewCell item={item} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="live-session-card-list">
        {items.map((item) => (
          <li key={item.threadId} className="live-session-card">
            <Link to={`/inbox/${item.threadId}`} className="live-session-card-link">
              <div className="live-session-card-header">
                <CustomerCell item={item} />
                <InboxThreadStatusBadge status={item.status} snoozeUntil={item.snoozeUntil} snoozeExpired={item.snoozeExpired} />
              </div>
              <p className="live-session-card-message">
                <PreviewCell item={item} />
              </p>
              <p className="field-hint">
                {formatDateTime(item.lastActivityAt)} · <LastChannelCell item={item} /> · {item.assignee ? item.assignee.name : msg.assigneeNone}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
