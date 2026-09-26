import { useEffect } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { TopBar } from './TopBar';
import { UnsavedGuardProvider } from '../context/UnsavedGuardContext';
import { AuthProvider } from '../context/AuthContext';
import { ToastProvider } from './Toast';
import { authApi } from '../api/auth';
import { inboxApi } from '../api/inbox';
import { ApiError } from '../api/client';
import { makeSummary } from '../test/inboxFixtures';

vi.mock('../api/auth', () => ({
  authApi: { me: vi.fn(), login: vi.fn(), logout: vi.fn().mockResolvedValue(undefined), changePassword: vi.fn() },
}));
vi.mock('../api/handoff', () => ({ handoffApi: { consoleChatbots: vi.fn().mockResolvedValue({ myActiveCount: 0 }) } }));
vi.mock('../api/inbox', () => ({ inboxApi: { summary: vi.fn() } }));

const MOCK_USER = {
  id: 'u1',
  email: 'agent@chat-bot.local',
  name: '김상담',
  role: 'AGENT' as const,
  status: 'ACTIVE' as const,
  mustChangePassword: false,
  lastLoginAt: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  permissions: ['cs:read', 'cs:write'] as const,
};

function DummyPage(): null {
  return null;
}
function Boot(): JSX.Element {
  useEffect(() => undefined, []);
  return <DummyPage />;
}

async function renderTopBar(): Promise<void> {
  render(
    <MemoryRouter initialEntries={['/']}>
      <ToastProvider>
        <AuthProvider>
          <UnsavedGuardProvider>
            <Boot />
            <TopBar />
          </UnsavedGuardProvider>
        </AuthProvider>
      </ToastProvider>
    </MemoryRouter>,
  );
  await screen.findByText('Chat Bot');
}

describe('TopBar — 통합 인박스 진입점(OI-13)', () => {
  beforeEach(() => {
    vi.mocked(authApi.me).mockReset().mockResolvedValue(MOCK_USER as never);
  });

  it('cs:read가 있고 요약 조회가 성공하면 링크가 보인다', async () => {
    vi.mocked(inboxApi.summary).mockResolvedValue(makeSummary({ mine: 3 }));
    await renderTopBar();

    expect(await screen.findByRole('link', { name: /통합 인박스/ })).toBeInTheDocument();
    expect(screen.getByText(/내 담당 3건/)).toBeInTheDocument();
  });

  it('요약 조회가 404(기능 꺼짐)이면 cs:read가 있어도 링크를 숨긴다', async () => {
    vi.mocked(inboxApi.summary).mockRejectedValue(new ApiError(404, 'not found'));
    await renderTopBar();

    await waitFor(() => expect(inboxApi.summary).toHaveBeenCalled());
    expect(screen.queryByRole('link', { name: /통합 인박스/ })).not.toBeInTheDocument();
  });
});
