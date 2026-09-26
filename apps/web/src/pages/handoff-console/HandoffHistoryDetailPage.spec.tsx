import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { HandoffHistoryDetailResponse } from '@chat-bot/shared-types';
import { HandoffHistoryDetailPage } from './HandoffHistoryDetailPage';
import { handoffApi } from '../../api/handoff';
import { inboxApi } from '../../api/inbox';

/**
 * OI-10 — 상담 이력 상세 고객 카드 연계(2026-09-26 계약 보강, `HandoffHistoryItemSchema.sessionRef`).
 */
vi.mock('../../api/handoff', () => ({ handoffApi: { historyDetail: vi.fn() } }));
vi.mock('../../api/inbox', () => ({ inboxApi: { sessionLink: vi.fn() } }));
vi.mock('./HandoffConsoleChatbotShell', () => ({
  useHandoffConsoleChatbotContext: () => ({ chatbotId: 'bot-1', chatbotName: '쇼핑몰 도우미' }),
}));
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { name: '박관리', role: 'ADMIN', governanceModeOn: false }, can: () => true }),
}));

const SESSION_REF = 'a'.repeat(16);

const DETAIL: HandoffHistoryDetailResponse = {
  handoff: {
    id: 'h1',
    alias: 'a1b2c3',
    sessionRef: SESSION_REF,
    startedAt: new Date('2026-09-24T01:00:00.000Z'),
    connectedAt: new Date('2026-09-24T01:00:05.000Z'),
    endedAt: new Date('2026-09-24T01:10:00.000Z'),
    assignedUserName: '김상담',
    endReason: 'AGENT_ENDED',
    userMessageCount: 4,
    agentMessageCount: 5,
    firstResponseSec: 42,
    alertLevelAtStart: 'WARNING',
    clientMode: 'MODERN',
  },
  entries: [{ kind: 'HANDOFF', messageId: 'm1', handoffId: 'h1', seq: 1, at: new Date('2026-09-24T01:00:10.000Z'), sender: 'AGENT', text: '네, 확인했습니다', senderName: '김상담' }],
};

function renderPage(): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={['/handoff-console/bot-1/history/h1']}>
      <Routes>
        <Route path="/handoff-console/:chatbotId/history/:handoffId" element={<HandoffHistoryDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('HandoffHistoryDetailPage — OI-10 고객 카드 연계', () => {
  it('handoff.sessionRef로 GET /inbox/session-link를 호출하고, 참여+연결된 고객이 있으면 카드를 보여준다', async () => {
    vi.mocked(handoffApi.historyDetail).mockResolvedValue(DETAIL);
    vi.mocked(inboxApi.sessionLink).mockResolvedValue({
      participating: true,
      customer: { id: 'c1', alias: 'e5f6g7', displayName: '홍길동', kind: 'IDENTIFIED' },
      threadId: 'thread-9',
      cardBrief: { conversationCount: 3, handoffCount: 1 },
    });
    renderPage();

    await screen.findByText('네, 확인했습니다');
    expect(inboxApi.sessionLink).toHaveBeenCalledWith('bot-1', SESSION_REF);
    expect(await screen.findByText('홍길동')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '스레드 열기' })).toHaveAttribute('href', '/inbox/thread-9');
  });

  it('참여하지 않는 챗봇이면 카드 영역이 아예 보이지 않는다', async () => {
    vi.mocked(handoffApi.historyDetail).mockResolvedValue(DETAIL);
    vi.mocked(inboxApi.sessionLink).mockResolvedValue({ participating: false });
    renderPage();

    await screen.findByText('네, 확인했습니다');
    expect(screen.queryByText('고객에 연결')).not.toBeInTheDocument();
    expect(screen.queryByText('스레드 열기')).not.toBeInTheDocument();
  });
});
