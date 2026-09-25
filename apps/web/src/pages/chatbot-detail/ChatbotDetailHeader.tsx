import type { MouseEvent } from 'react';
import { Link } from 'react-router-dom';
import type { Chatbot, EnvironmentStatus } from '@chat-bot/shared-types';
import { Avatar } from '../../components/Avatar';
import { StatusBadge } from '../../components/StatusBadge';
import { EnvironmentHeaderBadge } from '../../components/EnvironmentHeaderBadge';
import { useAuth } from '../../context/AuthContext';
import { MESSAGES } from '../../constants/messages';

export function ChatbotDetailHeader({
  chatbot,
  groupName,
  environmentStatus,
  onBeforeNavigate,
}: {
  chatbot: Chatbot;
  groupName?: string;
  /** [No.40] 헤더 환경 배지용(§4.17) — 모드 꺼짐이면 배지가 렌더되지 않는다. */
  environmentStatus?: EnvironmentStatus | null;
  onBeforeNavigate?: () => boolean;
}): JSX.Element {
  const { can } = useAuth();

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
        <EnvironmentHeaderBadge chatbotId={chatbot.id} status={environmentStatus ?? null} />
        {groupName && <span className="detail-header-group">{groupName}</span>}
        <span className="detail-header-slug">{chatbot.slug}</span>
        {/* FR-13-23: 7번째 탭을 추가하지 않는다(security-audit-ui-spec.md §4.3) — 대신 헤더의 소형 링크. */}
        {can('audit:read') && (
          <Link
            to={`/settings/audit-logs?chatbotId=${chatbot.id}&chatbotName=${encodeURIComponent(chatbot.name)}`}
            className="detail-header-audit-link"
          >
            {MESSAGES.systemSettings.changeHistoryLink}
          </Link>
        )}
      </div>
    </div>
  );
}
