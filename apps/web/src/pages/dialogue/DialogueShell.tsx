import { NavLink, Outlet } from 'react-router-dom';
import { useChatbotDetailContext } from '../ChatbotDetailLayout';
import { MESSAGES } from '../../constants/messages';

type SubNavKey = 'nodes' | 'intents' | 'homonyms' | 'contexts' | 'faqs';

const SUBNAV_ITEMS: SubNavKey[] = ['nodes', 'intents', 'homonyms', 'contexts', 'faqs'];

/** D0 — 대화설계 공통 셸(좌측 서브내비 + 본문, ui-spec §3). */
export function DialogueShell(): JSX.Element {
  const ctx = useChatbotDetailContext();
  const { chatbot } = ctx;
  const isArchived = chatbot.status === 'ARCHIVED';

  return (
    <div className="dialogue-shell">
      <nav className="dialogue-subnav" aria-label={MESSAGES.dialogue.subNavLabel}>
        {SUBNAV_ITEMS.map((key) => (
          <NavLink
            key={key}
            to={`/chatbots/${chatbot.id}/dialogue/${key}`}
            className={({ isActive }) => `dialogue-subnav-link${isActive ? ' dialogue-subnav-link--active' : ''}`}
          >
            {MESSAGES.dialogue.subNav[key]}
          </NavLink>
        ))}
      </nav>
      <div className="dialogue-content">
        {isArchived && (
          <div className="archived-banner" role="status">
            <span aria-hidden="true">⚠</span> {MESSAGES.dialogue.archivedBanner}
          </div>
        )}
        {/* 하위 라우트(NodesListPage 등)도 useChatbotDetailContext()로 chatbot/reload/setUnsavedGuard를
            읽으므로, 이 중첩 Outlet에도 동일 컨텍스트를 명시적으로 이어서 전달해야 한다 — react-router의
            useOutletContext()는 "가장 가까운" Outlet의 context만 보고 상위로 자동 전파되지 않는다. */}
        <Outlet context={ctx} />
      </div>
    </div>
  );
}
