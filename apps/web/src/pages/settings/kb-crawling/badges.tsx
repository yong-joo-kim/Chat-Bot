import { Link } from 'react-router-dom';
import type { KbCleanupReason, KbDemotionReason, KbDocumentState, KbExcludeReason, KbRunDisplayStatus } from '@chat-bot/shared-types';
import { MESSAGES } from '../../../constants/messages';

/**
 * [신규 No.43] 지식베이스 동기화 배지류(`kb-crawling-ui-spec.md` §2.1). 색상+아이콘+텍스트 병기(UIUX §1).
 */

export function KbSourceEnabledBadge({ enabled }: { enabled: boolean }): JSX.Element {
  const msg = MESSAGES.kbSources;
  return (
    <span className={`dialogue-badge${enabled ? '' : ' dialogue-badge--neutral'}`} style={enabled ? { backgroundColor: '#DCFCE7', color: '#166534' } : undefined}>
      <span aria-hidden="true">{enabled ? '●' : '○'}</span> {enabled ? msg.badgeEnabled : msg.badgeDisabled}
    </span>
  );
}

export function KbNeedsPreviewBadge(): JSX.Element {
  return (
    <span className="dialogue-badge" style={{ backgroundColor: '#DBEAFE', color: '#1D4ED8' }}>
      <span aria-hidden="true">ⓘ</span> {MESSAGES.kbSources.badgeNeedsPreview}
    </span>
  );
}

export interface KbNeedsCleanupBadgeProps {
  count: number;
  /** 지정하면 딥링크(문서 목록 탭 "정리 필요만" 필터)로 렌더한다(§13.1 사용자 결정 2). */
  linkTo?: string;
  sourceName?: string;
}

export function KbNeedsCleanupBadge({ count, linkTo, sourceName }: KbNeedsCleanupBadgeProps): JSX.Element {
  const msg = MESSAGES.kbSources;
  const style = { backgroundColor: '#FFEDD5', color: '#9A3412' };
  const content = (
    <>
      <span aria-hidden="true">⚠</span> {msg.badgeNeedsCleanup(count)}
    </>
  );
  if (linkTo) {
    return (
      <Link to={linkTo} className="dialogue-badge" style={style} aria-label={sourceName ? msg.badgeNeedsCleanupLinkLabel(sourceName, count) : undefined}>
        {content}
      </Link>
    );
  }
  return (
    <span className="dialogue-badge" style={style}>
      {content}
    </span>
  );
}

export function KbRepeatedFailureBadge(): JSX.Element {
  return (
    <span className="dialogue-badge" style={{ backgroundColor: '#FEE2E2', color: '#991B1B' }}>
      <span aria-hidden="true">✖</span> {MESSAGES.kbSources.badgeRepeatedFailure}
    </span>
  );
}

export function KbDemotedBadge({ reason }: { reason: KbDemotionReason }): JSX.Element {
  const msg = MESSAGES.kbSources;
  return (
    <span className="dialogue-badge" style={{ backgroundColor: '#FFEDD5', color: '#9A3412' }} title={msg.reviewReasonLabel[reason]}>
      <span aria-hidden="true">⚠</span> {msg.badgeReviewRequired}
    </span>
  );
}

const RUN_STATUS_CONFIG: Record<KbRunDisplayStatus, { icon: string; bg: string; fg: string }> = {
  QUEUED: { icon: '◐', bg: '#F3F4F6', fg: '#374151' },
  CRAWLING: { icon: '↻', bg: '#DBEAFE', fg: '#1D4ED8' },
  INGESTING: { icon: '↻', bg: '#DBEAFE', fg: '#1D4ED8' },
  SUCCEEDED: { icon: '✔', bg: '#DCFCE7', fg: '#166534' },
  PARTIAL: { icon: '◐', bg: '#FFEDD5', fg: '#9A3412' },
  FAILED: { icon: '✖', bg: '#FEE2E2', fg: '#991B1B' },
  CANCELLED: { icon: '⊘', bg: '#F3F4F6', fg: '#374151' },
  INTERRUPTED: { icon: '⧖', bg: '#F3F4F6', fg: '#374151' },
};

export function KbRunStatusBadge({ status }: { status: KbRunDisplayStatus }): JSX.Element {
  const cfg = RUN_STATUS_CONFIG[status];
  return (
    <span className="dialogue-badge" style={{ backgroundColor: cfg.bg, color: cfg.fg }}>
      <span aria-hidden="true">{cfg.icon}</span> {MESSAGES.kbRuns.statusLabel[status]}
    </span>
  );
}

const DOCUMENT_STATE_CONFIG: Record<KbDocumentState, { icon: string; bg: string; fg: string }> = {
  ACTIVE: { icon: '●', bg: '#DCFCE7', fg: '#166534' },
  GONE: { icon: '—', bg: '#F3F4F6', fg: '#374151' },
  EXCLUDED: { icon: '○', bg: '#F3F4F6', fg: '#374151' },
};

export function KbDocumentStateBadge({ state }: { state: KbDocumentState }): JSX.Element {
  const cfg = DOCUMENT_STATE_CONFIG[state];
  return (
    <span className="dialogue-badge" style={{ backgroundColor: cfg.bg, color: cfg.fg }}>
      <span aria-hidden="true">{cfg.icon}</span> {MESSAGES.kbDocuments.stateLabel[state]}
    </span>
  );
}

export function KbCleanupReasonBadge({ reason }: { reason: KbCleanupReason }): JSX.Element {
  const msg = MESSAGES.kbDocuments;
  return (
    <span className="dialogue-badge" style={{ backgroundColor: '#FFEDD5', color: '#9A3412' }} title={msg.cleanupReasonHint[reason]}>
      <span aria-hidden="true">⚠</span> {msg.cleanupReasonLabel[reason]}
    </span>
  );
}

export function KbExcludeReasonBadge({ reason }: { reason: KbExcludeReason }): JSX.Element {
  return (
    <span className="dialogue-badge dialogue-badge--neutral">
      {MESSAGES.kbDocuments.excludeReasonLabel[reason]}
    </span>
  );
}

export function KbTransportAckBadge({ ack }: { ack: 'INTERNAL_NETWORK' | 'AUTHENTICATED' | 'TLS' | null }): JSX.Element {
  const msg = MESSAGES.kbSources;
  if (!ack) {
    return (
      <span className="dialogue-badge" style={{ backgroundColor: '#FFEDD5', color: '#9A3412' }}>
        <span aria-hidden="true">⚠</span> {msg.transportAckLabel.UNCONFIGURED}
      </span>
    );
  }
  return (
    <span className="dialogue-badge" style={{ backgroundColor: '#DCFCE7', color: '#166534' }}>
      <span aria-hidden="true">✔</span> {msg.transportAckLabel[ack]}
    </span>
  );
}

export function KbPiiMaskBadge({ on }: { on: boolean }): JSX.Element {
  const map = MESSAGES.dataGovernance.map;
  return (
    <span className={`dialogue-badge${on ? '' : ' dialogue-badge--neutral'}`} style={on ? { backgroundColor: '#DCFCE7', color: '#166534' } : undefined}>
      {MESSAGES.kbSources.piiMaskBadgeLabel} {on ? map.onLabel : map.offLabel}
    </span>
  );
}

export function KbRawFileBadge({ on }: { on: boolean }): JSX.Element {
  const map = MESSAGES.dataGovernance.map;
  return (
    <span className="dialogue-badge" style={on ? { backgroundColor: '#FFEDD5', color: '#9A3412' } : undefined}>
      {on && <span aria-hidden="true">⚠ </span>}
      {MESSAGES.kbSources.rawFileBadgeLabel} {on ? map.onLabel : map.offLabel}
    </span>
  );
}
