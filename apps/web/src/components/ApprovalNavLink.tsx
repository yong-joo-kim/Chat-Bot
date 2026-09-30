import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { switchApprovalsApi } from '../api/switchApprovals';
import { useAuth } from '../context/AuthContext';
import { MESSAGES } from '../constants/messages';

const APPROVAL_SUMMARY_POLL_MS = 60000;

/**
 * [신규 No.36] `TopBar` "승인 대기" 진입점(`ai-guardrails-ui-spec.md` §9.8) — `chatbot:deploy`가 없으면 링크 자체를 렌더하지 않는다(F-4 숨김 원칙).
 * `GET /environment-approvals/summary`를 60초 간격으로 조회하고(탭이 보일 때만), 실패는 조용히 무시한다(숫자 없이 링크만 유지).
 * 낭독 소음을 막으려고 `aria-live`를 쓰지 않는다.
 */
export function ApprovalNavLink(): JSX.Element | null {
  const { can } = useAuth();
  const allowed = can('chatbot:deploy');
  const [pendingForMe, setPendingForMe] = useState(0);

  useEffect(() => {
    if (!allowed) return undefined;
    let cancelled = false;
    function fetchSummary(): void {
      switchApprovalsApi
        .summary()
        .then((res) => {
          if (!cancelled) setPendingForMe(res.pendingForMe);
        })
        .catch(() => undefined);
    }
    fetchSummary();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') fetchSummary();
    }, APPROVAL_SUMMARY_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [allowed]);

  if (!allowed) return null;
  return (
    <Link to="/environment-approvals">
      {MESSAGES.common.approvalsNav}
      {pendingForMe > 0 && ` (${pendingForMe})`}
    </Link>
  );
}
