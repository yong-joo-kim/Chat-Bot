import type { CustomerKind, InboxSourceFamily, InboxThreadStatus, IdentitySecretStatus, RecordChannel } from '@chat-bot/shared-types';
import { MESSAGES } from '../../constants/messages';
import { formatDateTime } from '../../lib/date';

/**
 * 옴니채널 통합 인박스(No.42) 신규 배지(`omnichannel-inbox-ui-spec.md` §2.2). 색상 단독 전달 금지
 * (UIUX §1) — 전부 아이콘+텍스트를 병행한다. `Record<Enum,…>`로 구현해 신규 열거값 추가 시 컴파일이
 * 깨지게 한다(No.45 `AuditActionBadge` 선례).
 */

export function InboxThreadStatusBadge({
  status,
  snoozeUntil,
  snoozeExpired,
}: {
  status: InboxThreadStatus;
  snoozeUntil?: string | Date;
  snoozeExpired?: boolean;
}): JSX.Element {
  const msg = MESSAGES.inbox;
  const CONFIG: Record<InboxThreadStatus, { icon: string; bg: string; fg: string }> = {
    OPEN: { icon: '●', bg: '#DCFCE7', fg: '#166534' },
    PENDING: { icon: '◐', bg: '#FEF3C7', fg: '#92400E' },
    CLOSED: { icon: '○', bg: '#F3F4F6', fg: '#374151' },
  };
  const cfg = CONFIG[status];
  let label: string = msg.statusOpen;
  if (status === 'PENDING') {
    label = snoozeExpired || !snoozeUntil ? msg.statusPendingExpired : msg.statusPending(formatDateTime(snoozeUntil));
  } else if (status === 'CLOSED') {
    label = msg.statusClosed;
  }
  return (
    <span>
      <span className="dialogue-badge" style={{ backgroundColor: cfg.bg, color: cfg.fg }}>
        <span aria-hidden="true">{cfg.icon}</span> {label}
      </span>
      {status === 'PENDING' && snoozeExpired && <p className="field-hint">{msg.statusPendingStaleHint}</p>}
    </span>
  );
}

export function CustomerKindBadge({ kind }: { kind: CustomerKind }): JSX.Element {
  const msg = MESSAGES.inbox;
  const CONFIG: Record<CustomerKind, { icon: string; bg: string; fg: string; label: string }> = {
    IDENTIFIED: { icon: '✔', bg: '#DBEAFE', fg: '#1D4ED8', label: msg.kindIdentified },
    ANONYMOUS: { icon: '?', bg: '#F3F4F6', fg: '#374151', label: msg.kindAnonymous },
    TEST: { icon: '🧪', bg: '#EDE9FE', fg: '#5B21B6', label: msg.kindTest },
  };
  const cfg = CONFIG[kind];
  return (
    <span className="dialogue-badge" style={{ backgroundColor: cfg.bg, color: cfg.fg }}>
      <span aria-hidden="true">{cfg.icon}</span> {cfg.label}
    </span>
  );
}

const RECORD_CHANNEL_BADGE_CONFIG: Record<RecordChannel, { icon: string; label: keyof typeof MESSAGES.inbox }> = {
  PHONE: { icon: '☎', label: 'channelRecordPhone' },
  EMAIL: { icon: '✉', label: 'channelRecordEmail' },
  VISIT: { icon: '📍', label: 'channelRecordVisit' },
  OTHER: { icon: '•', label: 'channelRecordOther' },
};

export type ChannelFamilyBadgeProps =
  | { family: 'DEPLOY'; label: string }
  | { family: 'RECORD'; recordChannel: RecordChannel }
  | { family: 'SIMULATED'; label: string };

/** `family`별 렌더 규칙이 다르다(§2.2) — DEPLOY는 채널 라벨 그대로, RECORD는 기록 채널별 아이콘, SIMULATED는 "시뮬레이션 · {라벨}(가상)". */
export function ChannelFamilyBadge(props: ChannelFamilyBadgeProps): JSX.Element {
  const msg = MESSAGES.inbox;
  if (props.family === 'DEPLOY') {
    return <span className="dialogue-badge dialogue-badge--neutral">{props.label}</span>;
  }
  if (props.family === 'RECORD') {
    const cfg = RECORD_CHANNEL_BADGE_CONFIG[props.recordChannel];
    return (
      <span className="dialogue-badge dialogue-badge--neutral">
        <span aria-hidden="true">{cfg.icon}</span> {msg[cfg.label] as string}
      </span>
    );
  }
  return (
    <span className="dialogue-badge" style={{ backgroundColor: '#EDE9FE', color: '#5B21B6' }}>
      <span aria-hidden="true">🧪</span> {msg.channelSimulated(props.label)}
    </span>
  );
}

export function IdentitySecretStatusBadge({ status }: { status: IdentitySecretStatus }): JSX.Element {
  const msg = MESSAGES.inboxSettings;
  const CONFIG: Record<IdentitySecretStatus, { icon: string; bg: string; fg: string; label: string }> = {
    NOT_SET: { icon: '—', bg: '#F3F4F6', fg: '#374151', label: msg.secretStatusNotSet },
    MISSING: { icon: '⚠', bg: '#FEF3C7', fg: '#92400E', label: msg.secretStatusMissing },
    WEAK: { icon: '⚠', bg: '#FEF3C7', fg: '#92400E', label: msg.secretStatusWeak },
    CONFIGURED: { icon: '✔', bg: '#DCFCE7', fg: '#166534', label: msg.secretStatusConfigured },
  };
  const cfg = CONFIG[status];
  return (
    <span className="dialogue-badge" style={{ backgroundColor: cfg.bg, color: cfg.fg }}>
      <span aria-hidden="true">{cfg.icon}</span> {cfg.label}
    </span>
  );
}

/** 시험 고객 상시 라벨(NFR-OCA3) — 말풍선 자체에 병기한다(색상 배경만으로 구분하지 않음). */
export function SimulationBadge(): JSX.Element {
  return (
    <span className="dialogue-badge" style={{ backgroundColor: '#EDE9FE', color: '#5B21B6' }}>
      <span aria-hidden="true">🧪</span> {MESSAGES.inbox.simulationBadge}
    </span>
  );
}
