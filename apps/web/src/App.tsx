import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { TopBar } from './components/TopBar';
import { UnsavedGuardProvider } from './context/UnsavedGuardContext';
import { useAuth } from './context/AuthContext';
import { RequirePermission } from './components/security/RequirePermission';
import { LoginPage } from './pages/auth/LoginPage';
import { ForcedPasswordChangeScreen } from './pages/auth/ForcedPasswordChangeScreen';
import { UsersPage } from './pages/settings/UsersPage';
import { BannedWordsPage } from './pages/settings/BannedWordsPage';
import { AuditLogsPage } from './pages/settings/AuditLogsPage';
import { MESSAGES } from './constants/messages';
import { IntegratedStatsPage } from './pages/integrated-stats/IntegratedStatsPage';
import { ChatbotListPage } from './pages/ChatbotListPage';
import { ChatbotDetailLayout } from './pages/ChatbotDetailLayout';
import { DashboardTab } from './pages/chatbot-detail/DashboardTab';
import { SettingsTab } from './pages/chatbot-detail/SettingsTab';
import { SkinEmbedTab } from './pages/chatbot-detail/SkinEmbedTab';
import { AnswerSettingsTab } from './pages/chatbot-detail/AnswerSettingsTab';
import { SimulatorTab } from './pages/chatbot-detail/SimulatorTab';
import { ChannelsTab } from './pages/chatbot-detail/ChannelsTab';
import { StatsShell } from './pages/stats/StatsShell';
import { StatsOverviewPage } from './pages/stats/StatsOverviewPage';
import { LearningQueuePage } from './pages/learning/LearningQueuePage';
import { DialogueShell } from './pages/dialogue/DialogueShell';
import { NodesListPage } from './pages/dialogue/NodesListPage';
import { NodeFormPage } from './pages/dialogue/NodeFormPage';
import { IntentsKeywordsPage } from './pages/dialogue/IntentsKeywordsPage';
import { HomonymsPage } from './pages/dialogue/HomonymsPage';
import { ContextsListPage } from './pages/dialogue/ContextsListPage';
import { ContextFormPage } from './pages/dialogue/ContextFormPage';
import { FaqsPage } from './pages/dialogue/FaqsPage';
import { SurveysListPage } from './pages/dialogue/SurveysListPage';
import { SurveyFormPage } from './pages/dialogue/SurveyFormPage';
import { SurveyResultsPage } from './pages/dialogue/SurveyResultsPage';
import { ValidationShell } from './pages/chatbot-detail/validation/ValidationShell';
import { TestSetListPage } from './pages/chatbot-detail/validation/sets/TestSetListPage';
import { TestSetDetailPage } from './pages/chatbot-detail/validation/sets/TestSetDetailPage';
import { TestRunListPage } from './pages/chatbot-detail/validation/runs/TestRunListPage';
import { TestRunDetailPage } from './pages/chatbot-detail/validation/runs/TestRunDetailPage';
import { TestRunComparePage } from './pages/chatbot-detail/validation/compare/TestRunComparePage';
import { VersionListPage } from './pages/chatbot-detail/versions/VersionListPage';
import { VersionDiffPage } from './pages/chatbot-detail/versions/diff/VersionDiffPage';
import { VersionContentPage } from './pages/chatbot-detail/versions/content/VersionContentPage';
import { DeployScheduleListPage } from './pages/chatbot-detail/deploy-schedules/DeployScheduleListPage';
import { DeployScheduleDetailPage } from './pages/chatbot-detail/deploy-schedules/DeployScheduleDetailPage';
import { EnvironmentTab } from './pages/chatbot-detail/environment/EnvironmentTab';
import { DeploySchedulesPage } from './pages/settings/DeploySchedulesPage';
import { ApiConnectionsPage } from './pages/settings/ApiConnectionsPage';
import { WorkflowAutomationShell } from './pages/settings/workflow-automation/WorkflowAutomationShell';
import { WorkflowTargetsPage } from './pages/settings/workflow-automation/WorkflowTargetsPage';
import { WorkflowRunsPage } from './pages/settings/workflow-automation/WorkflowRunsPage';
import { WorkflowSummaryPage } from './pages/settings/workflow-automation/WorkflowSummaryPage';
import { ChatbotWorkflowShell } from './pages/chatbot-detail/workflow-automation/ChatbotWorkflowShell';
import { WorkflowSubscriptionsPage } from './pages/chatbot-detail/workflow-automation/WorkflowSubscriptionsPage';
import { ChatbotWorkflowRunsPage } from './pages/chatbot-detail/workflow-automation/ChatbotWorkflowRunsPage';
import { DataGovernanceShell } from './pages/settings/data-governance/DataGovernanceShell';
import { DataGovernanceMapPage } from './pages/settings/data-governance/DataGovernanceMapPage';
import { DataGovernanceRetentionPage } from './pages/settings/data-governance/DataGovernanceRetentionPage';
import { PurgeHistoryPage } from './pages/settings/data-governance/PurgeHistoryPage';
import { ApiCallLogPage } from './pages/stats/ApiCallLogPage';
import { CannedResponsesPage } from './pages/dialogue/CannedResponsesPage';
import { TopicsPage } from './pages/dialogue/TopicsPage';
import { HandoffChatbotPickerPage } from './pages/handoff-console/HandoffChatbotPickerPage';
import { HandoffConsoleChatbotShell } from './pages/handoff-console/HandoffConsoleChatbotShell';
import { LiveSessionListPage } from './pages/handoff-console/LiveSessionListPage';
import { LiveSessionDetailPage } from './pages/handoff-console/LiveSessionDetailPage';
import { HandoffHistoryListPage } from './pages/handoff-console/HandoffHistoryListPage';
import { HandoffHistoryDetailPage } from './pages/handoff-console/HandoffHistoryDetailPage';

/** 미인증 상태에서 보호 경로에 직접 진입한 경우 `returnTo`를 실어 `/login`으로 보낸다(F-2, AC-U-1). */
function RedirectToLogin(): JSX.Element {
  const location = useLocation();
  const returnTo = encodeURIComponent(`${location.pathname}${location.search}`);
  return <Navigate to={`/login?returnTo=${returnTo}`} replace />;
}

/**
 * L0(`AuthGate`)를 구현하는 최상위 컴포넌트(security-audit-ui-spec.md §3.1). 라우트가 아니라
 * 인증 상태에 따라 로그인/강제 비밀번호변경/정상 화면 중 정확히 하나만 렌더한다.
 */
export function App(): JSX.Element {
  const { status } = useAuth();

  if (status === 'loading') {
    return (
      <div className="auth-boot-spinner" role="status" aria-live="polite">
        <span className="spinner" aria-hidden="true" />
        <span>{MESSAGES.auth.bootLoading}</span>
      </div>
    );
  }

  if (status === 'unauthenticated') {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<RedirectToLogin />} />
      </Routes>
    );
  }

  if (status === 'password-change-required') {
    return <ForcedPasswordChangeScreen />;
  }

  return (
    <UnsavedGuardProvider>
      <TopBar />
      <main id="main-content" className="app-main">
        <Routes>
          <Route path="/" element={<IntegratedStatsPage />} />
          <Route path="/chatbots" element={<ChatbotListPage />} />
          <Route path="/chatbots/:chatbotId" element={<ChatbotDetailLayout />}>
            <Route index element={<Navigate to="dashboard" replace />} />
            <Route path="dashboard" element={<DashboardTab />} />
            <Route path="stats" element={<StatsShell />}>
              <Route index element={<Navigate to="overview" replace />} />
              <Route path="overview" element={<StatsOverviewPage />} />
              <Route path="learning" element={<LearningQueuePage />} />
              {/* [No.26] L1 외부 연동 로그 — StatsShell 3번째 서브탭(ui-spec §1 L1 권고안). */}
              <Route path="api-calls" element={<ApiCallLogPage />} />
            </Route>
            <Route path="settings" element={<SettingsTab />} />
            <Route path="versions" element={<VersionListPage />} />
            <Route path="versions/:versionId" element={<VersionListPage />} />
            <Route path="versions/:versionId/diff" element={<VersionDiffPage />} />
            <Route path="versions/:versionId/content" element={<VersionContentPage />} />
            <Route path="skin" element={<SkinEmbedTab />} />
            <Route path="answer-settings" element={<AnswerSettingsTab />} />
            <Route path="simulator" element={<SimulatorTab />} />
            <Route path="channels" element={<ChannelsTab />} />
            <Route path="deploy-schedules" element={<DeployScheduleListPage />} />
            <Route path="environment" element={<EnvironmentTab />} />
            {/* [신규 No.41] "배포" 그룹 5번째 탭 — 챗봇 스코프 업무 자동화(§13-1 확정, WF3~WF3-b). */}
            <Route path="workflow-automation" element={<ChatbotWorkflowShell />}>
              <Route index element={<Navigate to="subscriptions" replace />} />
              <Route path="subscriptions" element={<WorkflowSubscriptionsPage />} />
              <Route path="runs" element={<ChatbotWorkflowRunsPage />} />
            </Route>
            <Route path="deploy-schedules/:scheduleId" element={<DeployScheduleDetailPage />} />
            <Route path="dialogue" element={<DialogueShell />}>
              <Route index element={<Navigate to="nodes" replace />} />
              <Route path="nodes" element={<NodesListPage />} />
              <Route path="nodes/new" element={<NodeFormPage />} />
              <Route path="nodes/:nodeId" element={<NodeFormPage />} />
              <Route path="intents" element={<IntentsKeywordsPage />} />
              <Route path="homonyms" element={<HomonymsPage />} />
              <Route path="contexts" element={<ContextsListPage />} />
              <Route path="contexts/new" element={<ContextFormPage />} />
              <Route path="contexts/:contextId" element={<ContextFormPage />} />
              <Route path="faqs" element={<FaqsPage />} />
              {/* [No.27] SV1~SV3 — 신규 최상위 라우트 0개, DialogueShell 6번째 서브내비 하위(ui-spec §1). */}
              <Route path="surveys" element={<SurveysListPage />} />
              <Route path="surveys/new" element={<SurveyFormPage />} />
              <Route path="surveys/:surveyId" element={<SurveyFormPage />} />
              <Route path="surveys/:surveyId/results" element={<SurveyResultsPage />} />
              {/* [No.24] CR1 — 자주 쓰는 문장 관리, DialogueShell 서브내비 7번째(hybrid-cs-ui-spec.md §3.6). */}
              <Route path="canned-responses" element={<CannedResponsesPage />} />
              {/* [No.22] TP0 — 토픽 관리, DialogueShell 서브내비 8번째(topic-system-ui-spec.md §1). */}
              <Route path="topics" element={<TopicsPage />} />
            </Route>
            <Route path="validation" element={<ValidationShell />}>
              <Route index element={<Navigate to="sets" replace />} />
              <Route path="sets" element={<TestSetListPage />} />
              <Route path="sets/:setId" element={<TestSetDetailPage />} />
              <Route path="runs" element={<TestRunListPage />} />
              <Route path="runs/:runId" element={<TestRunDetailPage />} />
              <Route path="compare" element={<TestRunComparePage />} />
            </Route>
          </Route>
          {/*
            [No.24] 상담 콘솔 — `ChatbotDetailLayout`(TabNav 소속) 밖의 새 최상위 라우트 트리
            (hybrid-cs-ui-spec.md §0.2·§1). `TabNav.tsx`(AC-C-3, 라우트 6개 고정)는 손대지 않는다.
          */}
          <Route
            path="/handoff-console"
            element={
              <RequirePermission permission="cs:read" menuName={MESSAGES.handoffConsole.navLabel}>
                <HandoffChatbotPickerPage />
              </RequirePermission>
            }
          />
          <Route
            path="/handoff-console/:chatbotId"
            element={
              <RequirePermission permission="cs:read" menuName={MESSAGES.handoffConsole.navLabel}>
                <HandoffConsoleChatbotShell />
              </RequirePermission>
            }
          >
            <Route index element={<Navigate to="live" replace />} />
            <Route path="live" element={<LiveSessionListPage />} />
            <Route path="live/:sessionRef" element={<LiveSessionDetailPage />} />
            <Route path="history" element={<HandoffHistoryListPage />} />
            <Route path="history/:handoffId" element={<HandoffHistoryDetailPage />} />
          </Route>
          <Route
            path="/settings/users"
            element={
              <RequirePermission permission="user:read" menuName={MESSAGES.systemSettings.users}>
                <UsersPage />
              </RequirePermission>
            }
          />
          <Route
            path="/settings/banned-words"
            element={
              <RequirePermission permission="security:read" menuName={MESSAGES.systemSettings.bannedWords}>
                <BannedWordsPage />
              </RequirePermission>
            }
          />
          <Route
            path="/settings/audit-logs"
            element={
              <RequirePermission permission="audit:read" menuName={MESSAGES.systemSettings.auditLogs}>
                <AuditLogsPage />
              </RequirePermission>
            }
          />
          <Route
            path="/settings/deploy-schedules"
            element={
              <RequirePermission permission="chatbot:read" menuName={MESSAGES.systemSettings.deploySchedules}>
                <DeploySchedulesPage />
              </RequirePermission>
            }
          />
          <Route
            path="/settings/api-connections"
            element={
              <RequirePermission permission="security:read" menuName={MESSAGES.systemSettings.apiConnections}>
                <ApiConnectionsPage />
              </RequirePermission>
            }
          />
          {/* [신규 No.41] WF1~WF1-c — 새 서브라우트 트리(`WorkflowAutomationShell`, ui-spec §1). */}
          <Route
            path="/settings/workflow-automation"
            element={
              <RequirePermission permission="security:read" menuName={MESSAGES.systemSettings.workflowAutomation}>
                <WorkflowAutomationShell />
              </RequirePermission>
            }
          >
            <Route index element={<Navigate to="targets" replace />} />
            <Route path="targets" element={<WorkflowTargetsPage />} />
            <Route path="runs" element={<WorkflowRunsPage />} />
            <Route path="summary" element={<WorkflowSummaryPage />} />
          </Route>
          {/* [신규 No.45] G1~G1-c — 새 서브라우트 트리(`DataGovernanceShell`). G2(챗봇별 재정의)는
              `ChatbotDetailLayout` 하위 `SettingsTab`의 `?section=retention` 서브탭에 있다(2차 완료). */}
          <Route
            path="/settings/data-governance"
            element={
              <RequirePermission permission="security:read" menuName={MESSAGES.systemSettings.dataGovernance}>
                <DataGovernanceShell />
              </RequirePermission>
            }
          >
            <Route index element={<Navigate to="map" replace />} />
            <Route path="map" element={<DataGovernanceMapPage />} />
            <Route path="retention" element={<DataGovernanceRetentionPage />} />
            <Route path="purge-history" element={<PurgeHistoryPage />} />
          </Route>
        </Routes>
      </main>
    </UnsavedGuardProvider>
  );
}
