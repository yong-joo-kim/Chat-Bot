import type { MouseEvent } from 'react';
import { NavLink } from 'react-router-dom';
import { MESSAGES } from '../../constants/messages';

/** href 기반 탭 링크(UIUX §9, 키보드 포커스 가능). 현재 탭은 밑줄+굵게로 구분(색상 단독 아님). */
export function TabNav({ chatbotId, onBeforeNavigate }: { chatbotId: string; onBeforeNavigate?: () => boolean }): JSX.Element {
  const tabClassName = ({ isActive }: { isActive: boolean }): string =>
    `tab-nav-link${isActive ? ' tab-nav-link--active' : ''}`;

  function handleClick(e: MouseEvent<HTMLAnchorElement>): void {
    if (onBeforeNavigate && !onBeforeNavigate()) e.preventDefault();
  }

  return (
    <nav className="tab-nav" aria-label="챗봇 상세 탭">
      <NavLink to={`/chatbots/${chatbotId}/dashboard`} className={tabClassName} onClick={handleClick}>
        {MESSAGES.detail.tabDashboard}
      </NavLink>
      <NavLink to={`/chatbots/${chatbotId}/settings`} className={tabClassName} onClick={handleClick}>
        {MESSAGES.detail.tabSettings}
      </NavLink>
      <NavLink to={`/chatbots/${chatbotId}/skin`} className={tabClassName} onClick={handleClick}>
        {MESSAGES.detail.tabSkin}
      </NavLink>
      <NavLink to={`/chatbots/${chatbotId}/dialogue`} className={tabClassName} onClick={handleClick}>
        {MESSAGES.dialogue.tabLabel}
      </NavLink>
    </nav>
  );
}
