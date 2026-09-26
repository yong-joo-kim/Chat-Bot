import { Link, Outlet, useLocation } from 'react-router-dom';
import { MESSAGES } from '../../../constants/messages';

/**
 * G1~G1-c 공용 탭 셸(`data-governance-ui-spec.md` §3.1.1) — "데이터 지도"/"보존 정책"/"파기 이력"
 * 3개 서브라우트를 묶는다. `SurveyTabs.tsx` 선례와 동일한 `role="tablist"` 패턴을 쓴다.
 */
export function DataGovernanceShell(): JSX.Element {
  const msg = MESSAGES.dataGovernance;
  const { pathname } = useLocation();

  const tabs: { href: string; label: string; match: (p: string) => boolean }[] = [
    { href: '/settings/data-governance/map', label: msg.tabMap, match: (p) => p === '/settings/data-governance' || p.endsWith('/map') },
    { href: '/settings/data-governance/retention', label: msg.tabRetention, match: (p) => p.endsWith('/retention') },
    { href: '/settings/data-governance/purge-history', label: msg.tabPurgeHistory, match: (p) => p.endsWith('/purge-history') },
  ];

  return (
    <div className="data-governance-shell settings-page">
      <h1>{MESSAGES.systemSettings.dataGovernance}</h1>
      <div className="tab-nav" role="tablist" aria-label={MESSAGES.systemSettings.dataGovernance}>
        {tabs.map((tab) => {
          const active = tab.match(pathname);
          return (
            <span key={tab.href} role="tab" aria-selected={active} className={`tab-link${active ? ' tab-link--active' : ''}`}>
              <Link to={tab.href}>{tab.label}</Link>
            </span>
          );
        })}
      </div>
      <div className="data-governance-content">
        <Outlet />
      </div>
    </div>
  );
}
