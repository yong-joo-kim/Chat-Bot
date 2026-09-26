import { useState, type FormEvent } from 'react';
import type { ApiConnectionAuthType, CreateWorkflowTargetDto, WorkflowTarget } from '@chat-bot/shared-types';
import { Modal, ConfirmDialog } from '../../../components/Modal';
import { InlineFieldError } from '../../../components/InlineFieldError';
import { workflowTargetsApi } from '../../../api/workflowTargets';
import { ApiError } from '../../../api/client';
import { MESSAGES } from '../../../constants/messages';
import { SecretStatusBadge } from '../api-connections/badges';
import { SigningWeakBadge } from './badges';
import { RawPersonalDataConfirmField } from '../api-connections/RawPersonalDataConfirmField';
import { WorkflowTargetTestPanel } from './WorkflowTargetTestPanel';

export interface WorkflowTargetEditModalProps {
  isOpen: boolean;
  target: WorkflowTarget | null;
  onClose: () => void;
  onSaved: () => void;
}

/** WF1 — 발송 대상 생성/수정 모달(`WorkflowTargetEditModal`, ui-spec §3.1.1). */
export function WorkflowTargetEditModal({ isOpen, target, onClose, onSaved }: WorkflowTargetEditModalProps): JSX.Element {
  const msg = MESSAGES.workflowTargets;
  const editing = target;

  const [name, setName] = useState(editing?.name ?? '');
  const [description, setDescription] = useState(editing?.description ?? '');
  const [baseUrl, setBaseUrl] = useState(editing?.baseUrl ?? '');
  const [useSecretUrl, setUseSecretUrl] = useState(Boolean(editing?.urlSecretRef));
  const [urlSecretRef, setUrlSecretRef] = useState(editing?.urlSecretRef ?? '');
  const [authType, setAuthType] = useState<ApiConnectionAuthType>(editing?.authType ?? 'NONE');
  const [authHeaderName, setAuthHeaderName] = useState(editing?.authHeaderName ?? '');
  const [secretRef, setSecretRef] = useState(editing?.secretRef ?? '');
  const [signingEnabled, setSigningEnabled] = useState(editing?.signingEnabled ?? true);
  const [signingSecretRef, setSigningSecretRef] = useState(editing?.signingSecretRef ?? '');
  const [timeoutSec, setTimeoutSec] = useState(Math.round((editing?.timeoutMs ?? 5000) / 1000));
  const [maxAttempts, setMaxAttempts] = useState(editing?.maxAttempts ?? 5);
  const [allowRawPersonalData, setAllowRawPersonalData] = useState(editing?.allowRawPersonalData ?? false);
  const [confirmRawPersonalData, setConfirmRawPersonalData] = useState('');
  const [enabled, setEnabled] = useState(editing?.enabled ?? true);

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<string | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);
  const [pendingDisableConfirm, setPendingDisableConfirm] = useState(false);

  function buildDto(): CreateWorkflowTargetDto {
    return {
      name: name.trim(),
      description: description.trim() || undefined,
      baseUrl: baseUrl.trim(),
      authType,
      authHeaderName: authType === 'API_KEY_HEADER' ? authHeaderName.trim() || undefined : undefined,
      secretRef: authType !== 'NONE' ? secretRef.trim() || undefined : undefined,
      signingEnabled,
      signingSecretRef: signingEnabled ? signingSecretRef.trim() || undefined : undefined,
      urlSecretRef: useSecretUrl ? urlSecretRef.trim() || undefined : undefined,
      timeoutMs: timeoutSec * 1000,
      maxAttempts,
      allowRawPersonalData,
      enabled,
      confirmRawPersonalData: allowRawPersonalData ? confirmRawPersonalData : undefined,
    };
  }

  async function doSubmit(): Promise<void> {
    setSubmitting(true);
    setFieldErrors({});
    setBanner(undefined);
    try {
      const dto = buildDto();
      if (editing) {
        await workflowTargetsApi.update(editing.id, dto);
      } else {
        await workflowTargetsApi.create(dto);
      }
      onSaved();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'DUPLICATE_NAME') {
        setFieldErrors({ name: msg.duplicateName });
      } else if (err instanceof ApiError && err.code === 'CONFIRM_NAME_MISMATCH') {
        setFieldErrors({ confirmRawPersonalData: msg.confirmRawPersonalDataMismatch });
      } else if (err instanceof ApiError && err.code === 'EGRESS_HOST_NOT_ALLOWED') {
        setFieldErrors({ baseUrl: msg.egressHostNotAllowed });
      } else if (err instanceof ApiError && err.details && err.details.length > 0) {
        const next: Record<string, string> = {};
        err.details.forEach((d) => {
          next[d.field] = d.message;
        });
        setFieldErrors(next);
      } else {
        setBanner(err instanceof ApiError ? err.message : MESSAGES.errors.generic);
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    const hadPending = (editing?.pendingCount ?? 0) + (editing?.heldCount ?? 0) > 0;
    if (editing && editing.enabled && !enabled && hadPending) {
      setPendingDisableConfirm(true);
      return;
    }
    await doSubmit();
  }

  const saveDisabled = submitting || (allowRawPersonalData && confirmRawPersonalData !== name.trim());

  return (
    <>
    {/* 두 모달이 동시에 포커스 트랩을 갖지 않도록, 확인 모달이 뜬 동안은 편집 모달을 잠시 닫아 둔다
        (`isOpen`만 내리고 폼 상태는 그대로 유지 — 취소하면 그대로 돌아온다). */}
    <Modal isOpen={isOpen && !pendingDisableConfirm} title={editing ? msg.modalEditTitle(editing.name) : msg.modalCreateTitle} onClose={onClose}>
      <form onSubmit={handleSubmit} noValidate>
        {banner && (
          <p className="form-banner form-banner--error" role="alert">
            {banner}
          </p>
        )}
        <div className="form-field">
          <label htmlFor="workflow-target-name">
            {msg.fieldName} <span className="required-mark" aria-hidden="true">*</span>
          </label>
          <input id="workflow-target-name" type="text" required maxLength={100} autoFocus value={name} onChange={(e) => setName(e.target.value)} />
          <InlineFieldError id="workflow-target-name-error" message={fieldErrors.name} />
        </div>
        <div className="form-field">
          <label htmlFor="workflow-target-description">{msg.fieldDescription}</label>
          <textarea id="workflow-target-description" maxLength={300} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="form-field">
          <label htmlFor="workflow-target-base-url">
            {msg.fieldBaseUrl} <span className="required-mark" aria-hidden="true">*</span>
          </label>
          <input
            id="workflow-target-base-url"
            type="text"
            required
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            aria-invalid={Boolean(fieldErrors.baseUrl)}
          />
          {baseUrl.trim().toLowerCase().startsWith('http://') && <p className="field-hint field-hint--warning">{msg.fieldBaseUrlInsecureHint}</p>}
          <p className="field-hint">{msg.fieldBaseUrlPrivateHint}</p>
          <InlineFieldError id="workflow-target-base-url-error" message={fieldErrors.baseUrl} />
        </div>

        <div className="form-field form-field--inline">
          <input id="workflow-target-use-secret-url" type="checkbox" checked={useSecretUrl} onChange={(e) => setUseSecretUrl(e.target.checked)} />
          <label htmlFor="workflow-target-use-secret-url">{msg.fieldUseSecretUrl}</label>
        </div>
        {useSecretUrl && (
          <div className="form-field">
            <label htmlFor="workflow-target-url-secret-ref">
              {msg.fieldUrlSecretRef} <span className="required-mark" aria-hidden="true">*</span>
            </label>
            <div className="form-field--inline">
              <input
                id="workflow-target-url-secret-ref"
                type="text"
                required
                maxLength={40}
                value={urlSecretRef}
                onChange={(e) => setUrlSecretRef(e.target.value.toUpperCase())}
              />
              {editing && <SecretStatusBadge status={editing.secretStates.url} />}
            </div>
            {editing && editing.secretStates.url === 'MISSING' && urlSecretRef === editing.urlSecretRef && (
              <p className="field-hint field-hint--warning">{msg.secretRefMissingHint(urlSecretRef)}</p>
            )}
            <InlineFieldError id="workflow-target-url-secret-ref-error" message={fieldErrors.urlSecretRef} />
          </div>
        )}

        <fieldset className="form-field">
          <legend>{msg.fieldAuthType}</legend>
          {([
            ['NONE', msg.authTypeNone],
            ['API_KEY_HEADER', msg.authTypeApiKey],
            ['BEARER', msg.authTypeBearer],
            ['BASIC', msg.authTypeBasic],
          ] as [ApiConnectionAuthType, string][]).map(([value, label]) => (
            <label key={value} className="form-field--inline">
              <input type="radio" name="workflow-target-auth-type" checked={authType === value} onChange={() => setAuthType(value)} />
              {label}
            </label>
          ))}
        </fieldset>

        {authType === 'API_KEY_HEADER' && (
          <div className="form-field">
            <label htmlFor="workflow-target-auth-header">
              {msg.fieldAuthHeaderName} <span className="required-mark" aria-hidden="true">*</span>
            </label>
            <input
              id="workflow-target-auth-header"
              type="text"
              required
              maxLength={64}
              value={authHeaderName}
              onChange={(e) => setAuthHeaderName(e.target.value)}
            />
            <InlineFieldError id="workflow-target-auth-header-error" message={fieldErrors.authHeaderName} />
          </div>
        )}

        {authType !== 'NONE' && (
          <div className="form-field">
            <label htmlFor="workflow-target-secret-ref">
              {msg.fieldSecretRef} <span className="required-mark" aria-hidden="true">*</span>
            </label>
            <div className="form-field--inline">
              <input id="workflow-target-secret-ref" type="text" required maxLength={40} value={secretRef} onChange={(e) => setSecretRef(e.target.value.toUpperCase())} />
              {editing && <SecretStatusBadge status={editing.secretStates.auth} />}
            </div>
            {editing && editing.secretStates.auth === 'MISSING' && secretRef === editing.secretRef && (
              <p className="field-hint field-hint--warning">{msg.secretRefMissingHint(secretRef)}</p>
            )}
            <InlineFieldError id="workflow-target-secret-ref-error" message={fieldErrors.secretRef} />
          </div>
        )}

        <div className="form-field form-field--inline">
          <input id="workflow-target-signing-enabled" type="checkbox" checked={signingEnabled} onChange={(e) => setSigningEnabled(e.target.checked)} />
          <label htmlFor="workflow-target-signing-enabled">{msg.fieldSigningEnabled}</label>
        </div>
        {signingEnabled && (
          <div className="form-field">
            <label htmlFor="workflow-target-signing-secret-ref">
              {msg.fieldSigningSecretRef} <span className="required-mark" aria-hidden="true">*</span>
            </label>
            <div className="form-field--inline">
              <input
                id="workflow-target-signing-secret-ref"
                type="text"
                required
                maxLength={40}
                value={signingSecretRef}
                onChange={(e) => setSigningSecretRef(e.target.value.toUpperCase())}
              />
              {editing && (
                <>
                  <SecretStatusBadge status={editing.secretStates.signing} />
                  {editing.secretStates.signingWeak && <SigningWeakBadge />}
                </>
              )}
            </div>
            {editing && editing.secretStates.signing === 'MISSING' && signingSecretRef === editing.signingSecretRef && (
              <p className="field-hint field-hint--warning">{msg.secretRefMissingHint(signingSecretRef)}</p>
            )}
            <InlineFieldError id="workflow-target-signing-secret-ref-error" message={fieldErrors.signingSecretRef} />
          </div>
        )}

        <div className="key-value-row">
          <div className="form-field">
            <label htmlFor="workflow-target-timeout">{msg.fieldTimeoutSec}</label>
            <input
              id="workflow-target-timeout"
              type="number"
              min={1}
              max={15}
              value={timeoutSec}
              onChange={(e) => setTimeoutSec(Number(e.target.value))}
            />
          </div>
          <div className="form-field">
            <label htmlFor="workflow-target-max-attempts">{msg.fieldMaxAttempts}</label>
            <input
              id="workflow-target-max-attempts"
              type="number"
              min={1}
              max={10}
              value={maxAttempts}
              onChange={(e) => setMaxAttempts(Number(e.target.value))}
            />
          </div>
        </div>

        <div className="form-field form-field--inline">
          <input
            id="workflow-target-allow-raw"
            type="checkbox"
            checked={allowRawPersonalData}
            onChange={(e) => setAllowRawPersonalData(e.target.checked)}
          />
          <label htmlFor="workflow-target-allow-raw">{msg.fieldAllowRawPersonalData}</label>
        </div>
        {allowRawPersonalData && (
          <RawPersonalDataConfirmField
            idPrefix="workflow-target"
            entityName={name.trim()}
            value={confirmRawPersonalData}
            onChange={setConfirmRawPersonalData}
            label={msg.confirmRawPersonalDataLabel}
            mismatchMessage={msg.confirmRawPersonalDataMismatch}
          />
        )}
        {/* 로컬 불일치는 위 `RawPersonalDataConfirmField`(No.26 공용 컴포넌트)가 이미 보여준다 — 여기서는
            서버가 내려준 `CONFIRM_NAME_MISMATCH`(제출 시점 재검증)만 추가로 보여준다(중복 렌더 방지). */}
        <InlineFieldError id="workflow-target-confirm-raw-server-error" message={fieldErrors.confirmRawPersonalData} />

        <div className="form-field form-field--inline">
          <input id="workflow-target-enabled" type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          <label htmlFor="workflow-target-enabled">{msg.fieldEnabled}</label>
        </div>

        {editing && <WorkflowTargetTestPanel targetId={editing.id} />}

        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {MESSAGES.common.cancel}
          </button>
          <button type="submit" className="btn btn-primary" disabled={saveDisabled} aria-disabled={saveDisabled}>
            {submitting ? MESSAGES.common.saving : MESSAGES.common.save}
          </button>
        </div>
      </form>
    </Modal>

      <ConfirmDialog
        isOpen={pendingDisableConfirm}
        title={msg.disableWithPendingConfirmTitle}
        description={msg.disableWithPendingConfirm((editing?.pendingCount ?? 0) + (editing?.heldCount ?? 0))}
        confirmLabel={MESSAGES.common.save}
        onConfirm={() => {
          setPendingDisableConfirm(false);
          void doSubmit();
        }}
        onCancel={() => setPendingDisableConfirm(false)}
      />
    </>
  );
}
