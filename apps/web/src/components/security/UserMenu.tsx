import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ROLE_LABELS } from '@chat-bot/shared-types';
import { useAuth } from '../../context/AuthContext';
import { MESSAGES } from '../../constants/messages';
import { ChangePasswordModal } from '../../pages/auth/ChangePasswordModal';

/** N1 `UserMenu`(security-audit-ui-spec.md §3.6) — 역할 배지 표시 + 비밀번호 변경/로그아웃 진입점. */
export function UserMenu(): JSX.Element | null {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    function handleClick(e: MouseEvent): void {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    function handleKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  if (!user) return null;

  async function handleLogout(): Promise<void> {
    setOpen(false);
    await logout();
    // AC-U-8: replace로 히스토리를 대체해 뒤로가기로 이전 화면이 다시 보이지 않게 한다.
    navigate('/login', { replace: true });
  }

  return (
    <div className="top-bar-menu" ref={containerRef}>
      <button
        type="button"
        ref={buttonRef}
        className="top-bar-menu-trigger"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {MESSAGES.auth.userMenuLabel(user.name, ROLE_LABELS[user.role])} <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="top-bar-menu-list" role="menu">
          <button
            type="button"
            role="menuitem"
            className="top-bar-menu-item"
            onClick={() => {
              setOpen(false);
              setChangePasswordOpen(true);
            }}
          >
            {MESSAGES.auth.changePasswordMenu}
          </button>
          <button type="button" role="menuitem" className="top-bar-menu-item" onClick={() => void handleLogout()}>
            {MESSAGES.auth.logoutMenu}
          </button>
        </div>
      )}
      <ChangePasswordModal isOpen={changePasswordOpen} onClose={() => setChangePasswordOpen(false)} />
    </div>
  );
}
