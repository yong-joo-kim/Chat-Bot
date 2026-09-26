import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { SessionLinkCard } from './SessionLinkCard';
import { inboxApi } from '../../api/inbox';
import { ApiError } from '../../api/client';

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ can: () => true }),
}));

vi.mock('../../api/inbox', () => ({
  inboxApi: { sessionLink: vi.fn(), linkSession: vi.fn(), openFromSession: vi.fn(), identitySpaces: vi.fn().mockResolvedValue([]), searchCustomers: vi.fn() },
}));

function renderCard(): ReturnType<typeof render> {
  return render(
    <MemoryRouter>
      <SessionLinkCard chatbotId="bot-1" sessionRef={'a'.repeat(16)} />
    </MemoryRouter>,
  );
}

describe('SessionLinkCard(OI-10)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('참여하지 않는 챗봇이면 아무것도 렌더하지 않는다', async () => {
    vi.mocked(inboxApi.sessionLink).mockResolvedValue({ participating: false });
    const { container } = renderCard();
    await vi.waitFor(() => expect(inboxApi.sessionLink).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('참여하지만 연결된 고객이 없으면 "고객에 연결" 버튼을 보여준다', async () => {
    vi.mocked(inboxApi.sessionLink).mockResolvedValue({ participating: true, customer: null });
    renderCard();
    expect(await screen.findByRole('button', { name: '고객에 연결' })).toBeInTheDocument();
  });

  it('연결된 고객이 있고 스레드가 없으면 "스레드 열기" 버튼을 보여준다', async () => {
    vi.mocked(inboxApi.sessionLink).mockResolvedValue({
      participating: true,
      customer: { id: 'c1', alias: 'a1b2c3', displayName: '홍길동', kind: 'IDENTIFIED' },
      cardBrief: { conversationCount: 2, handoffCount: 0 },
    });
    renderCard();
    expect(await screen.findByRole('button', { name: '스레드 열기' })).toBeInTheDocument();
  });

  it('스레드가 이미 있으면 스레드로 이동하는 링크를 보여준다', async () => {
    vi.mocked(inboxApi.sessionLink).mockResolvedValue({
      participating: true,
      customer: { id: 'c1', alias: 'a1b2c3', displayName: '홍길동', kind: 'IDENTIFIED' },
      threadId: 'thread-9',
      threadStatus: 'OPEN',
      cardBrief: { conversationCount: 2, handoffCount: 0 },
    });
    renderCard();
    const link = await screen.findByRole('link', { name: '스레드 열기' });
    expect(link).toHaveAttribute('href', '/inbox/thread-9');
  });

  it('기능이 꺼져 있으면(404) 아무것도 렌더하지 않는다', async () => {
    vi.mocked(inboxApi.sessionLink).mockRejectedValue(new ApiError(404, 'not found'));
    const { container } = renderCard();
    await vi.waitFor(() => expect(inboxApi.sessionLink).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
