import type { ChatbotStatus } from '@chat-bot/shared-types';
import { MESSAGES } from '../constants/messages';

/** 색상 단독 전달 금지(UIUX §1) — 색상 + 아이콘 + 텍스트 레이블을 항상 병기한다. */
const STATUS_CONFIG: Record<ChatbotStatus, { icon: string; bg: string; fg: string }> = {
  DRAFT: { icon: '✎', bg: '#F3F4F6', fg: '#374151' },
  ACTIVE: { icon: '●', bg: '#DCFCE7', fg: '#166534' },
  ARCHIVED: { icon: '▤', bg: '#FEF3C7', fg: '#92400E' },
};

export function StatusBadge({ status, size = 'md' }: { status: ChatbotStatus; size?: 'sm' | 'md' }): JSX.Element {
  const cfg = STATUS_CONFIG[status];
  return (
    <span className={`status-badge status-badge--${size}`} style={{ backgroundColor: cfg.bg, color: cfg.fg }}>
      <span aria-hidden="true">{cfg.icon}</span>
      {MESSAGES.status[status]}
    </span>
  );
}
