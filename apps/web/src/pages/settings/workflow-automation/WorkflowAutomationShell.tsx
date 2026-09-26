import { Link, Outlet, useLocation } from 'react-router-dom';
import { MESSAGES } from '../../../constants/messages';

/**
 * WF1~WF1-c 공용 탭 셸(`workflow-automation-ui-spec.md` §2.3) — "발송 대상"/"실행 이력"/"요약"
 * 3개 서브라우트를 묶는다. `DataGovernanceShell`과 동형의 `role="tablist"` 패턴을 그대로 쓴다.
 */
export function WorkflowAutomationShell(): JSX.Element {
  const msg = MESSAGES.workflowTargets;
  const { pathname } = useLocation();

  const tabs: { href: string; label: string; match: (p: string) => boolean }[] = [
    { href: '/settings/workflow-automation/targets', label: msg.tabTargets, match: (p) => p === '/settings/workflow-automation' || p.endsWith('/targets') },
    { href: '/settings/workflow-automation/runs', label: msg.tabRuns, match: (p) => p.endsWith('/runs') },
    { href: '/settings/workflow-automation/summary', label: msg.tabSummary, match: (p) => p.endsWith('/summary') },
  ];

  return (
    <div className="workflow-automation-shell settings-page">
      <h1>{MESSAGES.systemSettings.workflowAutomation}</h1>
      <div className="tab-nav" role="tablist" aria-label={MESSAGES.systemSettings.workflowAutomation}>
        {tabs.map((tab) => {
          const active = tab.match(pathname);
          return (
            <span key={tab.href} role="tab" aria-selected={active} className={`tab-link${active ? ' tab-link--active' : ''}`}>
              <Link to={tab.href}>{tab.label}</Link>
            </span>
          );
        })}
      </div>
      <div className="workflow-automation-content">
        <Outlet />
      </div>
    </div>
  );
}
