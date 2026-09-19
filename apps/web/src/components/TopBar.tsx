import type { MouseEvent } from 'react';
import { Link } from 'react-router-dom';
import { MESSAGES } from '../constants/messages';
import { useUnsavedGuard } from '../context/UnsavedGuardContext';

export function TopBar(): JSX.Element {
  const { confirmNavigation } = useUnsavedGuard();

  // AC-3-8: 상세 탭에 저장하지 않은 변경 사항이 있으면 TopBar의 "챗봇 목록" 이동도 확인 다이얼로그로 가로챈다.
  function handleChatbotListClick(e: MouseEvent<HTMLAnchorElement>): void {
    if (!confirmNavigation()) e.preventDefault();
  }

  return (
    <>
      {/* UIUX §9: 건너뛰기 링크(본문 바로가기) — 페이지 최초 Tab 시 노출 */}
      <a href="#main-content" className="skip-link">
        {MESSAGES.common.skipToContent}
      </a>
      <header className="top-bar">
        <nav className="top-bar-nav" aria-label="전역 내비게이션">
          <Link to="/" className="top-bar-brand">
            {MESSAGES.common.appName}
          </Link>
          <Link to="/chatbots" onClick={handleChatbotListClick}>
            {MESSAGES.common.chatbotListNav}
          </Link>
        </nav>
      </header>
    </>
  );
}
