import { useEffect, useState, type FormEvent } from 'react';
import type {
  ApiConnection,
  ApiConnectionAuthType,
  ApiHttpMethod,
  ApiSampleResponse,
  CreateApiConnectionDto,
} from '@chat-bot/shared-types';
import { Modal } from '../../../components/Modal';
import { InlineFieldError } from '../../../components/InlineFieldError';
import { apiConnectionsApi } from '../../../api/apiConnections';
import { ApiError } from '../../../api/client';
import { MESSAGES } from '../../../constants/messages';
import { SecretStatusBadge } from './badges';
import { SampleResponseListEditor } from './SampleResponseListEditor';
import { RawPersonalDataConfirmField } from './RawPersonalDataConfirmField';
import { ApiConnectionTestPanel } from './ApiConnectionTestPanel';

export interface ApiConnectionEditModalProps {
  isOpen: boolean;
  connection: ApiConnection | null;
  onClose: () => void;
  onSaved: () => void;
}

/** AC1 — 연결 생성/수정 모달(ui-spec §3.1.1). `key={connection?.id ?? 'new'}`로 열 때마다 재마운트해 상태를 초기화한다. */
export function ApiConnectionEditModal({ isOpen, connection, onClose, onSaved }: ApiConnectionEditModalProps): JSX.Element {
  const msg = MESSAGES.apiConnections;
  const editing = connection;

  const [name, setName] = useState(editing?.name ?? '');
  const [description, setDescription] = useState(editing?.description ?? '');
  const [baseUrl, setBaseUrl] = useState(editing?.baseUrl ?? '');
  const [allowedMethods, setAllowedMethods] = useState<ApiHttpMethod[]>(editing?.allowedMethods ?? ['GET']);
  const [authType, setAuthType] = useState<ApiConnectionAuthType>(editing?.authType ?? 'NONE');
  const [authHeaderName, setAuthHeaderName] = useState(editing?.authHeaderName ?? '');
  const [secretRef, setSecretRef] = useState(editing?.secretRef ?? '');
  const [timeoutMs, setTimeoutMs] = useState(editing?.timeoutMs ?? 3000);
  const [rateLimitPerMin, setRateLimitPerMin] = useState(editing?.rateLimitPerMin ?? 120);
  const [allowRawPersonalData, setAllowRawPersonalData] = useState(editing?.allowRawPersonalData ?? false);
  const [confirmRawPersonalData, setConfirmRawPersonalData] = useState('');
  const [personalDataLookup, setPersonalDataLookup] = useState(editing?.personalDataLookup ?? false);
  const [sampleResponses, setSampleResponses] = useState<ApiSampleResponse[]>(editing?.sampleResponses ?? []);
  const [enabled, setEnabled] = useState(editing?.enabled ?? true);

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<string | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);

  // 개인정보 조회형을 켜면 분당 호출 제한 기본값을 30/120으로 자동 전환(수동 변경 후에는 더 이상 자동 조정하지 않음).
  const [rateLimitTouched, setRateLimitTouched] = useState(false);
  useEffect(() => {
    if (rateLimitTouched) return;
    setRateLimitPerMin(personalDataLookup ? 30 : 120);
  }, [personalDataLookup, rateLimitTouched]);

  function toggleMethod(m: ApiHttpMethod): void {
    setAllowedMethods((prev) => (prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]));
  }

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setSubmitting(true);
    setFieldErrors({});
    setBanner(undefined);
    try {
      const dto: CreateApiConnectionDto = {
        name: name.trim(),
        description: description.trim() || undefined,
        baseUrl: baseUrl.trim(),
        allowedMethods,
        authType,
        authHeaderName: authType === 'API_KEY_HEADER' ? authHeaderName.trim() || undefined : undefined,
        secretRef: authType !== 'NONE' ? secretRef.trim() || undefined : undefined,
        timeoutMs,
        rateLimitPerMin,
        allowRawPersonalData,
        personalDataLookup,
        sampleResponses,
        enabled,
        confirmRawPersonalData: allowRawPersonalData ? confirmRawPersonalData : undefined,
      };
      if (editing) {
        await apiConnectionsApi.update(editing.id, dto);
      } else {
        await apiConnectionsApi.create(dto);
      }
      onSaved();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'DUPLICATE_NAME') {
        setFieldErrors({ name: msg.duplicateName });
      } else if (err instanceof ApiError && err.code === 'CONFIRM_NAME_MISMATCH') {
        setFieldErrors({ confirmRawPersonalData: msg.confirmRawPersonalDataMismatch });
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

  const isInsecure = baseUrl.trim().toLowerCase().startsWith('http://');
  const confirmMismatch = allowRawPersonalData && confirmRawPersonalData.length > 0 && confirmRawPersonalData !== name.trim();
  const saveDisabled = submitting || (allowRawPersonalData && confirmRawPersonalData !== name.trim());

  return (
    <Modal isOpen={isOpen} title={editing ? msg.modalEditTitle(editing.name) : msg.modalCreateTitle} onClose={onClose}>
      <form onSubmit={handleSubmit} noValidate>
        {banner && (
          <p className="form-banner form-banner--error" role="alert">
            {banner}
          </p>
        )}
        <div className="form-field">
          <label htmlFor="api-conn-name">
            {msg.fieldName} <span className="required-mark" aria-hidden="true">*</span>
          </label>
          <input id="api-conn-name" type="text" required maxLength={50} autoFocus value={name} onChange={(e) => setName(e.target.value)} />
          <InlineFieldError id="api-conn-name-error" message={fieldErrors.name} />
        </div>
        <div className="form-field">
          <label htmlFor="api-conn-description">{msg.fieldDescription}</label>
          <textarea id="api-conn-description" maxLength={300} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="form-field">
          <label htmlFor="api-conn-base-url">
            {msg.fieldBaseUrl} <span className="required-mark" aria-hidden="true">*</span>
          </label>
          <input id="api-conn-base-url" type="text" required value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} aria-invalid={Boolean(fieldErrors.baseUrl)} />
          {isInsecure && <p className="field-hint field-hint--warning">{msg.fieldBaseUrlInsecureHint}</p>}
          <p className="field-hint">{msg.fieldBaseUrlPrivateHint}</p>
          <InlineFieldError id="api-conn-base-url-error" message={fieldErrors.baseUrl} />
        </div>

        <fieldset className="form-field">
          <legend>
            {msg.fieldAllowedMethods} <span className="required-mark" aria-hidden="true">*</span>
          </legend>
          {(['GET', 'POST'] as ApiHttpMethod[]).map((m) => (
            <label key={m} className="form-field--inline">
              <input type="checkbox" checked={allowedMethods.includes(m)} onChange={() => toggleMethod(m)} />
              {m}
            </label>
          ))}
          <InlineFieldError id="api-conn-methods-error" message={fieldErrors.allowedMethods} />
        </fieldset>

        <fieldset className="form-field">
          <legend>{msg.fieldAuthType}</legend>
          {([
            ['NONE', msg.authTypeNone],
            ['API_KEY_HEADER', msg.authTypeApiKey],
            ['BEARER', msg.authTypeBearer],
            ['BASIC', msg.authTypeBasic],
          ] as [ApiConnectionAuthType, string][]).map(([value, label]) => (
            <label key={value} className="form-field--inline">
              <input type="radio" name="api-conn-auth-type" checked={authType === value} onChange={() => setAuthType(value)} />
              {label}
            </label>
          ))}
        </fieldset>

        {authType === 'API_KEY_HEADER' && (
          <div className="form-field">
            <label htmlFor="api-conn-auth-header">
              {msg.fieldAuthHeaderName} <span className="required-mark" aria-hidden="true">*</span>
            </label>
            <input
              id="api-conn-auth-header"
              type="text"
              required
              maxLength={64}
              value={authHeaderName}
              onChange={(e) => setAuthHeaderName(e.target.value)}
            />
            <InlineFieldError id="api-conn-auth-header-error" message={fieldErrors.authHeaderName} />
          </div>
        )}

        {authType !== 'NONE' && (
          <div className="form-field">
            <label htmlFor="api-conn-secret-ref">
              {msg.fieldSecretRef} <span className="required-mark" aria-hidden="true">*</span>
            </label>
            <div className="form-field--inline">
              <input id="api-conn-secret-ref" type="text" required maxLength={40} value={secretRef} onChange={(e) => setSecretRef(e.target.value.toUpperCase())} />
              {editing && <SecretStatusBadge status={editing.secretStatus} />}
            </div>
            {editing && editing.secretStatus === 'MISSING' && secretRef === editing.secretRef && (
              <p className="field-hint field-hint--warning">{msg.secretRefMissingHint(secretRef)}</p>
            )}
            <InlineFieldError id="api-conn-secret-ref-error" message={fieldErrors.secretRef} />
          </div>
        )}

        <div className="key-value-row">
          <div className="form-field">
            <label htmlFor="api-conn-timeout">{msg.fieldTimeoutMs}</label>
            <input
              id="api-conn-timeout"
              type="number"
              min={1}
              max={10}
              value={Math.round(timeoutMs / 1000)}
              onChange={(e) => setTimeoutMs(Number(e.target.value) * 1000)}
            />
          </div>
          <div className="form-field">
            <label htmlFor="api-conn-rate-limit">{msg.fieldRateLimitPerMin}</label>
            <input
              id="api-conn-rate-limit"
              type="number"
              min={1}
              max={600}
              value={rateLimitPerMin}
              onChange={(e) => {
                setRateLimitTouched(true);
                setRateLimitPerMin(Number(e.target.value));
              }}
            />
          </div>
        </div>

        <div className="form-field form-field--inline">
          <input
            id="api-conn-allow-raw"
            type="checkbox"
            checked={allowRawPersonalData}
            onChange={(e) => setAllowRawPersonalData(e.target.checked)}
          />
          <label htmlFor="api-conn-allow-raw">{msg.fieldAllowRawPersonalData}</label>
        </div>
        {allowRawPersonalData && (
          <RawPersonalDataConfirmField connectionName={name.trim()} value={confirmRawPersonalData} onChange={setConfirmRawPersonalData} />
        )}
        {confirmMismatch && <InlineFieldError id="api-conn-confirm-raw-mismatch" message={msg.confirmRawPersonalDataMismatch} />}

        <div className="form-field form-field--inline">
          <input
            id="api-conn-personal-lookup"
            type="checkbox"
            checked={personalDataLookup}
            onChange={(e) => setPersonalDataLookup(e.target.checked)}
          />
          <label htmlFor="api-conn-personal-lookup">{msg.fieldPersonalDataLookup}</label>
        </div>
        {personalDataLookup && <p className="field-hint">{msg.personalDataLookupHint}</p>}

        <SampleResponseListEditor items={sampleResponses} onChange={setSampleResponses} maxItems={5} />

        <div className="form-field form-field--inline">
          <input id="api-conn-enabled" type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          <label htmlFor="api-conn-enabled">{msg.fieldEnabled}</label>
        </div>

        {editing && <ApiConnectionTestPanel connectionId={editing.id} />}

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
  );
}
