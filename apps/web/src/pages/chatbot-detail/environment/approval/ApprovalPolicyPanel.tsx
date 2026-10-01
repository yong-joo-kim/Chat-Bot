import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ApprovalPolicyStatus } from '@chat-bot/shared-types';
import { APPROVAL_TTL_HOURS } from '@chat-bot/shared-types';
import { switchApprovalsApi } from '../../../../api/switchApprovals';
import { ConfirmDialog, Modal } from '../../../../components/Modal';
import { InlineFieldError } from '../../../../components/InlineFieldError';
import { useToast } from '../../../../components/Toast';
import { useAuth } from '../../../../context/AuthContext';
import { MESSAGES } from '../../../../constants/messages';
import { approvalErrorView } from '../../../../lib/approvalText';
import { ChannelToggle } from '../../channels/ChannelToggle';
import { ApprovalRecentTable } from './ApprovalRecentTable';

export interface ApprovalPolicyPanelProps {
  chatbotId: string;
  status: ApprovalPolicyStatus;
  /** 보관된 챗봇이면 스위치를 잠근다("보관된 챗봇은 바꿀 수 없습니다"). */
  archived: boolean;
  /** 정책 변경 뒤 환경 탭이 정책·상태를 다시 조회한다. */
  onChanged: () => void;
}

function parseTtl(raw: string): number | null {
  const n = Number(raw);
  if (!raw.trim() || !Number.isInteger(n) || n < APPROVAL_TTL_HOURS.min || n > APPROVAL_TTL_HOURS.max) return null;
  return n;
}

/**
 * 환경 탭 "운영 전환 2인 승인" 절(`ai-guardrails-ui-spec.md` §9.3). 스위치는 곧바로 바꾸지 않고 대화상자를 연다.
 * 배포 권한이 없으면(EDITOR·VIEWER) 상태·승인 가능자·최근 요청만 글자로 보이고 컨트롤은 렌더하지 않는다.
 */
export function ApprovalPolicyPanel({ chatbotId, status, archived, onChanged }: ApprovalPolicyPanelProps): JSX.Element {
  const msg = MESSAGES.switchApproval.policy;
  const { can } = useAuth();
  const { showToast } = useToast();
  const canDeploy = can('chatbot:deploy');
  const on = status.policy.required;

  const [enableOpen, setEnableOpen] = useState(false);
  const [disableOpen, setDisableOpen] = useState(false);
  const [ttlOpen, setTtlOpen] = useState(false);

  // 켜기 대화상자
  const [enableTtl, setEnableTtl] = useState(String(status.policy.ttlHours));
  const [enableTtlError, setEnableTtlError] = useState<string | undefined>(undefined);
  const [enableBanner, setEnableBanner] = useState<string | null>(null);
  const [enabling, setEnabling] = useState(false);
  // 끄기 확인
  const [disabling, setDisabling] = useState(false);
  const [disableBanner, setDisableBanner] = useState<string | null>(null);
  // TTL 변경
  const [ttlValue, setTtlValue] = useState(String(status.policy.ttlHours));
  const [ttlError, setTtlError] = useState<string | undefined>(undefined);
  const [ttlSaving, setTtlSaving] = useState(false);
  const ttlInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTtlValue(String(status.policy.ttlHours));
  }, [status.policy.ttlHours]);

  // 스위치 잠금 사유(글자) — `aria-disabled` + `aria-describedby`로 연결된다(ChannelToggle).
  let lockReason: string | undefined;
  if (archived) lockReason = msg.cannotChangeArchived;
  else if (on && status.offLocked) lockReason = status.offLockedBy === 'GOVERNANCE_MODE' ? msg.offLockedGovernance : msg.offLocked;
  else if (!on && status.eligibleApproverCount < 2) lockReason = msg.cannotEnableNotEnough(status.eligibleApproverCount);
  const locked = Boolean(lockReason);

  function handleToggle(): void {
    if (on) {
      setDisableBanner(null);
      setDisableOpen(true);
    } else {
      openEnable();
    }
  }

  function openEnable(): void {
    setEnableTtl(String(status.policy.ttlHours));
    setEnableTtlError(undefined);
    setEnableBanner(null);
    setEnableOpen(true);
  }

  async function handleEnable(): Promise<void> {
    const ttl = parseTtl(enableTtl);
    if (ttl === null) {
      setEnableTtlError(MESSAGES.switchApproval.policy.ttlError);
      return;
    }
    setEnabling(true);
    setEnableBanner(null);
    try {
      await switchApprovalsApi.updatePolicy(chatbotId, { required: true, ttlHours: ttl });
      setEnableOpen(false);
      showToast(msg.enableDialog.success);
      onChanged();
    } catch (e) {
      const view = approvalErrorView(e, 'POLICY');
      setEnableBanner(view.text);
      if (view.kind === 'POLICY_UNAVAILABLE') onChanged();
    } finally {
      setEnabling(false);
    }
  }

  async function handleDisable(): Promise<void> {
    setDisabling(true);
    setDisableBanner(null);
    try {
      await switchApprovalsApi.updatePolicy(chatbotId, { required: false, ttlHours: status.policy.ttlHours });
      setDisableOpen(false);
      const text = status.pending ? msg.disableDialog.successWithPending : msg.disableDialog.success;
      showToast(text);
      onChanged();
    } catch (e) {
      const view = approvalErrorView(e, 'POLICY');
      setDisableBanner(view.text);
      if (view.kind === 'POLICY_UNAVAILABLE') onChanged();
    } finally {
      setDisabling(false);
    }
  }

  async function handleTtlSave(): Promise<void> {
    const ttl = parseTtl(ttlValue);
    if (ttl === null) {
      setTtlError(msg.ttlError);
      ttlInputRef.current?.focus();
      return;
    }
    setTtlSaving(true);
    setTtlError(undefined);
    try {
      await switchApprovalsApi.updatePolicy(chatbotId, { required: true, ttlHours: ttl });
      setTtlOpen(false);
      showToast(msg.ttlSaved);
      onChanged();
    } catch (e) {
      setTtlError(approvalErrorView(e, 'POLICY').text);
    } finally {
      setTtlSaving(false);
    }
  }

  const noApprover = on && status.otherApproverCount === 0;

  return (
    <section id="approval-policy" className="approval-policy-panel" aria-labelledby="approval-policy-title">
      <h2 id="approval-policy-title" tabIndex={-1}>
        {msg.title}
      </h2>
      <p className="approval-policy-status">
        <span aria-hidden="true">{on ? '●' : '○'}</span> {on ? msg.statusOn(status.policy.ttlHours) : msg.statusOff}
      </p>
      <p className="field-hint">
        <span aria-hidden="true">ⓘ</span> {msg.intro}
      </p>
      <p>{msg.otherApprovers(status.otherApproverCount)}</p>

      {canDeploy ? (
        <div className="approval-policy-controls">
          <ChannelToggle
            id="approval-policy-toggle"
            enabled={on}
            locked={locked}
            reason={lockReason}
            onLabel={msg.switchOn}
            offLabel={msg.switchOff}
            onToggle={handleToggle}
          />
          {on && !archived && (
            <button type="button" className="btn btn-secondary" aria-expanded={ttlOpen} aria-controls="approval-ttl-form" onClick={() => setTtlOpen((v) => !v)}>
              {msg.ttlChangeButton}
            </button>
          )}
        </div>
      ) : (
        <p className="field-hint">{msg.readOnlyNote}</p>
      )}

      {canDeploy && on && ttlOpen && (
        <div id="approval-ttl-form" className="approval-ttl-form">
          <div className="form-field">
            <label htmlFor="approval-ttl-input">{msg.ttlLabel}</label>
            <input
              id="approval-ttl-input"
              ref={ttlInputRef}
              type="number"
              inputMode="numeric"
              min={APPROVAL_TTL_HOURS.min}
              max={APPROVAL_TTL_HOURS.max}
              value={ttlValue}
              aria-invalid={ttlError ? true : undefined}
              aria-describedby={ttlError ? 'approval-ttl-hint approval-ttl-error' : 'approval-ttl-hint'}
              onChange={(e) => {
                setTtlValue(e.target.value);
                setTtlError(undefined);
              }}
            />
            <p id="approval-ttl-hint" className="field-hint">
              {msg.ttlHint} · {msg.ttlNote}
            </p>
            <InlineFieldError id="approval-ttl-error" message={ttlError} />
          </div>
          <div className="form-actions">
            <button type="button" className="btn btn-secondary" onClick={() => setTtlOpen(false)} disabled={ttlSaving}>
              {msg.ttlCancel}
            </button>
            <button type="button" className="btn btn-primary" onClick={() => void handleTtlSave()} disabled={ttlSaving}>
              {ttlSaving ? msg.ttlSaving : msg.ttlSave}
            </button>
          </div>
        </div>
      )}

      {noApprover && (
        <p className="form-banner form-banner--warning">
          <span aria-hidden="true">⚠</span> {msg.noApproverWarning}{' '}
          {can('user:read') && <Link to="/settings/users">{msg.usersLink}</Link>}
        </p>
      )}

      <h3>{msg.recentTitle}</h3>
      <ApprovalRecentTable items={status.recent} />

      <Modal isOpen={enableOpen} title={msg.enableDialog.title} onClose={() => !enabling && setEnableOpen(false)} closeOnEsc={!enabling} initialFocusSelector='[data-autofocus="cancel"]'>
        {enableBanner && (
          <p className="modal-banner modal-banner--error" role="alert">
            {enableBanner}
          </p>
        )}
        <p>{msg.enableDialog.body1}</p>
        <p>{msg.enableDialog.body2}</p>
        <p>{msg.enableDialog.body3}</p>
        <p>{msg.enableDialog.body4}</p>
        <div className="form-field">
          <label htmlFor="approval-enable-ttl">{msg.enableDialog.ttlLabel}</label>
          <input
            id="approval-enable-ttl"
            type="number"
            inputMode="numeric"
            min={APPROVAL_TTL_HOURS.min}
            max={APPROVAL_TTL_HOURS.max}
            value={enableTtl}
            aria-invalid={enableTtlError ? true : undefined}
            aria-describedby={enableTtlError ? 'approval-enable-ttl-hint approval-enable-ttl-error' : 'approval-enable-ttl-hint'}
            onChange={(e) => {
              setEnableTtl(e.target.value);
              setEnableTtlError(undefined);
            }}
          />
          <p id="approval-enable-ttl-hint" className="field-hint">
            {msg.enableDialog.ttlHint}
          </p>
          <InlineFieldError id="approval-enable-ttl-error" message={enableTtlError} />
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={() => setEnableOpen(false)} disabled={enabling} data-autofocus="cancel">
            {msg.enableDialog.cancel}
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void handleEnable()} disabled={enabling}>
            {enabling ? msg.enableDialog.confirming : msg.enableDialog.confirm}
          </button>
        </div>
      </Modal>

      <ConfirmDialog
        isOpen={disableOpen}
        title={msg.disableDialog.title}
        description={msg.disableDialog.body}
        confirmLabel={disabling ? msg.disableDialog.confirming : msg.disableDialog.confirm}
        cancelLabel={msg.disableDialog.cancel}
        danger
        confirmDisabled={disabling}
        onConfirm={() => void handleDisable()}
        onCancel={() => !disabling && setDisableOpen(false)}
      >
        {status.pending && <p>{msg.disableDialog.pendingLine}</p>}
        {disableBanner && (
          <p className="modal-banner modal-banner--error" role="alert">
            {disableBanner}
          </p>
        )}
      </ConfirmDialog>
    </section>
  );
}
