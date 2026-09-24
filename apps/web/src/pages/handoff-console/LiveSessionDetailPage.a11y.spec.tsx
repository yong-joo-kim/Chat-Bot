import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { HintResponse, LiveSessionListResponse, TranscriptResponse } from '@chat-bot/shared-types';
import { LiveSessionDetailPage } from './LiveSessionDetailPage';
import { handoffApi } from '../../api/handoff';
import { ToastProvider } from '../../components/Toast';

expect.extend(toHaveNoViolations);

vi.mock('../../api/handoff', () => ({
  handoffApi: { liveSessions: vi.fn(), transcript: vi.fn(), hints: vi.fn(), maskPreview: vi.fn() },
}));
vi.mock('./HandoffConsoleChatbotShell', () => ({
  useHandoffConsoleChatbotContext: () => ({ chatbotId: 'bot-1', chatbotName: '쇼핑몰 도우미' }),
}));
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { name: '박관리', role: 'ADMIN' }, can: () => true }),
}));

const SESSION_REF = 'a'.repeat(16);

const LIVE_LIST: LiveSessionListResponse = {
  items: [
    {
      sessionRef: SESSION_REF,
      alias: 'a1b2c3',
      channelType: 'WEB',
      firstAt: new Date('2026-09-24T01:00:00.000Z'),
      lastAt: new Date('2026-09-24T01:05:00.000Z'),
      turnCount: 4,
      consecutiveUnanswered: 3,
      windowUnanswered: 5,
      blockedCount: 0,
      alertLevel: 'WARNING',
      lastUserText: '환불 계좌를 바꾸고 싶어요',
      handoffSupported: true,
    },
  ],
  total: 1,
  page: 1,
  pageSize: 50,
  summary: { live: 1, warning: 1, caution: 0, handoffActive: 1 },
  truncated: false,
  windowMinutes: 10,
  handoffEnabled: true,
  generatedAt: new Date('2026-09-24T01:05:10.000Z'),
};

const TRANSCRIPT: TranscriptResponse = {
  entries: [
    {
      kind: 'BOT_TURN',
      logId: 'log-1',
      at: new Date('2026-09-24T01:00:00.000Z'),
      userText: '환불 계좌를 바꾸고 싶어요',
      botText: '',
      isAnswered: false,
      blocked: false,
    },
  ],
  nextCursor: null,
  handoff: {
    id: 'h1',
    alias: 'a1b2c3',
    status: 'CONNECTED',
    endReason: null,
    clientMode: 'MODERN',
    assignedUserName: '박관리',
    isMine: true,
    endButtonLabel: null,
    startedAt: new Date('2026-09-24T01:00:00.000Z'),
    connectedAt: new Date('2026-09-24T01:00:05.000Z'),
    endedAt: null,
    userMessageCount: 1,
    agentMessageCount: 0,
    unverifiedAttemptCount: 0,
  },
  rawVisible: false,
  blockedDuringHandoff: 0,
};

const HINTS: HintResponse = {
  source: { key: 'log-1', text: '환불 계좌를 바꾸고 싶어요' },
  mode: 'SEMANTIC',
  answers: [{ kind: 'FAQ', refName: 'refund-account', text: '환불 계좌 변경 안내', score: 0.9 }],
  canned: [],
};

function renderPage() {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={[`/handoff-console/bot-1/live/${SESSION_REF}`]}>
        <Routes>
          <Route path="/handoff-console/:chatbotId/live/:sessionRef" element={<LiveSessionDetailPage />} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>,
  );
}

/** M2(코드 리뷰 1회차) — HC2 axe 접근성 스캔(마스터-디테일 + 개입 후 상태). */
describe('LiveSessionDetailPage — axe 접근성 스캔', () => {
  it('상담 중(CONNECTED) 화면에 구조적 접근성 위반이 없다', async () => {
    vi.mocked(handoffApi.liveSessions).mockResolvedValue(LIVE_LIST);
    vi.mocked(handoffApi.transcript).mockResolvedValue(TRANSCRIPT);
    vi.mocked(handoffApi.hints).mockResolvedValue(HINTS);

    const { container } = renderPage();
    await screen.findByText('환불 계좌 변경 안내');

    const results = await axe(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results).toHaveNoViolations();
  });
});
