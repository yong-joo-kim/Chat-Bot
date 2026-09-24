import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { HintResponse, LiveSessionListResponse, TranscriptResponse } from '@chat-bot/shared-types';
import { LiveSessionDetailPage } from './LiveSessionDetailPage';
import { handoffApi } from '../../api/handoff';
import { ToastProvider } from '../../components/Toast';

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
  items: [],
  total: 0,
  page: 1,
  pageSize: 50,
  summary: { live: 0, warning: 0, caution: 0, handoffActive: 0 },
  truncated: false,
  windowMinutes: 10,
  handoffEnabled: true,
  generatedAt: new Date('2026-09-24T01:05:10.000Z'),
};

const HINTS: HintResponse = { source: null, mode: 'LEXICAL', answers: [], canned: [] };

function transcriptWithEndButtonLabel(label: string | null): TranscriptResponse {
  return {
    entries: [],
    nextCursor: null,
    handoff: {
      id: 'h1',
      alias: 'a1b2c3',
      status: 'CONNECTED',
      endReason: null,
      clientMode: 'MODERN',
      assignedUserName: '박관리',
      isMine: true,
      // M-2(코드 리뷰 2회차 후속): 이제 `HandoffBriefSchema`(2초 폴링 응답)에도 이 필드가 들어온다.
      endButtonLabel: label,
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
}

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

/**
 * M-2(코드 리뷰 2회차 후속) — `endButtonLabel`이 `HandoffBriefSchema`로 옮겨져 개입·인수를 한 번도
 * 호출하지 않고 2초 폴링(`TranscriptPanel`)만으로 들어온 상담원에게도 종료 확인 미리보기가 채워지는지
 * 검증한다(이전에는 개입/인수 응답에서만 기회적으로 채워 이 경우 비어 있었다).
 */
describe('LiveSessionDetailPage — 종료 확인 미리보기(endButtonLabel, M-2)', () => {
  it('개입·인수를 하지 않고 폴링만으로 CONNECTED 상태를 받아도 종료 확인에 버튼 라벨 미리보기가 채워진다', async () => {
    vi.mocked(handoffApi.liveSessions).mockResolvedValue(LIVE_LIST);
    vi.mocked(handoffApi.transcript).mockResolvedValue(transcriptWithEndButtonLabel('상담 만족도 남기기'));
    vi.mocked(handoffApi.hints).mockResolvedValue(HINTS);

    const user = userEvent.setup();
    renderPage();

    const endButton = await screen.findByRole('button', { name: '상담 종료' });
    await user.click(endButton);

    expect(await screen.findByText("종료 후 사용자에게 '상담 만족도 남기기' 버튼이 함께 표시됩니다.")).toBeInTheDocument();
  });

  it('종료 후 버튼이 설정되지 않은 상담은 미리보기 문구를 보여주지 않는다', async () => {
    vi.mocked(handoffApi.liveSessions).mockResolvedValue(LIVE_LIST);
    vi.mocked(handoffApi.transcript).mockResolvedValue(transcriptWithEndButtonLabel(null));
    vi.mocked(handoffApi.hints).mockResolvedValue(HINTS);

    const user = userEvent.setup();
    renderPage();

    const endButton = await screen.findByRole('button', { name: '상담 종료' });
    await user.click(endButton);

    expect(await screen.findByText('상담을 종료할까요? 사용자에게 종료 안내가 전달됩니다.')).toBeInTheDocument();
    expect(screen.queryByText(/버튼이 함께 표시됩니다/)).not.toBeInTheDocument();
  });
});
