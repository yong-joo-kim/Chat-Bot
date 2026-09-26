import type { ApiCallOutcome, ApiSecretStatus } from '@chat-bot/shared-types';
import { MESSAGES } from '../../../constants/messages';

/** AC1 — 연결 목록·편집기·설계 점검 공용 배지(ui-spec §2.1). 색상+텍스트 병기(UIUX §1). */
export function SecretStatusBadge({ status }: { status: ApiSecretStatus }): JSX.Element {
  const msg = MESSAGES.apiConnections;
  const config: Record<ApiSecretStatus, { label: string; bg: string; fg: string }> = {
    NOT_REQUIRED: { label: msg.secretStatusNotRequired, bg: '#F3F4F6', fg: '#374151' },
    CONFIGURED: { label: msg.secretStatusConfigured, bg: '#DCFCE7', fg: '#166534' },
    MISSING: { label: msg.secretStatusMissing, bg: '#FEE2E2', fg: '#991B1B' },
  };
  const cfg = config[status];
  return (
    <span className="dialogue-badge" style={{ backgroundColor: cfg.bg, color: cfg.fg }}>
      {cfg.label}
    </span>
  );
}

export function ConnectionEnabledBadge({ enabled }: { enabled: boolean }): JSX.Element {
  const msg = MESSAGES.apiConnections;
  return (
    <span className={`dialogue-badge${enabled ? '' : ' dialogue-badge--neutral'}`} style={enabled ? { backgroundColor: '#DCFCE7', color: '#166534' } : undefined}>
      <span aria-hidden="true">{enabled ? '●' : '○'}</span> {enabled ? msg.badgeEnabled : msg.badgeDisabled}
    </span>
  );
}

export function CircuitOpenBadge(): JSX.Element {
  const msg = MESSAGES.apiConnections;
  return (
    <span className="dialogue-badge" style={{ backgroundColor: '#FFEDD5', color: '#9A3412' }} title={msg.badgeCircuitOpenTitle}>
      <span aria-hidden="true">⚠</span> {msg.badgeCircuitOpen}
    </span>
  );
}

export function InsecureHttpBadge(): JSX.Element {
  const msg = MESSAGES.apiConnections;
  return (
    <span className="dialogue-badge" style={{ backgroundColor: '#FFEDD5', color: '#9A3412' }}>
      <span aria-hidden="true">ⓘ</span> {msg.badgeInsecureHttp}
    </span>
  );
}

export function PersonalDataLookupBadge(): JSX.Element {
  const msg = MESSAGES.apiConnections;
  return (
    <span className="dialogue-badge" style={{ backgroundColor: '#DBEAFE', color: '#1D4ED8' }}>
      <span aria-hidden="true">ⓘ</span> {msg.badgePersonalDataLookup}
    </span>
  );
}

export function RawPersonalDataBadge(): JSX.Element {
  const msg = MESSAGES.apiConnections;
  return (
    <span className="dialogue-badge" style={{ backgroundColor: '#FFEDD5', color: '#9A3412' }}>
      <span aria-hidden="true">⚠</span> {msg.badgeRawPersonalData}
    </span>
  );
}

const OUTCOME_TONE: Record<ApiCallOutcome, { bg: string; fg: string }> = {
  SUCCESS: { bg: '#DCFCE7', fg: '#166534' },
  MAPPING_MISSING: { bg: '#FFEDD5', fg: '#9A3412' },
  HTTP_ERROR: { bg: '#FFEDD5', fg: '#9A3412' },
  TIMEOUT: { bg: '#FFEDD5', fg: '#9A3412' },
  NETWORK_ERROR: { bg: '#FFEDD5', fg: '#9A3412' },
  INVALID_RESPONSE: { bg: '#FFEDD5', fg: '#9A3412' },
  RESPONSE_TOO_LARGE: { bg: '#FFEDD5', fg: '#9A3412' },
  REDIRECT_NOT_ALLOWED: { bg: '#F3F4F6', fg: '#374151' },
  BLOCKED_ADDRESS: { bg: '#F3F4F6', fg: '#374151' },
  BLOCKED_URL: { bg: '#F3F4F6', fg: '#374151' },
  CIRCUIT_OPEN: { bg: '#F3F4F6', fg: '#374151' },
  RATE_LIMITED: { bg: '#F3F4F6', fg: '#374151' },
  CONNECTION_DISABLED: { bg: '#F3F4F6', fg: '#374151' },
  CONNECTION_MISSING: { bg: '#F3F4F6', fg: '#374151' },
  METHOD_NOT_ALLOWED: { bg: '#F3F4F6', fg: '#374151' },
  SECRET_MISSING: { bg: '#F3F4F6', fg: '#374151' },
  BINDING_MISSING: { bg: '#F3F4F6', fg: '#374151' },
  FEATURE_DISABLED: { bg: '#F3F4F6', fg: '#374151' },
  /** [신규 No.45] 출구 허용 목록 밖 호스트 차단(`BLOCKED_ADDRESS`·`BLOCKED_URL`과 같은 중립-경고 톤). */
  EGRESS_BLOCKED: { bg: '#F3F4F6', fg: '#374151' },
};

/** 외부 연동 로그(L1) 전용 — 관리자 화면에만 노출한다(FR-L9-7, 사용자에게는 절대 노출되지 않음). */
export function ApiCallOutcomeBadge({ outcome }: { outcome: ApiCallOutcome }): JSX.Element {
  const cfg = OUTCOME_TONE[outcome];
  return (
    <span className="dialogue-badge" style={{ backgroundColor: cfg.bg, color: cfg.fg }}>
      {MESSAGES.apiCallLogs.outcomeLabel[outcome]}
    </span>
  );
}

/** 노드 편집기 v1 카드(§4.2) — INFO 톤의 `UnsupportedOutputBadge`와 다르게 WARNING 톤으로 "전환 가능"임을 구분한다. */
export function LegacyFormatBadge(): JSX.Element {
  return (
    <span className="dialogue-badge" style={{ backgroundColor: '#FEF3C7', color: '#92400E' }}>
      <span aria-hidden="true">⚠</span> {MESSAGES.dialogue.outputFields.legacyBadgeLabel}
    </span>
  );
}
