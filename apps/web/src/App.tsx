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
import { DashboardHomePage } from './pages/DashboardHomePage';
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
import { ValidationShell } from './pages/chatbot-detail/validation/ValidationShell';
import { TestSetListPage } from './pages/chatbot-detail/validation/sets/TestSetListPage';
import { TestSetDetailPage } from './pages/chatbot-detail/validation/sets/TestSetDetailPage';
import { TestRunListPage } from './pages/chatbot-detail/validation/runs/TestRunListPage';
import { TestRunDetailPage } from './pages/chatbot-detail/validation/runs/TestRunDetailPage';
import { TestRunComparePage } from './pages/chatbot-detail/validation/compare/TestRunComparePage';
import { VersionListPage } from './pages/chatbot-detail/versions/VersionListPage';
import { VersionDiffPage } from './pages/chatbot-detail/versions/diff/VersionDiffPage';
import { VersionContentPage } from './pages/chatbot-detail/versions/content/VersionContentPage';

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
          <Route path="/" element={<DashboardHomePage />} />
          <Route path="/chatbots" element={<ChatbotListPage />} />
          <Route path="/chatbots/:chatbotId" element={<ChatbotDetailLayout />}>
            <Route index element={<Navigate to="dashboard" replace />} />
            <Route path="dashboard" element={<DashboardTab />} />
            <Route path="stats" element={<StatsShell />}>
              <Route index element={<Navigate to="overview" replace />} />
              <Route path="overview" element={<StatsOverviewPage />} />
              <Route path="learning" element={<LearningQueuePage />} />
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
        </Routes>
      </main>
    </UnsavedGuardProvider>
  );
}
