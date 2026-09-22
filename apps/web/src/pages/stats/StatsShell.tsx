import { useCallback, useEffect, useState } from 'react';
import { NavLink, Outlet, useOutletContext } from 'react-router-dom';
import type { UnansweredQuestionSummary } from '@chat-bot/shared-types';
import { useChatbotDetailContext, type ChatbotDetailContext } from '../ChatbotDetailLayout';
import { useAuth } from '../../context/AuthContext';
import { learningApi } from '../../api/learning';
import { MESSAGES } from '../../constants/messages';
import { NavPendingBadge } from './NavPendingBadge';

export interface StatsShellContext extends ChatbotDetailContext {
  learningSummary: UnansweredQuestionSummary | null;
  refreshLearningSummary: () => void;
}

export function useStatsShellContext(): StatsShellContext {
  return useOutletContext<StatsShellContext>();
}

/**
 * T0 — 통계 셸(stats-learning-ui-spec.md §1.3, §2.1). `DialogueShell`과 동일하게 "탭 1개 +
 * 내부 서브내비 N개" 패턴을 재사용한다. 서브내비는 좌측 레일이 아니라 가로 스트립(항목 2개뿐이라).
 */
export function StatsShell(): JSX.Element {
  const ctx = useChatbotDetailContext();
  const { chatbot } = ctx;
  const { can } = useAuth();
  const [learningSummary, setLearningSummary] = useState<UnansweredQuestionSummary | null>(null);

  const refreshLearningSummary = useCallback(() => {
    if (!can('dialogue:read')) return;
    learningApi
      .summary(chatbot.id)
      .then(setLearningSummary)
      .catch(() => {
        // 배지·배너는 보조 정보다 — 실패해도 화면 전체를 막지 않는다.
      });
  }, [chatbot.id, can]);

  useEffect(() => {
    refreshLearningSummary();
  }, [refreshLearningSummary]);

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
            {MESSAGES.statsShell.tabLearning} <NavPendingBadge count={learningSummary?.pendingCount ?? 0} />
          </NavLink>
        )}
      </nav>
      <div className="stats-content">
        <Outlet context={{ ...ctx, learningSummary, refreshLearningSummary } satisfies StatsShellContext} />
      </div>
    </div>
  );
}
