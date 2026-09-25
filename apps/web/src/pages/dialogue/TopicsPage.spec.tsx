import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { TopicListResponse } from '@chat-bot/shared-types';
import { ToastProvider } from '../../components/Toast';
import { makeChatbot, makeTopicListItem } from '../../test/fixtures';
import type { ChatbotDetailContext } from '../ChatbotDetailLayout';
import { ApiError } from '../../api/client';
import { TopicsPage } from './TopicsPage';

const mockList = vi.fn();
const mockCreate = vi.fn();
const mockMove = vi.fn();
const mockRemove = vi.fn();
const mockEnable = vi.fn();
const mockDisable = vi.fn();
const mockImpact = vi.fn();

vi.mock('../../api/topics', () => ({
  topicsApi: {
    list: (...args: unknown[]) => mockList(...args),
    create: (...args: unknown[]) => mockCreate(...args),
    move: (...args: unknown[]) => mockMove(...args),
    remove: (...args: unknown[]) => mockRemove(...args),
    enable: (...args: unknown[]) => mockEnable(...args),
    disable: (...args: unknown[]) => mockDisable(...args),
    impact: (...args: unknown[]) => mockImpact(...args),
    splitPreview: vi.fn(),
    split: vi.fn(),
  },
  topicAssignmentsApi: { assign: vi.fn() },
}));

vi.mock('../../api/groups', () => ({
  groupsApi: { list: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 100 }) },
}));

let canMap: Record<string, boolean> = {};
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ can: (p: string) => canMap[p] ?? true }),
}));

const chatbot = makeChatbot({ id: 'bot-1', status: 'ACTIVE' });
const mockContext: ChatbotDetailContext = {
  chatbot,
  reload: vi.fn().mockResolvedValue(undefined),
  setUnsavedGuard: vi.fn(), learningSummary: null, refreshLearningSummary: vi.fn() };
vi.mock('../ChatbotDetailLayout', () => ({
  useChatbotDetailContext: () => mockContext,
}));

function baseListResponse(overrides: Partial<TopicListResponse> = {}): TopicListResponse {
  return {
    items: [
      makeTopicListItem({ id: 'topic-1', name: '배송', enabled: true, sortOrder: 0 }),
      makeTopicListItem({ id: 'topic-2', name: '보험청구', enabled: false, sortOrder: 1 }),
    ],
    common: { counts: { intents: 1, keywords: 1, homonyms: 0, contexts: 0, dialogNodes: 1, faqs: 0 }, outgoingCrossRefs: 0 },
    limit: 50,
    ...overrides,
  };
}

function renderPage(): ReturnType<typeof render> {
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

describe('TopicsPage(TP0)', () => {
  beforeEach(() => {
    mockList.mockReset();
    mockCreate.mockReset();
    mockMove.mockReset();
    mockRemove.mockReset();
    mockEnable.mockReset();
    mockDisable.mockReset();
    mockImpact.mockReset();
    canMap = {};
  });

  it('공통 행이 맨 위 고정으로 항상 표시되고, 토픽 행이 이어서 표시된다', async () => {
    mockList.mockResolvedValue(baseListResponse());
    renderPage();

    await screen.findByText('배송');
    expect(screen.getAllByText('공통').length).toBeGreaterThan(0);
    expect(screen.getByText('보험청구')).toBeInTheDocument();
    // 상태 열: 활성/비활성 텍스트가 텍스트로 구분된다(색상 단독 금지).
    expect(screen.getByText('활성')).toBeInTheDocument();
    expect(screen.getByText('비활성')).toBeInTheDocument();
  });

  it('토픽이 0건이어도 공통 행은 표시된다("가상 토픽")', async () => {
    mockList.mockResolvedValue(baseListResponse({ items: [] }));
    renderPage();

    await waitFor(() => expect(mockList).toHaveBeenCalled());
    expect(await screen.findAllByText('공통')).not.toHaveLength(0);
    expect(screen.getByText(/아직 토픽이 없습니다/)).toBeInTheDocument();
  });

  it('VIEWER(dialogue:write 없음)는 추가/편집/전환/삭제 버튼을 렌더하지 않는다', async () => {
    canMap = { 'dialogue:write': false, 'dialogue:read': true, 'chatbot:write': false };
    mockList.mockResolvedValue(baseListResponse());
    renderPage();

    await screen.findByText('배송');
    expect(screen.queryByRole('button', { name: /\+ 토픽 추가/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '편집' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '비활성화' })).not.toBeInTheDocument();
  });

  it('EDITOR(dialogue:write 있음)는 추가 버튼과 행 액션 버튼을 볼 수 있다', async () => {
    canMap = { 'dialogue:write': true, 'dialogue:read': true, 'chatbot:write': false };
    mockList.mockResolvedValue(baseListResponse());
    renderPage();

    await screen.findByText('배송');
    expect(screen.getByRole('button', { name: /\+ 토픽 추가/ })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: '편집' }).length).toBeGreaterThan(0);
  });

  it('"새 챗봇으로 분리" 버튼은 dialogue:read AND chatbot:write가 모두 있어야 보인다', async () => {
    mockList.mockResolvedValue(baseListResponse());

    canMap = { 'dialogue:read': true, 'chatbot:write': false, 'dialogue:write': true };
    const { unmount } = renderPage();
    await screen.findByText('배송');
    expect(screen.queryByRole('button', { name: '새 챗봇으로 분리' })).not.toBeInTheDocument();
    unmount();

    canMap = { 'dialogue:read': true, 'chatbot:write': true, 'dialogue:write': true };
    renderPage();
    await screen.findByText('배송');
    expect(screen.getByRole('button', { name: '새 챗봇으로 분리' })).toBeInTheDocument();
  });

  it('위/아래 버튼 클릭 시 move API를 호출하고 목록을 다시 불러온다', async () => {
    const user = userEvent.setup();
    mockList.mockResolvedValue(baseListResponse());
    mockMove.mockResolvedValue({ items: [] });
    renderPage();

    await screen.findByText('배송');
    const downButtons = screen.getAllByRole('button', { name: /아래로/ });
    await user.click(downButtons[0]);

    await waitFor(() => expect(mockMove).toHaveBeenCalledWith('bot-1', 'topic-1', { direction: 'DOWN' }));
    // 이동 후 전체 목록을 다시 불러온다(§3.1 컴포넌트 분해).
    await waitFor(() => expect(mockList).toHaveBeenCalledTimes(2));
  });

  /** [코드 리뷰 1회차 M-5] 삭제 확정 중 자산이 늘어나 409가 다시 오면 목록을 재조회해 최신 counts로 갱신한다. */
  it('삭제 중 409 TOPIC_NOT_EMPTY가 다시 오면 목록을 재조회해 대화상자의 건수를 최신화한다', async () => {
    const user = userEvent.setup();
    const topic2Initial = makeTopicListItem({
      id: 'topic-2',
      name: '보험청구',
      enabled: false,
      sortOrder: 1,
      counts: { intents: 1, keywords: 0, homonyms: 0, contexts: 0, dialogNodes: 0, faqs: 0 },
    });
    const topic2Refreshed = makeTopicListItem({
      id: 'topic-2',
      name: '보험청구',
      enabled: false,
      sortOrder: 1,
      counts: { intents: 3, keywords: 0, homonyms: 0, contexts: 0, dialogNodes: 0, faqs: 0 },
    });
    mockList
      .mockResolvedValueOnce(baseListResponse({ items: [makeTopicListItem({ id: 'topic-1', name: '배송', enabled: true, sortOrder: 0 }), topic2Initial] }))
      .mockResolvedValueOnce(baseListResponse({ items: [makeTopicListItem({ id: 'topic-1', name: '배송', enabled: true, sortOrder: 0 }), topic2Refreshed] }));
    mockRemove.mockRejectedValue(new ApiError(409, '자산이 있습니다.', 'TOPIC_NOT_EMPTY'));
    renderPage();

    await screen.findByText('보험청구');
    // topic-2 행의 "삭제" 액션 버튼을 찾는다(공통 행에는 삭제 버튼이 없다).
    const row = screen.getByText('보험청구').closest('tr');
    if (!row) throw new Error('행을 찾을 수 없습니다.');
    await user.click(within(row as HTMLElement).getByRole('button', { name: '삭제' }));

    await screen.findByRole('button', { name: '공통으로 옮기고 삭제' });
    expect(screen.getByText('의도 1')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '공통으로 옮기고 삭제' }));

    expect(await screen.findByText('자산이 늘어났습니다. 다시 확인해 주세요.')).toBeInTheDocument();
    // 대화상자가 닫히지 않고 최신 건수(의도 3)로 갱신된다.
    expect(await screen.findByText('의도 3')).toBeInTheDocument();
    await waitFor(() => expect(mockList).toHaveBeenCalledTimes(2));
  });
});
