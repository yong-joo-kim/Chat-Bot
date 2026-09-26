import { useEffect, useState, type MouseEvent } from 'react';
import { NavLink } from 'react-router-dom';
import type { EnvironmentStatus, UnansweredQuestionSummary } from '@chat-bot/shared-types';
import { MESSAGES } from '../../constants/messages';
import { AttentionCountBadge } from '../../components/AttentionCountBadge';
import { EnvironmentModeIndicator } from '../../components/EnvironmentModeIndicator';
import { deploySchedulesApi } from '../../api/deploySchedules';
import { NavPendingBadge } from '../stats/NavPendingBadge';
import { NegativeFeedbackNavBadge } from '../stats/NegativeFeedbackNavBadge';
import { WorkflowAttentionNavBadge } from './workflow-automation/WorkflowAttentionNavBadge';

/**
 * href 기반 탭 링크(UIUX §9, 키보드 포커스 가능). [신규 No.41] 최상위 라우트는 이미 12개를 넘겼고
 * (No.28·No.40이 "배포" 그룹에 최상위 탭을 추가한 선례), 이 그룹은 "업무 자동화"를 13번째 최상위
 * 탭으로 더한다(§13-1 확정 — `legacy-api-integration-ui-spec.md`식 서브탭 흡수 대안은 채택하지 않음).
 * `TabNav` 렌더링은 4개 시각적 그룹(운영/설계/검증/배포)으로 재구성한다(`quality-channel-ui-spec.md` §2).
 * 현재 탭은 밑줄+굵게로 구분(색상 단독 아님).
 */
export function TabNav({
  chatbotId,
  learningSummary,
  environmentStatus,
  workflowAttention,
  onBeforeNavigate,
}: {
  chatbotId: string;
  /**
   * [No.44 R2] "통계" 탭 배지용 학습현황 요약 — `ChatbotDetailLayout`(TabNav·StatsShell·
   * LearningQueuePage의 공통 부모)이 챗봇 상세 마운트당 1회만 조회해 내려준다. `TabNav`는 더 이상
   * 자체적으로 `learningApi.summary()`를 호출하지 않는다(중복 요청 제거 + 반영/무시/되돌리기 등
   * 액션 뒤 `StatsSubNav` 배지와 항상 같은 값을 보여주기 위함).
   */
  learningSummary: UnansweredQuestionSummary | null;
  /** [No.40] "환경" 탭의 소형 점 표시용(§1.4) — `ChatbotDetailLayout`이 내려주는 공유 상태. */
  environmentStatus: EnvironmentStatus | null;
  /**
   * [신규 No.41] "업무 자동화" 탭 배지용 — `ChatbotDetailLayout`이 내려주는 공유 상태(§3.13).
   * 선택 prop(기존 스펙 테스트가 이 값 없이 렌더해도 무수정 통과하도록 기본값 `null`을 쓴다).
   */
  workflowAttention?: { count: number } | null;
  onBeforeNavigate?: () => boolean;
}): JSX.Element {
  const tabClassName = ({ isActive }: { isActive: boolean }): string =>
    `tab-nav-link${isActive ? ' tab-nav-link--active' : ''}`;

  function handleClick(e: MouseEvent<HTMLAnchorElement>): void {
    if (onBeforeNavigate && !onBeforeNavigate()) e.preventDefault();
  }

  // No.28: "예약 배포" 탭의 "확인 필요" 배지 — 전역 요약에서 이 챗봇 건수만 추출한다
  // (챗봇 스코프 집계 엔드포인트가 없어 `/deploy-schedules/summary`를 재사용, §1.5).
  const [needsAttentionCount, setNeedsAttentionCount] = useState(0);
  useEffect(() => {
    let cancelled = false;
    deploySchedulesApi
      .summary()
      .then((res) => {
        if (cancelled) return;
        const count = res.needsAttention.byChatbot.find((c) => c.chatbotId === chatbotId)?.count ?? 0;
        setNeedsAttentionCount(count);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [chatbotId]);

  // [No.44 R2] "통계" 탭 배지(feedback-loop-ui-spec.md §3.5) — `StatsSubNav`(StatsShell)와 동일한
  // 판단(두 소스 `bySource.UNANSWERED`/`NEGATIVE_FEEDBACK`을 따로 보여주고, 합계 `pendingCount`는
  // 쓰지 않는다)을 부모가 내려준 `learningSummary`에서 파생한다. 조회 자체(권한 판단·실패 시 생략 포함)는
  // `ChatbotDetailLayout`의 책임이다.
  const learningPendingCounts = {
    unanswered: learningSummary?.bySource?.UNANSWERED?.pendingCount ?? 0,
    negativeFeedback: learningSummary?.bySource?.NEGATIVE_FEEDBACK?.pendingCount ?? 0,
  };

  return (
    <nav className="tab-nav" aria-label="챗봇 상세 탭">
      <div className="tab-nav-group" role="group" aria-label={MESSAGES.detail.tabGroupOps}>
        <span className="tab-nav-group-caption" aria-hidden="true">
          {MESSAGES.detail.tabGroupOps}
        </span>
        <NavLink to={`/chatbots/${chatbotId}/dashboard`} className={tabClassName} onClick={handleClick}>
          {MESSAGES.detail.tabDashboard}
        </NavLink>
        <NavLink to={`/chatbots/${chatbotId}/stats`} className={tabClassName} onClick={handleClick}>
          {MESSAGES.detail.tabStats} <NavPendingBadge count={learningPendingCounts.unanswered} />{' '}
          <NegativeFeedbackNavBadge count={learningPendingCounts.negativeFeedback} />
        </NavLink>
        <NavLink to={`/chatbots/${chatbotId}/settings`} className={tabClassName} onClick={handleClick}>
          {MESSAGES.detail.tabSettings}
        </NavLink>
        <NavLink to={`/chatbots/${chatbotId}/versions`} className={tabClassName} onClick={handleClick}>
          {MESSAGES.detail.tabVersions}
        </NavLink>
      </div>
      <span className="tab-nav-divider" aria-hidden="true" />
      <div className="tab-nav-group" role="group" aria-label={MESSAGES.detail.tabGroupDesign}>
        <span className="tab-nav-group-caption" aria-hidden="true">
          {MESSAGES.detail.tabGroupDesign}
        </span>
        <NavLink to={`/chatbots/${chatbotId}/dialogue`} className={tabClassName} onClick={handleClick}>
          {MESSAGES.dialogue.tabLabel}
        </NavLink>
      </div>
      <span className="tab-nav-divider" aria-hidden="true" />
      <div className="tab-nav-group" role="group" aria-label={MESSAGES.detail.tabGroupVerify}>
        <span className="tab-nav-group-caption" aria-hidden="true">
          {MESSAGES.detail.tabGroupVerify}
        </span>
        <NavLink to={`/chatbots/${chatbotId}/answer-settings`} className={tabClassName} onClick={handleClick}>
          {MESSAGES.detail.tabAnswerSettings}
        </NavLink>
        <NavLink to={`/chatbots/${chatbotId}/simulator`} className={tabClassName} onClick={handleClick}>
          {MESSAGES.detail.tabSimulator}
        </NavLink>
        <NavLink to={`/chatbots/${chatbotId}/validation`} className={tabClassName} onClick={handleClick}>
          {MESSAGES.detail.tabValidation}
        </NavLink>
      </div>
      <span className="tab-nav-divider" aria-hidden="true" />
      <div className="tab-nav-group" role="group" aria-label={MESSAGES.detail.tabGroupDeploy}>
        <span className="tab-nav-group-caption" aria-hidden="true">
          {MESSAGES.detail.tabGroupDeploy}
        </span>
        <NavLink to={`/chatbots/${chatbotId}/skin`} className={tabClassName} onClick={handleClick}>
          {MESSAGES.detail.tabSkin}
        </NavLink>
        <NavLink to={`/chatbots/${chatbotId}/channels`} className={tabClassName} onClick={handleClick}>
          {MESSAGES.detail.tabChannels}
        </NavLink>
        <NavLink to={`/chatbots/${chatbotId}/deploy-schedules`} className={tabClassName} onClick={handleClick}>
          {MESSAGES.detail.tabDeploySchedules} <AttentionCountBadge count={needsAttentionCount} />
        </NavLink>
        <NavLink to={`/chatbots/${chatbotId}/environment`} className={tabClassName} onClick={handleClick}>
          {MESSAGES.detail.tabEnvironment} <EnvironmentModeIndicator status={environmentStatus} />
        </NavLink>
        {/* [신규 No.41] "배포" 그룹 5번째 탭 — `chatbot:read`+`dialogue:read`가 없는 AGENT도 탭 링크
            자체는 보인다(다른 탭과 같은 원칙 — 진입 시 페이지 안에서 `ForbiddenState`로 막는다). */}
        <NavLink to={`/chatbots/${chatbotId}/workflow-automation`} className={tabClassName} onClick={handleClick}>
          {MESSAGES.detail.tabWorkflowAutomation} <WorkflowAttentionNavBadge count={workflowAttention?.count ?? 0} />
        </NavLink>
      </div>
    </nav>
  );
}
