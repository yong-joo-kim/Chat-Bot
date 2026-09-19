import { NavLink, Outlet } from 'react-router-dom';
import { useChatbotDetailContext } from '../ChatbotDetailLayout';
import { MESSAGES } from '../../constants/messages';

type SubNavKey = 'nodes' | 'intents' | 'homonyms' | 'contexts' | 'faqs';

const SUBNAV_ITEMS: SubNavKey[] = ['nodes', 'intents', 'homonyms', 'contexts', 'faqs'];

/** D0 — 대화설계 공통 셸(좌측 서브내비 + 본문, ui-spec §3). */
export function DialogueShell(): JSX.Element {
  const { chatbot } = useChatbotDetailContext();
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
        <Outlet />
      </div>
    </div>
  );
}
