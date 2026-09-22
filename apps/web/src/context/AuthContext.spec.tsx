import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthProvider, useAuth } from './AuthContext';
import { makeCurrentUser } from '../test/fixtures';
import { ApiError } from '../api/client';

const mockMe = vi.fn();
const mockLogin = vi.fn();
const mockLogout = vi.fn();

vi.mock('../api/auth', () => ({
  authApi: {
    me: (...args: unknown[]) => mockMe(...args),
    login: (...args: unknown[]) => mockLogin(...args),
    logout: (...args: unknown[]) => mockLogout(...args),
    changePassword: vi.fn(),
  },
}));

function Probe(): JSX.Element {
  const { status, user, can, login, logout } = useAuth();
  return (
    <div>
      <p data-testid="status">{status}</p>
      <p data-testid="email">{user?.email ?? ''}</p>
      <p data-testid="can-write">{can('dialogue:write') ? 'yes' : 'no'}</p>
      <p data-testid="can-audit">{can('audit:read') ? 'yes' : 'no'}</p>
      <button type="button" onClick={() => void login('a@b.com', 'pw')}>
        로그인시도
      </button>
      <button type="button" onClick={() => void logout()}>
        로그아웃
      </button>
    </div>
  );
}

/**
 * `AuthContext`(L0 게이트의 실체) 자동시험 — 신규 화면·컨텍스트 전용 자동화 테스트 0건이었던
 * 공백을 메운다. 부팅 시 `GET /auth/me` 1회, 로그인/로그아웃 성공 시 상태 전환, `can()`이
 * 서버가 내려준 `permissions[]`만 근거로 판정하는지(역할 문자열 하드코딩 금지, FR-U-3)를 검증한다.
 */
describe('AuthContext — 부팅/로그인/로그아웃/권한 판정', () => {
  beforeEach(() => {
    mockMe.mockReset();
    mockLogin.mockReset();
    mockLogout.mockReset();
  });

  it('부팅 시 GET /auth/me가 성공하면 status가 ready로 전환되고 permissions로 can()이 판정된다', async () => {
    mockMe.mockResolvedValue(makeCurrentUser({ permissions: ['dialogue:read', 'dialogue:write'] }));
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('ready'));
    expect(screen.getByTestId('email').textContent).toBe('editor@chat-bot.local');
    expect(screen.getByTestId('can-write').textContent).toBe('yes');
    // audit:read는 permissions 배열에 없으므로 EDITOR라 해도 false여야 한다(문자열 하드코딩 금지 검증).
    expect(screen.getByTestId('can-audit').textContent).toBe('no');
  });

  it('부팅 시 GET /auth/me가 401이면 status가 unauthenticated가 된다', async () => {
    mockMe.mockRejectedValue(new ApiError(401, '로그인이 필요합니다.', 'UNAUTHENTICATED'));
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('unauthenticated'));
    expect(screen.getByTestId('email').textContent).toBe('');
  });

  it('mustChangePassword=true인 사용자는 password-change-required 상태가 된다', async () => {
    mockMe.mockResolvedValue(makeCurrentUser({ mustChangePassword: true }));
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('password-change-required'));
  });

  it('login() 성공 시 응답의 user로 상태가 갱신된다', async () => {
    mockMe.mockRejectedValue(new ApiError(401, '', 'UNAUTHENTICATED'));
    mockLogin.mockResolvedValue({ status: 'OK', user: makeCurrentUser({ email: 'new-login@chat-bot.local' }) });
    const user = userEvent.setup();
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('unauthenticated'));

    await user.click(screen.getByText('로그인시도'));
    await waitFor(() => expect(screen.getByTestId('email').textContent).toBe('new-login@chat-bot.local'));
    expect(screen.getByTestId('status').textContent).toBe('ready');
  });

  it('logout()은 실패해도(네트워크 오류 등) 클라이언트 상태를 항상 unauthenticated로 정리한다(FR-12-8 멱등 취지)', async () => {
    mockMe.mockResolvedValue(makeCurrentUser());
    mockLogout.mockRejectedValue(new Error('network'));
    const user = userEvent.setup();
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('ready'));

    await user.click(screen.getByText('로그아웃'));
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('unauthenticated'));
    expect(screen.getByTestId('email').textContent).toBe('');
  });

  it('useAuth를 AuthProvider 밖에서 호출하면 에러를 던진다', () => {
    function Bare(): JSX.Element {
      useAuth();
      return <div />;
    }
    expect(() => render(<Bare />)).toThrow('useAuth는 AuthProvider 내부에서만 사용할 수 있습니다.');
  });
});
