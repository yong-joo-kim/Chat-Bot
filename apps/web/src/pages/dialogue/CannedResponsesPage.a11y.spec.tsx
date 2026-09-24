import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { CannedResponse } from '@chat-bot/shared-types';
import { ToastProvider } from '../../components/Toast';
import { makeChatbot } from '../../test/fixtures';
import type { ChatbotDetailContext } from '../ChatbotDetailLayout';
import { CannedResponsesPage } from './CannedResponsesPage';
import { cannedResponsesApi } from '../../api/cannedResponses';

expect.extend(toHaveNoViolations);

const mockList = vi.fn();
vi.mock('../../api/cannedResponses', () => ({
  cannedResponsesApi: {
    list: (...args: unknown[]) => mockList(...args),
    search: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    move: vi.fn(),
  },
}));

const mockContext: ChatbotDetailContext = {
  chatbot: makeChatbot({ id: 'bot-1', status: 'ACTIVE' }),
  reload: vi.fn().mockResolvedValue(undefined),
  setUnsavedGuard: vi.fn(),
};
vi.mock('../ChatbotDetailLayout', () => ({
  useChatbotDetailContext: () => mockContext,
}));
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ can: () => true }),
}));

function makeCanned(overrides: Partial<CannedResponse> = {}): CannedResponse {
  return {
    id: 'cr-1',
    chatbotId: 'bot-1',
    title: '환불계좌 변경안내',
    body: '환불 계좌를 알려주시면 도와드릴게요.',
    category: '환불',
    shortcut: 'refund',
    sortOrder: 0,
    enabled: true,
    createdAt: new Date('2026-09-20T00:00:00.000Z'),
    updatedAt: new Date('2026-09-20T00:00:00.000Z'),
    ...overrides,
  };
}

function renderPage() {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={['/chatbots/bot-1/dialogue/canned-responses']}>
        <Routes>
          <Route path="/chatbots/:chatbotId/dialogue/canned-responses" element={<CannedResponsesPage />} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>,
  );
}

/** M2(코드 리뷰 1회차) — CR1 axe 접근성 스캔. */
describe('CannedResponsesPage — axe 접근성 스캔', () => {
  beforeEach(() => {
    mockList.mockReset();
  });

  it('문장 목록이 있는 화면에 구조적 접근성 위반이 없다', async () => {
    mockList.mockResolvedValue([makeCanned()]);
    const { container } = renderPage();
    await screen.findByText('환불계좌 변경안내');

    const results = await axe(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results).toHaveNoViolations();
  });

  it('빈 상태(문장 0건) 화면에도 접근성 위반이 없다', async () => {
    mockList.mockResolvedValue([]);
    const { container } = renderPage();
    await screen.findByText('등록된 문장이 없습니다.');

    const results = await axe(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results).toHaveNoViolations();
  });
});
