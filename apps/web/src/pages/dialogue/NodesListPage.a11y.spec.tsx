import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe, toHaveNoViolations } from 'jest-axe';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { Chatbot, DialogNodeListItem } from '@chat-bot/shared-types';
import { ToastProvider } from '../../components/Toast';
import { makeChatbot } from '../../test/fixtures';
import type { ChatbotDetailContext } from '../ChatbotDetailLayout';
import { NodesListPage } from './NodesListPage';

expect.extend(toHaveNoViolations);

const mockList = vi.fn();
vi.mock('../../api/dialogue', () => ({
  dialogNodesApi: { list: (...args: unknown[]) => mockList(...args), flow: vi.fn(), validate: vi.fn(), remove: vi.fn(), copy: vi.fn() },
  intentsApi: { list: vi.fn().mockResolvedValue({ items: [], total: 0 }) },
}));
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ can: () => true }),
}));
vi.mock('../../api/topics', () => ({
  topicsApi: {
    list: vi.fn().mockResolvedValue({
      items: [
        { id: 'topic-1', chatbotId: 'bot-1', name: '배송', sortOrder: 0, enabled: true, createdAt: new Date(), updatedAt: new Date() },
      ],
      common: { counts: {}, outgoingCrossRefs: 0 },
      limit: 50,
    }),
  },
}));

const chatbot: Chatbot = makeChatbot({ id: 'bot-1', status: 'ACTIVE' });
const mockContext: ChatbotDetailContext = { chatbot, reload: vi.fn().mockResolvedValue(undefined), setUnsavedGuard: vi.fn(), learningSummary: null, refreshLearningSummary: vi.fn() };
vi.mock('../ChatbotDetailLayout', () => ({
  useChatbotDetailContext: () => mockContext,
}));

function makeNodeItem(overrides: Partial<DialogNodeListItem> = {}): DialogNodeListItem {
  return {
    id: 'node-1',
    chatbotId: 'bot-1',
    name: '배송조회_응답',
    nodeType: 'NORMAL',
    matchMode: 'ANY',
    enabled: true,
    priority: 100,
    intentIds: ['intent-1'],
    keywordIds: [],
    outputs: [{ type: 'TEXT', payload: { text: '안내드립니다.' } }],
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    updatedAt: new Date('2026-09-18T00:00:00.000Z'),
    conditionSummary: { intents: [{ id: 'intent-1', name: '배송조회' }], keywords: [] },
    outputTypes: ['TEXT'],
    incomingCount: 0,
    ...overrides,
  } as DialogNodeListItem;
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/chatbots/bot-1/dialogue/nodes']}>
      <ToastProvider>
        <Routes>
          <Route path="/chatbots/:chatbotId/dialogue/nodes" element={<NodesListPage />} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  );
}

/** D1-ext 토픽 필터 드롭다운 열림 상태의 axe 접근성 스캔(topic-system-ui-spec.md §6.4). */
describe('NodesListPage(토픽 필터) — axe 접근성 스캔', () => {
  it('필터 드롭다운을 연 상태에서도 구조적 접근성 위반이 없다', async () => {
    const user = userEvent.setup();
    mockList.mockResolvedValue({ items: [makeNodeItem()], total: 1, page: 1, pageSize: 20 });
    const { container } = renderPage();
    await screen.findByText('배송조회_응답');

    await user.click(screen.getByRole('button', { name: /^토픽:/ }));
    await screen.findByRole('checkbox', { name: '배송' });

    const results = await axe(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results).toHaveNoViolations();
  });
});
