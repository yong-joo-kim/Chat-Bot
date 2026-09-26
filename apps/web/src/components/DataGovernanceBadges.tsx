import { useState } from 'react';
import type { AuditChainVerifyStatus, EgressDecision, RetentionRunItem } from '@chat-bot/shared-types';
import { MESSAGES } from '../constants/messages';
import { InlineFieldError } from './InlineFieldError';

/**
 * No.45 데이터 거버넌스 공용 배지·표시 컴포넌트(`data-governance-ui-spec.md` §2.3). 색상 단독으로
 * 의미를 전달하지 않는다(UIUX §1, NFR-DGA1) — 전부 아이콘/텍스트를 병행한다.
 */

const EGRESS_JUDGEMENT_CONFIG: Record<EgressDecision, { icon: string; bg: string; fg: string }> = {
  ALLOWED: { icon: '●', bg: '#DCFCE7', fg: '#166534' },
  BLOCKED: { icon: '✖', bg: '#FEE2E2', fg: '#991B1B' },
  NOT_CONFIGURED: { icon: '—', bg: '#F3F4F6', fg: '#374151' },
  NOT_ENFORCED: { icon: 'ⓘ', bg: '#F3F4F6', fg: '#374151' },
};

export function EgressJudgementBadge({ decision }: { decision: EgressDecision }): JSX.Element {
  const cfg = EGRESS_JUDGEMENT_CONFIG[decision];
  const label = MESSAGES.dataGovernance.map.egressJudgement[decision];
  return (
    <span className="dialogue-badge" style={{ backgroundColor: cfg.bg, color: cfg.fg }}>
      <span aria-hidden="true">{cfg.icon}</span> {label}
    </span>
  );
}

const CHAIN_VERIFY_CONFIG: Record<AuditChainVerifyStatus, { icon: string; bg: string; fg: string }> = {
  OK: { icon: '✔', bg: '#DCFCE7', fg: '#166534' },
  EMPTY: { icon: 'ⓘ', bg: '#F3F4F6', fg: '#374151' },
  HASH_MISMATCH: { icon: '✖', bg: '#FEE2E2', fg: '#991B1B' },
  SEQ_GAP: { icon: '✖', bg: '#FEE2E2', fg: '#991B1B' },
  TAIL_MISSING: { icon: '✖', bg: '#FEE2E2', fg: '#991B1B' },
  KEY_UNAVAILABLE: { icon: '⚠', bg: '#FEF3C7', fg: '#92400E' },
  ANCHOR_MISSING: { icon: '⚠', bg: '#FEF3C7', fg: '#92400E' },
};

export function ChainVerifyResultBadge({ status }: { status: AuditChainVerifyStatus }): JSX.Element {
  const cfg = CHAIN_VERIFY_CONFIG[status];
  const label = MESSAGES.dataGovernance.chainVerify.result[status];
  return (
    <span className="dialogue-badge" style={{ backgroundColor: cfg.bg, color: cfg.fg }}>
      <span aria-hidden="true">{cfg.icon}</span> {label}
    </span>
  );
}

const PURGE_RUN_STATUS_CONFIG: Record<RetentionRunItem['status'], { icon: string; bg: string; fg: string }> = {
  SUCCEEDED: { icon: '✔', bg: '#DCFCE7', fg: '#166534' },
  PARTIAL: { icon: '◐', bg: '#FEF3C7', fg: '#92400E' },
  FAILED: { icon: '✖', bg: '#FEE2E2', fg: '#991B1B' },
};

/** `RetentionRun.status` 3값 + `resultCode` 보조 문구(data-governance-ui-spec.md §3.3). */
export function PurgeRunResultBadge({ status, resultCode }: { status: RetentionRunItem['status']; resultCode?: string | null }): JSX.Element {
  const cfg = PURGE_RUN_STATUS_CONFIG[status];
  const label = MESSAGES.dataGovernance.purgeHistory.status[status];
  const resultCodeLabels = MESSAGES.dataGovernance.purgeHistory.resultCode as Record<string, string>;
  const detail = resultCode ? resultCodeLabels[resultCode] : undefined;
  return (
    <span>
      <span className="dialogue-badge" style={{ backgroundColor: cfg.bg, color: cfg.fg }}>
        <span aria-hidden="true">{cfg.icon}</span> {label}
      </span>
      {detail && <p className="field-hint">{detail}</p>}
    </span>
  );
}

/** 보존기간 경과로 소거된 텍스트 자리 표시(NFR-DGA4 — 회색만이 아니라 텍스트로 읽힌다). */
export function PurgedFieldNotice(): JSX.Element {
  return (
    <span className="purged-text">
      <span aria-hidden="true">🗑</span> {MESSAGES.dataGovernance.purgedText}
    </span>
  );
}

/** 복호화 실패 자리 표시 — `PurgedFieldNotice`와 시각적으로 다른 경고 톤(§5.5). */
export function DecryptFailedNotice(): JSX.Element {
  return (
    <span className="decrypt-failed-text">
      <span aria-hidden="true">⚠</span> {MESSAGES.dataGovernance.decryptFailedText}
    </span>
  );
}

/**
 * G5 파기 표시(횡단) — `purged`가 true면 `PurgedFieldNotice`, 텍스트가 리터럴 "[복호화 실패]"이면
 * `DecryptFailedNotice`, 그 외에는 원문을 그대로 렌더한다(data-governance-ui-spec.md §3.7).
 * `#PURGED#` 같은 서버 내부 센티넬은 이 컴포넌트를 거치지 않은 필드(`questionNormalized` 등)에만
 * 남아 있어야 하며, 화면에 노출되는 필드는 전부 이 헬퍼를 통과한다.
 */
export function GovernedTextValue({ text, purged }: { text: string; purged?: boolean }): JSX.Element {
  if (purged) return <PurgedFieldNotice />;
  if (text === MESSAGES.dataGovernance.decryptFailedText) return <DecryptFailedNotice />;
  return <>{text}</>;
}

export interface RetentionConfirmFieldProps {
  /** 고정 문구("보존기간 단축") 또는 챗봇 이름. */
  expected: string;
  value: string;
  onChange: (value: string) => void;
  /** 전역(G1-b)/챗봇(G2)에 따라 라벨·불일치 문구가 다르다. */
  variant: 'GLOBAL' | 'CHATBOT';
}

/**
 * `RawPersonalDataConfirmField`와 동일한 패턴(data-governance-ui-spec.md §2.3) — 재입력 텍스트가
 * 기대값과 다르면 인라인 오류 + 저장 버튼 비활성(부모가 처리)을 유도한다.
 */
export function RetentionConfirmField({ expected, value, onChange, variant }: RetentionConfirmFieldProps): JSX.Element {
  const msg = MESSAGES.dataGovernance.retention;
  const mismatch = value.length > 0 && value !== expected;
  const label = variant === 'GLOBAL' ? msg.confirmLabelGlobal : msg.confirmLabelChatbot(expected);
  const mismatchMessage = variant === 'GLOBAL' ? msg.confirmMismatchGlobal : msg.confirmMismatchChatbot(expected);
  return (
    <div className="form-field">
      <label htmlFor="retention-confirm-text">{label}</label>
      <input
        id="retention-confirm-text"
        type="text"
        maxLength={100}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={mismatch}
        aria-describedby="retention-confirm-text-error"
      />
      <InlineFieldError id="retention-confirm-text-error" message={mismatch ? mismatchMessage : undefined} />
    </div>
  );
}

/** 해시 앞 12자리만 보이고 전체 복사 버튼을 제공한다(data-governance-ui-spec.md §13-4 확정). */
export function TruncatedHash({ hash }: { hash: string }): JSX.Element {
  const [copied, setCopied] = useState(false);
  const prefix = hash.slice(0, 12);
  async function handleCopy(): Promise<void> {
    try {
      if (!navigator.clipboard) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(hash);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // 클립보드 API를 쓸 수 없으면 조용히 무시한다 — 값은 이미 화면에 앞 12자리로 보인다.
    }
  }
  return (
    <span className="truncated-hash">
      <code>{prefix}…</code>{' '}
      <button type="button" className="btn btn-secondary" onClick={() => void handleCopy()}>
        {copied ? `✔ ${MESSAGES.common.copied}` : MESSAGES.common.copy}
      </button>
    </span>
  );
}
