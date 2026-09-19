import type { MouseEvent } from 'react';
import { Link } from 'react-router-dom';
import type { Chatbot } from '@chat-bot/shared-types';
import { Avatar } from '../../components/Avatar';
import { StatusBadge } from '../../components/StatusBadge';
import { MESSAGES } from '../../constants/messages';

export function ChatbotDetailHeader({
  chatbot,
  groupName,
  onBeforeNavigate,
}: {
  chatbot: Chatbot;
  groupName?: string;
  onBeforeNavigate?: () => boolean;
}): JSX.Element {
  function handleBackClick(e: MouseEvent<HTMLAnchorElement>): void {
    if (onBeforeNavigate && !onBeforeNavigate()) e.preventDefault();
  }

  return (
    <div className="detail-header">
      <Link to="/chatbots" className="detail-back-link" onClick={handleBackClick}>
        {MESSAGES.common.backToList}
      </Link>
      <div className="detail-header-main">
        <Avatar name={chatbot.name} avatarUrl={chatbot.avatarUrl} size={40} />
        <h1 className="detail-header-title">{chatbot.name}</h1>
        <StatusBadge status={chatbot.status} />
        {groupName && <span className="detail-header-group">{groupName}</span>}
        <span className="detail-header-slug">{chatbot.slug}</span>
      </div>
    </div>
  );
}
