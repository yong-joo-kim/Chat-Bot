import { Navigate, Route, Routes } from 'react-router-dom';
import { TopBar } from './components/TopBar';
import { UnsavedGuardProvider } from './context/UnsavedGuardContext';
import { DashboardHomePage } from './pages/DashboardHomePage';
import { ChatbotListPage } from './pages/ChatbotListPage';
import { ChatbotDetailLayout } from './pages/ChatbotDetailLayout';
import { DashboardTab } from './pages/chatbot-detail/DashboardTab';
import { SettingsTab } from './pages/chatbot-detail/SettingsTab';
import { SkinEmbedTab } from './pages/chatbot-detail/SkinEmbedTab';
import { DialogueShell } from './pages/dialogue/DialogueShell';
import { NodesListPage } from './pages/dialogue/NodesListPage';
import { NodeFormPage } from './pages/dialogue/NodeFormPage';
import { IntentsKeywordsPage } from './pages/dialogue/IntentsKeywordsPage';
import { HomonymsPage } from './pages/dialogue/HomonymsPage';
import { ContextsListPage } from './pages/dialogue/ContextsListPage';
import { ContextFormPage } from './pages/dialogue/ContextFormPage';
import { FaqsPage } from './pages/dialogue/FaqsPage';

export function App(): JSX.Element {
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
            <Route path="settings" element={<SettingsTab />} />
            <Route path="skin" element={<SkinEmbedTab />} />
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
          </Route>
        </Routes>
      </main>
    </UnsavedGuardProvider>
  );
}
