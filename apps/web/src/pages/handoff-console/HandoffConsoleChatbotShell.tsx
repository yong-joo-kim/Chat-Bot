import { useEffect, useState } from 'react';
import { NavLink, Outlet, useOutletContext, useParams } from 'react-router-dom';
import type { Chatbot } from '@chat-bot/shared-types';
import { chatbotsApi } from '../../api/chatbots';
import { ApiError } from '../../api/client';
import { ErrorState } from '../../components/ErrorState';
import { MESSAGES } from '../../constants/messages';

export interface HandoffConsoleChatbotContext {
  chatbotId: string;
  chatbotName: string;
}

export function useHandoffConsoleChatbotContext(): HandoffConsoleChatbotContext {
  return useOutletContext<HandoffConsoleChatbotContext>();
}

/**
 * `/handoff-console/:chatbotId/*` 공통 헤더 + "진행 중 세션"/"상담 이력" 탭(hybrid-cs-ui-spec.md
 * §1 HC1/HC3 상단 탭). `ChatbotDetailLayout`(TabNav 소속) 밖의 독립 라우트 트리다(§0.2).
 */
export function HandoffConsoleChatbotShell(): JSX.Element {
  const { chatbotId } = useParams<{ chatbotId: string }>();
  const [chatbot, setChatbot] = useState<Chatbot | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!chatbotId) return;
    chatbotsApi
      .findOne(chatbotId)
      .then(setChatbot)
      .catch((e) => {
        if (e instanceof ApiError && e.status === 404) setNotFound(true);
      });
  }, [chatbotId]);

  if (!chatbotId) return <ErrorState title={MESSAGES.errors.notFoundChatbot} />;
  if (notFound) return <ErrorState title={MESSAGES.errors.notFoundChatbot} />;

  const tabClassName = ({ isActive }: { isActive: boolean }): string =>
    `stats-subnav-link${isActive ? ' stats-subnav-link--active' : ''}`;

  return (
    <div className="handoff-console-chatbot-shell">
      <nav className="stats-subnav" aria-label={MESSAGES.handoffConsole.pickerTitle}>
        <NavLink to={`/handoff-console/${chatbotId}/live`} className={tabClassName}>
          {MESSAGES.handoffConsole.liveTabLabel}
        </NavLink>
        <NavLink to={`/handoff-console/${chatbotId}/history`} className={tabClassName}>
          {MESSAGES.handoffConsole.historyTabLabel}
        </NavLink>
      </nav>
      <div className="handoff-console-content">
        <Outlet context={{ chatbotId, chatbotName: chatbot?.name ?? '' } satisfies HandoffConsoleChatbotContext} />
      </div>
    </div>
  );
}
