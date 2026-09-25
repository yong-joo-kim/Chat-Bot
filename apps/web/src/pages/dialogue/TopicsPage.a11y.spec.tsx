import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { TopicListResponse } from '@chat-bot/shared-types';
import { ToastProvider } from '../../components/Toast';
import { makeChatbot, makeTopicListItem } from '../../test/fixtures';
import type { ChatbotDetailContext } from '../ChatbotDetailLayout';
import { TopicsPage } from './TopicsPage';

expect.extend(toHaveNoViolations);

const mockList = vi.fn();
vi.mock('../../api/topics', () => ({
  topicsApi: {
    list: (...args: unknown[]) => mockList(...args),
    create: vi.fn(),
    move: vi.fn(),
    remove: vi.fn(),
    enable: vi.fn(),
    disable: vi.fn(),
    impact: vi.fn(),
    splitPreview: vi.fn(),
    split: vi.fn(),
  },
  topicAssignmentsApi: { assign: vi.fn() },
}));
vi.mock('../../api/groups', () => ({
  groupsApi: { list: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 100 }) },
}));
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ can: () => true }),
}));

const chatbot = makeChatbot({ id: 'bot-1', status: 'ACTIVE' });
const mockContext: ChatbotDetailContext = {
  chatbot,
  reload: vi.fn().mockResolvedValue(undefined),
  setUnsavedGuard: vi.fn(), learningSummary: null, refreshLearningSummary: vi.fn() };
vi.mock('../ChatbotDetailLayout', () => ({
  useChatbotDetailContext: () => mockContext,
}));

function renderPage() {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={['/chatbots/bot-1/dialogue/topics']}>
        <Routes>
          <Route path="/chatbots/:chatbotId/dialogue/topics" element={<TopicsPage />} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>,
  );
}

/** TP0 axe 접근성 스캔(topic-system-ui-spec.md §6.4 AC-TP7-3). */
describe('TopicsPage(TP0) — axe 접근성 스캔', () => {
  beforeEach(() => {
    mockList.mockReset();
  });

  it('토픽 목록이 있는 화면에 구조적 접근성 위반이 없다', async () => {
    const items: TopicListResponse['items'] = [
      makeTopicListItem({ id: 'topic-1', name: '배송', enabled: true, sortOrder: 0 }),
      makeTopicListItem({ id: 'topic-2', name: '보험청구', enabled: false, sortOrder: 1 }),
    ];
    mockList.mockResolvedValue({ items, common: { counts: { intents: 0, keywords: 0, homonyms: 0, contexts: 0, dialogNodes: 0, faqs: 0 }, outgoingCrossRefs: 0 }, limit: 50 });
    const { container } = renderPage();
    await screen.findByText('배송');

    const results = await axe(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results).toHaveNoViolations();
  });

  it('빈 상태(토픽 0건) 화면에도 접근성 위반이 없다', async () => {
    mockList.mockResolvedValue({ items: [], common: { counts: { intents: 0, keywords: 0, homonyms: 0, contexts: 0, dialogNodes: 0, faqs: 0 }, outgoingCrossRefs: 0 }, limit: 50 });
    const { container } = renderPage();
    await screen.findByText(/아직 토픽이 없습니다/);

    const results = await axe(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results).toHaveNoViolations();
  });
});
