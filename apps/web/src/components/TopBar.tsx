import { useEffect, useState, type MouseEvent } from 'react';
import { Link } from 'react-router-dom';
import { MESSAGES } from '../constants/messages';
import { useUnsavedGuard } from '../context/UnsavedGuardContext';
import { useAuth } from '../context/AuthContext';
import { handoffApi } from '../api/handoff';
import { inboxApi } from '../api/inbox';
import { ApiError } from '../api/client';
import { SystemSettingsMenu } from './security/SystemSettingsMenu';
import { UserMenu } from './security/UserMenu';

const MY_ACTIVE_COUNT_POLL_MS = 60000;
const INBOX_SUMMARY_POLL_MS = 60000;

/** F-1: 로그인 화면(L1)/부팅 게이트에서는 `AuthContext.user`가 없으므로 이 컴포넌트 자체가 렌더되지 않는다. */
export function TopBar(): JSX.Element | null {
  const { confirmNavigation } = useUnsavedGuard();
  const { user, can } = useAuth();

  // AC-3-8: 상세 탭에 저장하지 않은 변경 사항이 있으면 TopBar의 "챗봇 목록" 이동도 확인 다이얼로그로 가로챈다.
  function handleChatbotListClick(e: MouseEvent<HTMLAnchorElement>): void {
    if (!confirmNavigation()) e.preventDefault();
  }

  // [No.24] N1-ext — "내 상담 n건" 배지(`cs:read`가 있을 때만, 60초 간격·탭 비활성 시 중단,
  // `SystemSettingsMenu`의 예약 배포 "확인 필요" 배지와 동일한 패턴, hybrid-cs-ui-spec.md §3.9).
  const canSeeMonitoring = can('cs:read');
  const [myActiveCount, setMyActiveCount] = useState(0);
  useEffect(() => {
    if (!canSeeMonitoring) return undefined;
    let cancelled = false;
    function fetchCount(): void {
      handoffApi
        .consoleChatbots()
        .then((res) => {
          if (!cancelled) setMyActiveCount(res.myActiveCount);
        })
        .catch(() => undefined);
    }
    fetchCount();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') fetchCount();
    }, MY_ACTIVE_COUNT_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [canSeeMonitoring]);

  // [신규 No.42] OI-13 — "통합 인박스" 진입점(`cs:read` 게이트 + `GET /inbox/threads/summary`가 404이면
  // 기능 꺼짐으로 보고 링크 자체를 숨긴다, omnichannel-inbox-ui-spec.md §3.13).
  const canSeeInboxPermission = can('cs:read');
  const [inboxEnabled, setInboxEnabled] = useState(false);
  const [inboxMine, setInboxMine] = useState(0);
  useEffect(() => {
    if (!canSeeInboxPermission) return undefined;
    let cancelled = false;
    function fetchSummary(): void {
      inboxApi
        .summary()
        .then((res) => {
          if (cancelled) return;
          setInboxEnabled(true);
          setInboxMine(res.mine);
        })
        .catch((e) => {
          if (cancelled) return;
          if (e instanceof ApiError && e.status === 404) setInboxEnabled(false);
        });
    }
    fetchSummary();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') fetchSummary();
    }, INBOX_SUMMARY_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [canSeeInboxPermission]);
  const canSeeInbox = canSeeInboxPermission && inboxEnabled;

  if (!user) return null;

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
          {/* [No.24] N1-ext — `cs:read`가 없으면(VIEWER) 링크 자체를 렌더하지 않는다(F-4 숨김 원칙). */}
          {canSeeMonitoring && (
            <Link to="/handoff-console">
              {MESSAGES.common.monitoringNav}
              {myActiveCount > 0 && ` (${MESSAGES.handoffConsole.myActiveCount(myActiveCount)})`}
            </Link>
          )}
          {/* [신규 No.42] OI-13 */}
          {canSeeInbox && (
            <Link to="/inbox">
              {MESSAGES.common.inboxNav}
              {inboxMine > 0 && ` (${MESSAGES.inbox.myAssignedCount(inboxMine)})`}
            </Link>
          )}
        </nav>
        <div className="top-bar-actions">
          <SystemSettingsMenu />
          <UserMenu />
        </div>
      </header>
    </>
  );
}
