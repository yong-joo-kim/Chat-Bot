import { Link, useNavigate } from 'react-router-dom';
import type { ChatbotListItem } from '@chat-bot/shared-types';
import { Avatar } from '../../components/Avatar';
import { StatusBadge } from '../../components/StatusBadge';
import { KebabMenu } from '../../components/KebabMenu';
import { SkeletonCard } from '../../components/Skeleton';
import { formatDateTime } from '../../lib/date';
import { MESSAGES } from '../../constants/messages';
import type { ChatbotRowAction } from './ChatbotTable';

export interface ChatbotCardListProps {
  items: ChatbotListItem[];
  loading: boolean;
  onAction: (action: ChatbotRowAction, chatbot: ChatbotListItem) => void;
}

/** 모바일 카드 목록(<640px, ui-spec §8). 테이블과 동일한 정보를 라벨+값 스택으로 표시한다. */
export function ChatbotCardList({ items, loading, onAction }: ChatbotCardListProps): JSX.Element {
  const navigate = useNavigate();

  if (loading) {
    return (
      <div className="chatbot-card-list mobile-only">
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>
    );
  }

  return (
    <ul className="chatbot-card-list mobile-only">
      {items.map((chatbot) => (
        <li key={chatbot.id} className="chatbot-card">
          <div className="chatbot-card-header">
            <Avatar name={chatbot.name} avatarUrl={chatbot.avatarUrl} size={36} />
            <Link to={`/chatbots/${chatbot.id}/settings`} className="chatbot-card-name">
              {chatbot.name}
            </Link>
            <StatusBadge status={chatbot.status} size="sm" />
          </div>
          <dl className="chatbot-card-fields">
            <div>
              <dt>{MESSAGES.chatbot.columnSlug}</dt>
              <dd>{chatbot.slug}</dd>
            </div>
            <div>
              <dt>{MESSAGES.chatbot.columnGroup}</dt>
              <dd>{chatbot.groupName}</dd>
            </div>
            <div>
              <dt>{MESSAGES.chatbot.columnUpdatedAt}</dt>
              <dd>{formatDateTime(chatbot.updatedAt)}</dd>
            </div>
          </dl>
          <div className="chatbot-card-actions">
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
          </div>
        </li>
      ))}
    </ul>
  );
}
