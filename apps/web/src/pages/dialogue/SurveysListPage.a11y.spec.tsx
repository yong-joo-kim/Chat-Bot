import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { SurveyListItem } from '@chat-bot/shared-types';
import { ToastProvider } from '../../components/Toast';
import { makeChatbot } from '../../test/fixtures';
import type { ChatbotDetailContext } from '../ChatbotDetailLayout';
import { SurveysListPage } from './SurveysListPage';

expect.extend(toHaveNoViolations);

const mockList = vi.fn();
vi.mock('../../api/surveys', () => ({
  surveysApi: {
    list: (...args: unknown[]) => mockList(...args),
    remove: vi.fn(),
    update: vi.fn(),
    copy: vi.fn(),
    findOne: vi.fn(),
    create: vi.fn(),
  },
}));

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

function makeSurvey(overrides: Partial<SurveyListItem> = {}): SurveyListItem {
  return {
    id: 'survey-1',
    name: '배송 만족도',
    status: 'OPEN',
    activeFrom: undefined,
    activeTo: undefined,
    questionCount: 3,
    structureVersion: 1,
    locked: true,
    referencingNodeCount: 2,
    last30d: { exposed: 1240, completed: 512 },
    updatedAt: new Date('2026-09-20T00:00:00.000Z'),
    ...overrides,
  };
}

function renderPage(): ReturnType<typeof render> {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={['/chatbots/bot-1/dialogue/surveys']}>
        <Routes>
          <Route path="/chatbots/:chatbotId/dialogue/surveys" element={<SurveysListPage />} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>,
  );
}

/** SV1 — axe 자동 접근성 스캔(AC-SV7-2). */
describe('SurveysListPage — axe 접근성 스캔', () => {
  beforeEach(() => {
    mockList.mockReset();
  });

  it('데이터가 있는 목록 화면에 구조적 접근성 위반이 없다', async () => {
    mockList.mockResolvedValue({ items: [makeSurvey()] });
    const { container } = renderPage();
    await screen.findByText('배송 만족도');

    const results = await axe(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results).toHaveNoViolations();
  });

  it('빈 상태(설문 0건) 화면에도 접근성 위반이 없다', async () => {
    mockList.mockResolvedValue({ items: [] });
    const { container } = renderPage();
    await screen.findByText('등록된 설문이 없습니다.');

    const results = await axe(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results).toHaveNoViolations();
  });
});
