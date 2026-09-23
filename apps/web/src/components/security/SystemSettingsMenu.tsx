import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Permission } from '@chat-bot/shared-types';
import { useAuth } from '../../context/AuthContext';
import { MESSAGES } from '../../constants/messages';
import { deploySchedulesApi } from '../../api/deploySchedules';
import { AttentionCountBadge } from '../AttentionCountBadge';

interface MenuItem {
  label: string;
  href: string;
  permission: Permission;
}

const ITEMS: MenuItem[] = [
  { label: MESSAGES.systemSettings.users, href: '/settings/users', permission: 'user:read' },
  { label: MESSAGES.systemSettings.bannedWords, href: '/settings/banned-words', permission: 'security:read' },
  { label: MESSAGES.systemSettings.auditLogs, href: '/settings/audit-logs', permission: 'audit:read' },
  // No.28: 전역 예약 배포 현황(§1.4) — `chatbot:read`는 사실상 모든 로그인 사용자가 보유해 VIEWER도 보인다.
  { label: MESSAGES.systemSettings.deploySchedules, href: '/settings/deploy-schedules', permission: 'chatbot:read' },
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

  // No.28 E7 — "확인 필요" 총건수 배지(§4.6.5). `chatbot:read`가 있을 때만, 세션 동안 60초 간격
  // (탭 비활성 시 중단). `visibleItems.length===0`이면 트리거 버튼 자체가 렌더되지 않으므로 무관하다.
  const canSeeSchedules = can('chatbot:read');
  const [attentionTotal, setAttentionTotal] = useState(0);
  useEffect(() => {
    if (!canSeeSchedules) return undefined;
    let cancelled = false;
    function fetchSummary(): void {
      deploySchedulesApi
        .summary()
        .then((res) => {
          if (!cancelled) setAttentionTotal(res.needsAttention.total);
        })
        .catch(() => undefined);
    }
    fetchSummary();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') fetchSummary();
    }, 60000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [canSeeSchedules]);

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
        {MESSAGES.systemSettings.label} <span aria-hidden="true">▾</span> <AttentionCountBadge count={attentionTotal} />
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
