import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { CurrentUser, Permission } from '@chat-bot/shared-types';
import { authApi } from '../api/auth';
import { ApiError } from '../api/client';
import { registerSessionExpiredHandler } from '../api/client';
import { SessionExpiredModal } from '../components/security/SessionExpiredModal';

export type AuthStatus = 'loading' | 'unauthenticated' | 'password-change-required' | 'ready';

export interface AuthContextValue {
  status: AuthStatus;
  user: CurrentUser | null;
  can: (permission: Permission) => boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshMe: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * L0(`AuthGate`) 로직의 실체(security-audit-ui-spec.md §3.1). 부팅 시 `GET /auth/me`를 1회
 * 호출해 인증 상태를 확정하고, 이후에는 로그인/로그아웃/비밀번호변경 성공 시에만 재조회한다
 * (요청마다 재조회하지 않음). L3(세션만료 모달)의 전역 401 훅도 여기서 등록한다(§3.4).
 */
export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [reauthResolver, setReauthResolver] = useState<((ok: boolean) => void) | null>(null);

  const applyCurrentUser = useCallback((u: CurrentUser) => {
    setUser(u);
    setStatus(u.mustChangePassword ? 'password-change-required' : 'ready');
  }, []);

  const refreshMe = useCallback(async () => {
    try {
      const me = await authApi.me();
      applyCurrentUser(me);
    } catch {
      setUser(null);
      setStatus('unauthenticated');
    }
  }, [applyCurrentUser]);

  useEffect(() => {
    void refreshMe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    registerSessionExpiredHandler(
      () =>
        new Promise<boolean>((resolve) => {
          setReauthResolver(() => resolve);
        }),
    );
    return () => registerSessionExpiredHandler(null);
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await authApi.login({ email, password });
      applyCurrentUser(res.user);
    },
    [applyCurrentUser],
  );

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } catch {
      // FR-12-8: 로그아웃은 멱등이며 실패해도 클라이언트 상태는 항상 정리한다.
    }
    setUser(null);
    setStatus('unauthenticated');
  }, []);

  const can = useCallback((permission: Permission) => (user ? user.permissions.includes(permission) : false), [user]);

  function handleReauthSuccess(loggedInUser: CurrentUser): void {
    applyCurrentUser(loggedInUser);
    reauthResolver?.(true);
    setReauthResolver(null);
  }

  function handleReauthCancel(): void {
    reauthResolver?.(false);
    setReauthResolver(null);
  }

  const value = useMemo<AuthContextValue>(
    () => ({ status, user, can, login, logout, refreshMe }),
    [status, user, can, login, logout, refreshMe],
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
      {reauthResolver && user && (
        <SessionExpiredModal email={user.email} onSuccess={handleReauthSuccess} onCancel={handleReauthCancel} />
      )}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth는 AuthProvider 내부에서만 사용할 수 있습니다.');
  return ctx;
}

export function isApiError401(e: unknown): boolean {
  return e instanceof ApiError && e.status === 401;
}
