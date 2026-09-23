import { NavLink, Outlet } from 'react-router-dom';
import { useChatbotDetailContext } from '../../ChatbotDetailLayout';
import { MESSAGES } from '../../../constants/messages';

/**
 * 9번째 최상위 탭 "대화검증"의 셸(validation-regression-ui-spec.md §1.4) — `StatsShell`과 동일하게
 * "탭 1개 + 얇은 가로 서브내비 2개" 패턴을 재사용한다. 서브내비 항목 자체는 권한으로 숨기지 않는다
 * (둘 다 조회 화면 — `simulation:read` 하나로 충분, §1.5).
 */
export function ValidationShell(): JSX.Element {
  const ctx = useChatbotDetailContext();
  const { chatbot } = ctx;

  const subNavClassName = ({ isActive }: { isActive: boolean }): string =>
    `stats-subnav-link${isActive ? ' stats-subnav-link--active' : ''}`;

  return (
    <div className="stats-shell">
      <nav className="stats-subnav" aria-label={MESSAGES.validation.shell.subNavLabel}>
        <NavLink to={`/chatbots/${chatbot.id}/validation/sets`} className={subNavClassName}>
          {MESSAGES.validation.shell.tabSets}
        </NavLink>
        <NavLink to={`/chatbots/${chatbot.id}/validation/runs`} className={subNavClassName}>
          {MESSAGES.validation.shell.tabRuns}
        </NavLink>
      </nav>
      <div className="stats-content">
        {chatbot.status === 'ARCHIVED' && (
          <div className="archived-banner" role="status">
            <span aria-hidden="true">⚠</span> {MESSAGES.validation.common.archivedBanner}
          </div>
        )}
        <Outlet context={ctx} />
      </div>
    </div>
  );
}
