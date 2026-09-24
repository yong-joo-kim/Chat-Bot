import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ROLE_PERMISSIONS, type RoleName } from '@chat-bot/shared-types';
import { TopBar } from './TopBar';
import { UnsavedGuardProvider } from '../context/UnsavedGuardContext';
import { AuthProvider } from '../context/AuthContext';
import { ToastProvider } from './Toast';
import { authApi } from '../api/auth';
import { handoffApi } from '../api/handoff';

/** [No.24] N1-ext — TopBar "모니터링" 진입점의 역할별 렌더링(hybrid-cs-ui-spec.md §3.9·§5). */
vi.mock('../api/auth', () => ({
  authApi: { me: vi.fn(), login: vi.fn(), logout: vi.fn().mockResolvedValue(undefined), changePassword: vi.fn() },
}));
vi.mock('../api/handoff', () => ({
  handoffApi: { consoleChatbots: vi.fn() },
}));

function userFor(role: RoleName, permissions: string[]) {
  return {
    id: 'u1',
    email: `${role.toLowerCase()}@chat-bot.local`,
    name: '테스트유저',
    role,
    status: 'ACTIVE' as const,
    mustChangePassword: false,
    lastLoginAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    permissions,
  };
}

beforeEach(() => {
  vi.mocked(handoffApi.consoleChatbots).mockReset().mockResolvedValue({ items: [], myActiveCount: 3 } as never);
});

// 역할→권한 매핑은 이 프로젝트의 단일 소스(`packages/shared-types/src/security.ts` `ROLE_PERMISSIONS`)를
// 그대로 쓴다 — 시험이 자체 권한 표를 따로 두면 실제 계약과 어긋날 수 있다(코드 리뷰 지적 사항).
async function renderTopBarAs(role: RoleName): Promise<void> {
  vi.mocked(authApi.me).mockReset().mockResolvedValue(userFor(role, [...ROLE_PERMISSIONS[role]]) as never);
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
  await screen.findByRole('link', { name: '챗봇 목록' });
}

describe('TopBar — "모니터링" 진입점 권한별 렌더링(N1-ext)', () => {
  it('ADMIN은 "모니터링" 링크와 내 상담 배지를 본다', async () => {
    await renderTopBarAs('ADMIN');
    const link = await screen.findByRole('link', { name: /모니터링/ });
    expect(link).toHaveAttribute('href', '/handoff-console');
    // 배지 숫자는 `consoleChatbots()`가 비동기로 resolve된 뒤에야 반영된다 — 링크 자체는 그 전에도
    // 이미 존재하므로(F-4 숨김 판정과 무관), 텍스트 갱신은 별도로 기다린다(레이스 컨디션 방지).
    await waitFor(() => expect(link).toHaveTextContent('내 상담 3건'));
  });

  it('AGENT는 "모니터링" 링크를 본다', async () => {
    await renderTopBarAs('AGENT');
    expect(await screen.findByRole('link', { name: /모니터링/ })).toBeInTheDocument();
  });

  it('EDITOR는 cs:read를 보유하므로(조회 전용) "모니터링" 링크를 본다', async () => {
    await renderTopBarAs('EDITOR');
    expect(await screen.findByRole('link', { name: /모니터링/ })).toBeInTheDocument();
  });

  it('VIEWER는 "모니터링" 링크 자체가 렌더되지 않는다(F-4 숨김 원칙)', async () => {
    await renderTopBarAs('VIEWER');
    expect(screen.queryByRole('link', { name: /모니터링/ })).not.toBeInTheDocument();
  });
});
