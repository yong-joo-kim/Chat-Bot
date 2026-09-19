import { Link, useNavigate } from 'react-router-dom';
import type { ChatbotListItem } from '@chat-bot/shared-types';
import { Avatar } from '../../components/Avatar';
import { StatusBadge } from '../../components/StatusBadge';
import { KebabMenu } from '../../components/KebabMenu';
import { SkeletonRow } from '../../components/Skeleton';
import { formatDateTime } from '../../lib/date';
import { MESSAGES } from '../../constants/messages';

export type ChatbotRowAction = 'copy' | 'move' | 'archive' | 'permanentDelete';

export interface ChatbotTableProps {
  items: ChatbotListItem[];
  loading: boolean;
  onAction: (action: ChatbotRowAction, chatbot: ChatbotListItem) => void;
}

/** 데스크톱 테이블(ui-spec §3.1). 컬럼: 아바타/이름/slug/상태/소속그룹/수정일시/액션. */
export function ChatbotTable({ items, loading, onAction }: ChatbotTableProps): JSX.Element {
  const navigate = useNavigate();

  return (
    <table className="chatbot-table desktop-only">
      <thead>
        <tr>
          <th scope="col">{MESSAGES.chatbot.columnAvatar}</th>
          <th scope="col">{MESSAGES.chatbot.columnName}</th>
          <th scope="col">{MESSAGES.chatbot.columnSlug}</th>
          <th scope="col">{MESSAGES.chatbot.columnStatus}</th>
          <th scope="col">{MESSAGES.chatbot.columnGroup}</th>
          <th scope="col">{MESSAGES.chatbot.columnUpdatedAt}</th>
          <th scope="col">{MESSAGES.chatbot.columnActions}</th>
        </tr>
      </thead>
      <tbody>
        {loading
          ? Array.from({ length: 5 }).map((_, i) => (
              <tr key={i}>
                <td colSpan={7}>
                  <SkeletonRow />
                </td>
              </tr>
            ))
          : items.map((chatbot) => (
              <tr key={chatbot.id}>
                <td>
                  <Avatar name={chatbot.name} avatarUrl={chatbot.avatarUrl} size={32} />
                </td>
                <td>
                  <Link to={`/chatbots/${chatbot.id}/settings`}>{chatbot.name}</Link>
                </td>
                <td>{chatbot.slug}</td>
                <td>
                  <StatusBadge status={chatbot.status} size="sm" />
                </td>
                <td>{chatbot.groupName}</td>
                <td>{formatDateTime(chatbot.updatedAt)}</td>
                <td>
                  <KebabMenu
                    label={MESSAGES.chatbot.actionsLabel(chatbot.name)}
                    items={[
                      { label: MESSAGES.chatbot.actionSettings, onSelect: () => navigate(`/chatbots/${chatbot.id}/settings`) },
                      { label: MESSAGES.chatbot.actionSkin, onSelect: () => navigate(`/chatbots/${chatbot.id}/skin`) },
                      { label: MESSAGES.chatbot.actionDashboard, onSelect: () => navigate(`/chatbots/${chatbot.id}/dashboard`) },
                      { label: MESSAGES.chatbot.actionCopy, onSelect: () => onAction('copy', chatbot) },
                      { label: MESSAGES.chatbot.actionMove, onSelect: () => onAction('move', chatbot) },
                      { label: MESSAGES.chatbot.actionArchive, onSelect: () => onAction('archive', chatbot) },
                      ...(chatbot.status === 'ARCHIVED'
                        ? [{ label: MESSAGES.chatbot.actionPermanentDelete, onSelect: () => onAction('permanentDelete', chatbot) }]
                        : []),
                    ]}
                  />
                </td>
              </tr>
            ))}
      </tbody>
    </table>
  );
}
