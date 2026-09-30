import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { TopBar } from './TopBar';
import { UnsavedGuardProvider } from '../context/UnsavedGuardContext';
import { AuthProvider } from '../context/AuthContext';
import { ToastProvider } from './Toast';
import { authApi } from '../api/auth';
import { switchApprovalsApi } from '../api/switchApprovals';

vi.mock('../api/auth', () => ({
  authApi: { me: vi.fn(), login: vi.fn(), logout: vi.fn().mockResolvedValue(undefined), changePassword: vi.fn() },
}));
vi.mock('../api/handoff', () => ({ handoffApi: { consoleChatbots: vi.fn().mockResolvedValue({ myActiveCount: 0 }) } }));
vi.mock('../api/inbox', () => ({ inboxApi: { summary: vi.fn().mockRejectedValue(new Error('x')) } }));
vi.mock('../api/switchApprovals', () => ({ switchApprovalsApi: { summary: vi.fn() } }));

function user(permissions: string[]): unknown {
  return {
    id: 'u1',
    email: 'admin@chat-bot.local',
    name: '관리자',
    role: 'ADMIN',
    status: 'ACTIVE',
    mustChangePassword: false,
    lastLoginAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    permissions,
    governanceModeOn: false,
  };
}

async function renderTopBar(): Promise<void> {
  render(
    <MemoryRouter initialEntries={['/']}>
      <ToastProvider>
        <AuthProvider>
          <UnsavedGuardProvider>
            <TopBar />
          </UnsavedGuardProvider>
        </AuthProvider>
      </ToastProvider>
    </MemoryRouter>,
  );
  await screen.findByText('Chat Bot');
}

beforeEach(() => {
  vi.mocked(authApi.me).mockReset();
  vi.mocked(switchApprovalsApi.summary).mockReset();
});

describe('TopBar — 운영 전환 "승인 대기" 링크(§9.8)', () => {
  it('chatbot:deploy가 있으면 링크를 보이고 pendingForMe가 있으면 (n)을 붙인다 — aria-live는 쓰지 않는다', async () => {
    vi.mocked(authApi.me).mockResolvedValue(user(['chatbot:deploy']) as never);
    vi.mocked(switchApprovalsApi.summary).mockResolvedValue({ pendingTotal: 4, pendingForMe: 3 });
    await renderTopBar();
    const link = await screen.findByRole('link', { name: '승인 대기 (3)' });
    expect(link).toHaveAttribute('href', '/environment-approvals');
    expect(link.closest('[aria-live]')).toBeNull();
  });

  it('건수가 0이면 숫자 없이 링크만 보이고, 요약 조회가 실패해도 링크는 유지된다(조용히 무시)', async () => {
    vi.mocked(authApi.me).mockResolvedValue(user(['chatbot:deploy']) as never);
    vi.mocked(switchApprovalsApi.summary).mockRejectedValue(new Error('boom'));
    await renderTopBar();
    expect(await screen.findByRole('link', { name: '승인 대기' })).toBeInTheDocument();
    await waitFor(() => expect(switchApprovalsApi.summary).toHaveBeenCalled());
    expect(screen.queryByText(/\(\d+\)/)).toBeNull();
  });

  it('chatbot:deploy가 없으면 링크를 렌더하지 않고 요약도 조회하지 않는다(F-4 숨김 원칙)', async () => {
    vi.mocked(authApi.me).mockResolvedValue(user(['chatbot:read']) as never);
    await renderTopBar();
    expect(screen.queryByRole('link', { name: /승인 대기/ })).toBeNull();
    expect(switchApprovalsApi.summary).not.toHaveBeenCalled();
  });
});
