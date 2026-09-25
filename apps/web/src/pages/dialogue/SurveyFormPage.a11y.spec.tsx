import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ToastProvider } from '../../components/Toast';
import { makeChatbot } from '../../test/fixtures';
import type { ChatbotDetailContext } from '../ChatbotDetailLayout';
import { SurveyFormPage } from './SurveyFormPage';

expect.extend(toHaveNoViolations);

const mockContext: ChatbotDetailContext = {
  chatbot: makeChatbot({ id: 'bot-1', status: 'ACTIVE' }),
  reload: vi.fn().mockResolvedValue(undefined),
  setUnsavedGuard: vi.fn(), learningSummary: null, refreshLearningSummary: vi.fn() };
vi.mock('../ChatbotDetailLayout', () => ({
  useChatbotDetailContext: () => mockContext,
}));
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ can: () => true }),
}));
vi.mock('../../api/surveys', () => ({
  surveysApi: { findOne: vi.fn(), update: vi.fn(), create: vi.fn(), copy: vi.fn(), remove: vi.fn() },
}));

function renderPage(): ReturnType<typeof render> {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={['/chatbots/bot-1/dialogue/surveys/new']}>
        <Routes>
          <Route path="/chatbots/:chatbotId/dialogue/surveys/new" element={<SurveyFormPage />} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>,
  );
}

/** SV2 — axe 자동 접근성 스캔(AC-SV7-2). 신규 생성(빈 폼, 문항 0개) 상태를 스캔한다. */
describe('SurveyFormPage — axe 접근성 스캔', () => {
  it('신규 생성 폼에 구조적 접근성 위반이 없다', async () => {
    const { container } = renderPage();
    await screen.findByText('설문 추가');

    const results = await axe(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results).toHaveNoViolations();
  });
});
