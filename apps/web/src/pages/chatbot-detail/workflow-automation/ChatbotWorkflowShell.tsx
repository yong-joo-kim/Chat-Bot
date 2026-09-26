import { NavLink, Outlet } from 'react-router-dom';
import { useChatbotDetailContext } from '../../ChatbotDetailLayout';
import { useAuth } from '../../../context/AuthContext';
import { ForbiddenState } from '../../../components/security/ForbiddenState';
import { MESSAGES } from '../../../constants/messages';

/**
 * WF3~WF3-b — 챗봇 스코프 2서브탭(이벤트 구독/실행 이력) 셸(`workflow-automation-ui-spec.md` §2.3
 * `ChatbotWorkflowShell`, `StatsShell`과 동형). 조회는 `chatbot:read` **AND** `dialogue:read`가 모두
 * 필요하다(R-9 — AGENT는 `chatbot:read`만 있어 배제된다).
 */
export function ChatbotWorkflowShell(): JSX.Element {
  const { chatbot } = useChatbotDetailContext();
  const { can } = useAuth();
  const msg = MESSAGES.workflowSubscriptions;

  if (!can('chatbot:read') || !can('dialogue:read')) {
    return <ForbiddenState menuName={MESSAGES.detail.tabWorkflowAutomation} />;
  }

  const subNavClassName = ({ isActive }: { isActive: boolean }): string =>
    `stats-subnav-link${isActive ? ' stats-subnav-link--active' : ''}`;

  return (
    <div className="chatbot-workflow-shell">
      <nav className="stats-subnav" aria-label={MESSAGES.detail.tabWorkflowAutomation}>
        <NavLink to={`/chatbots/${chatbot.id}/workflow-automation/subscriptions`} className={subNavClassName}>
          {msg.tabSubscriptions}
        </NavLink>
        <NavLink to={`/chatbots/${chatbot.id}/workflow-automation/runs`} className={subNavClassName}>
          {msg.tabRuns}
        </NavLink>
      </nav>
      <div className="stats-content">
        <Outlet />
      </div>
    </div>
  );
}
