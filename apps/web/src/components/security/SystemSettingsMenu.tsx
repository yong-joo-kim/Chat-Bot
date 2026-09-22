import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Permission } from '@chat-bot/shared-types';
import { useAuth } from '../../context/AuthContext';
import { MESSAGES } from '../../constants/messages';

interface MenuItem {
  label: string;
  href: string;
  permission: Permission;
}

const ITEMS: MenuItem[] = [
  { label: MESSAGES.systemSettings.users, href: '/settings/users', permission: 'user:read' },
  { label: MESSAGES.systemSettings.bannedWords, href: '/settings/banned-words', permission: 'security:read' },
  { label: MESSAGES.systemSettings.auditLogs, href: '/settings/audit-logs', permission: 'audit:read' },
];

/**
 * N1 `SystemSettingsMenu`(security-audit-ui-spec.md §3.6). 권한이 없는 항목은 렌더 자체를
 * 하지 않는다(F-4) — 셋 다 없으면 트리거 버튼 자체를 숨긴다(빈 드롭다운 금지).
 */
export function SystemSettingsMenu(): JSX.Element | null {
  const { can } = useAuth();
  const visibleItems = ITEMS.filter((item) => can(item.permission));
  const [open, setOpen] = useState(false);
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

  if (visibleItems.length === 0) return null;

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
        {MESSAGES.systemSettings.label} <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="top-bar-menu-list" role="menu">
          {visibleItems.map((item) => (
            <Link key={item.href} to={item.href} role="menuitem" className="top-bar-menu-item" onClick={() => setOpen(false)}>
              {item.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
