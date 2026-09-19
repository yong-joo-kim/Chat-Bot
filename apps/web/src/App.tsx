import { Navigate, Route, Routes } from 'react-router-dom';
import { TopBar } from './components/TopBar';
import { UnsavedGuardProvider } from './context/UnsavedGuardContext';
import { DashboardHomePage } from './pages/DashboardHomePage';
import { ChatbotListPage } from './pages/ChatbotListPage';
import { ChatbotDetailLayout } from './pages/ChatbotDetailLayout';
import { DashboardTab } from './pages/chatbot-detail/DashboardTab';
import { SettingsTab } from './pages/chatbot-detail/SettingsTab';
import { SkinEmbedTab } from './pages/chatbot-detail/SkinEmbedTab';

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
          </Route>
        </Routes>
      </main>
    </UnsavedGuardProvider>
  );
}
