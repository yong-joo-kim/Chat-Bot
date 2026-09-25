import { NavLink, Outlet, useOutletContext } from 'react-router-dom';
import { useChatbotDetailContext, type ChatbotDetailContext } from '../ChatbotDetailLayout';
import { useAuth } from '../../context/AuthContext';
import { MESSAGES } from '../../constants/messages';
import { NavPendingBadge } from './NavPendingBadge';
import { NegativeFeedbackNavBadge } from './NegativeFeedbackNavBadge';

/**
 * [No.44 R2] 학습현황 요약(`learningSummary`/`refreshLearningSummary`)은 더 이상 이 컴포넌트가 직접
 * 조회하지 않는다 — `ChatbotDetailLayout`(TabNav·StatsShell·LearningQueuePage의 공통 부모)이 챗봇
 * 상세 마운트당 1회만 조회해 `ChatbotDetailContext`로 내려준다. `StatsShellContext`는 그 값을 그대로
 * 하위(`LearningQueuePage`)에 전달하기 위한 통로일 뿐이라 별도로 추가하는 필드가 없다.
 */
export type StatsShellContext = ChatbotDetailContext;

export function useStatsShellContext(): StatsShellContext {
  return useOutletContext<StatsShellContext>();
}

/**
 * T0 — 통계 셸(stats-learning-ui-spec.md §1.3, §2.1). `DialogueShell`과 동일하게 "탭 1개 +
 * 내부 서브내비 N개" 패턴을 재사용한다. 서브내비는 좌측 레일이 아니라 가로 스트립(항목 2개뿐이라).
 */
export function StatsShell(): JSX.Element {
  const ctx = useChatbotDetailContext();
  const { chatbot, learningSummary } = ctx;
  const { can } = useAuth();

  const subNavClassName = ({ isActive }: { isActive: boolean }): string =>
    `stats-subnav-link${isActive ? ' stats-subnav-link--active' : ''}`;

  return (
    <div className="stats-shell">
      <nav className="stats-subnav" aria-label={MESSAGES.statsShell.subNavLabel}>
        {can('chatbot:read') && (
          <NavLink to={`/chatbots/${chatbot.id}/stats/overview`} className={subNavClassName}>
            {MESSAGES.statsShell.tabOverview}
          </NavLink>
        )}
        {can('dialogue:read') && (
          <NavLink to={`/chatbots/${chatbot.id}/stats/learning`} className={subNavClassName}>
            {MESSAGES.statsShell.tabLearning}{' '}
            {/* [No.44] 기존 "미응답 대기" 배지는 의미를 바꾸지 않는다 — bySource.UNANSWERED만 센다
                (합계 pendingCount 아님, feedback-loop-ui-spec.md §3.5). 부정 평가는 별도 배지로 표시한다. */}
            <NavPendingBadge count={learningSummary?.bySource?.UNANSWERED?.pendingCount ?? 0} />{' '}
            <NegativeFeedbackNavBadge count={learningSummary?.bySource?.NEGATIVE_FEEDBACK?.pendingCount ?? 0} />
          </NavLink>
        )}
        {/* [No.26] L1 외부 연동 로그 — `chatbot:read`(세 역할 전부, legacy-api-integration-ui-spec.md §1). */}
        {can('chatbot:read') && (
          <NavLink to={`/chatbots/${chatbot.id}/stats/api-calls`} className={subNavClassName}>
            {MESSAGES.apiCallLogs.tabLabel}
          </NavLink>
        )}
      </nav>
      <div className="stats-content">
        <Outlet context={ctx satisfies StatsShellContext} />
      </div>
    </div>
  );
}
