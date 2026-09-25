import type { ChatbotVersionListItem } from '@chat-bot/shared-types';
import { MESSAGES } from '../constants/messages';

/**
 * 버전 이력(No.25) 트리거 6종 고정 시각 언어(`version-history-ui-spec.md` §3.3-1).
 * 색상은 그룹별로만 옅게 구분하되 아이콘 + 텍스트 라벨을 항상 병행한다(UIUX §1, 색상 단독 금지).
 */
const GROUP_STYLE: Record<'MANUAL' | 'AUTO' | 'RESTORE_BACKUP' | 'ENVIRONMENT', { icon: string; bg: string; fg: string }> = {
  MANUAL: { icon: '👤', bg: '#DBEAFE', fg: '#1D4ED8' },
  AUTO: { icon: '⚙', bg: '#F3F4F6', fg: '#374151' },
  RESTORE_BACKUP: { icon: '↺', bg: '#FFEDD5', fg: '#9A3412' },
  // [신규 No.40] 환경 분리 — 켜기(자동 캡처) · 스테이징 승격.
  ENVIRONMENT: { icon: '🌐', bg: '#E0E7FF', fg: '#3730A3' },
};

function groupOf(trigger: ChatbotVersionListItem['trigger']): 'MANUAL' | 'AUTO' | 'RESTORE_BACKUP' | 'ENVIRONMENT' {
  if (trigger === 'MANUAL') return 'MANUAL';
  if (trigger === 'BEFORE_RESTORE') return 'RESTORE_BACKUP';
  if (trigger === 'ENV_INIT' || trigger === 'PROMOTE') return 'ENVIRONMENT';
  return 'AUTO';
}

export function VersionTriggerBadge({
  trigger,
  triggerContext,
  restoredFromVersionNo,
}: {
  trigger: ChatbotVersionListItem['trigger'];
  triggerContext: ChatbotVersionListItem['triggerContext'];
  restoredFromVersionNo: ChatbotVersionListItem['restoredFromVersionNo'];
}): JSX.Element {
  const group = groupOf(trigger);
  const style = GROUP_STYLE[group];
  const msg = MESSAGES.versions.triggerBadge;
  const label = trigger === 'BEFORE_RESTORE' ? msg.BEFORE_RESTORE(restoredFromVersionNo ?? 0) : msg[trigger];
  const resourceType = triggerContext?.resourceType;
  const resourceLabel = resourceType ? MESSAGES.versions.resourceTypeLabel[resourceType] : undefined;

  return (
    <span className="version-trigger-badge" style={{ backgroundColor: style.bg, color: style.fg }}>
      <span aria-hidden="true">{style.icon}</span> {label}
      {resourceLabel && `(${resourceLabel})`}
    </span>
  );
}
