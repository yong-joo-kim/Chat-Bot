import { useCallback, useEffect, useState } from 'react';
import type { RetentionPolicyResponse, RetentionPreviewResponse, RetentionTargetKind } from '@chat-bot/shared-types';
import { RetentionTargetKind as RetentionTargetKindEnum } from '@chat-bot/shared-types';
import { governanceApi } from '../../../api/governance';
import { ApiError } from '../../../api/client';
import { ErrorState } from '../../../components/ErrorState';
import { SkeletonRow } from '../../../components/Skeleton';
import { useToast } from '../../../components/Toast';
import { DataGovernanceModeBanner } from '../../../components/DataGovernanceModeBanner';
import { RetentionConfirmField } from '../../../components/DataGovernanceBadges';
import { MESSAGES } from '../../../constants/messages';
import { formatDateTime } from '../../../lib/date';
import { useAuth } from '../../../context/AuthContext';
import { RetentionKindEditor } from './RetentionKindEditor';
import { RetentionPreviewTable } from './RetentionPreviewTable';
import { RetentionOverridesTable } from './RetentionOverridesTable';

type FormState = Record<RetentionTargetKind, { value: number; unlimited: boolean }>;

function minDaysFor(kind: RetentionTargetKind, bounds: RetentionPolicyResponse['bounds']): number {
  if (kind === 'AUDIT_LOGS') return bounds.minAuditDays;
  if (kind === 'CALL_LOGS') return 1;
  return bounds.minConversationDays;
}

function toFormState(policy: RetentionPolicyResponse): FormState {
  const state = {} as FormState;
  for (const k of policy.kinds) {
    state[k.kind] = { value: k.days ?? minDaysFor(k.kind, policy.bounds), unlimited: k.days === null };
  }
  return state;
}

/** G1-b — 보존 정책(전역, `/settings/data-governance/retention`, `data-governance-ui-spec.md` §3.2). */
export function DataGovernanceRetentionPage(): JSX.Element {
  const msg = MESSAGES.dataGovernance.retention;
  const { user } = useAuth();
  const { showToast } = useToast();
  const canWrite = user?.permissions.includes('security:write') ?? false;

  const [policy, setPolicy] = useState<RetentionPolicyResponse | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const [fieldErrors, setFieldErrors] = useState<Partial<Record<RetentionTargetKind, string>>>({});
  const [preview, setPreview] = useState<RetentionPreviewResponse | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [confirmError, setConfirmError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const [cancellingPending, setCancellingPending] = useState(false);
  const [ariaLiveMsg, setAriaLiveMsg] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    setError(false);
    governanceApi.retention
      .get()
      .then((res) => {
        setPolicy(res);
        setForm(toFormState(res));
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function resetForm(): void {
    if (!policy) return;
    setForm(toFormState(policy));
    setFieldErrors({});
    setPreview(null);
    setConfirmText('');
    setConfirmError(undefined);
  }

  async function handlePreview(): Promise<void> {
    if (!form) return;
    setPreviewLoading(true);
    setPreviewError(false);
    setFieldErrors({});
    try {
      const days = Object.fromEntries(
        RetentionTargetKindEnum.options.map((k) => [k, form[k].unlimited ? null : form[k].value]),
      ) as Record<RetentionTargetKind, number | null>;
      const res = await governanceApi.retention.preview({ days });
      setPreview(res);
      setConfirmText('');
      setConfirmError(undefined);
    } catch (e) {
      if (e instanceof ApiError && e.status === 503) {
        setPreviewError(true);
      } else if (e instanceof ApiError && e.details) {
        const errs: Partial<Record<RetentionTargetKind, string>> = {};
        for (const d of e.details) errs[d.field as RetentionTargetKind] = d.message;
        setFieldErrors(errs);
      } else {
        setPreviewError(true);
      }
    } finally {
      setPreviewLoading(false);
    }
  }

  const shorteningItems = preview?.items.filter((i) => i.shortening) ?? [];
  const requiresConfirm = preview?.requiresConfirm ?? false;
  // NFR-DGA2: 단축이 하나라도 있으면 가장 큰 단축 1건(하한 대비 절감 일수가 가장 큰 항목)을 대표로 버튼에 명시한다.
  const representativeItem = shorteningItems.reduce<(typeof shorteningItems)[number] | null>((best, item) => {
    const cut = (item.currentDays ?? Number.POSITIVE_INFINITY) - (item.newDays ?? 0);
    const bestCut = best ? (best.currentDays ?? Number.POSITIVE_INFINITY) - (best.newDays ?? 0) : -1;
    return cut > bestCut ? item : best;
  }, null);
  const saveButtonLabel =
    requiresConfirm && representativeItem ? msg.shortenConfirmButton(representativeItem.newDays ?? 0) : msg.saveButton;
  // [코드 리뷰 R1 L-2] 서버가 `preview.confirmHint`로 기대 문구를 내려주면 그 값을, 없으면 상수 폴백을 쓴다.
  const expectedConfirmText = preview?.confirmHint ?? msg.shortenConfirmPhrase;
  const saveDisabled = saving || !form || (requiresConfirm && confirmText !== expectedConfirmText);

  async function handleSave(): Promise<void> {
    if (!form) return;
    setSaving(true);
    setConfirmError(undefined);
    setFieldErrors({});
    try {
      const days = Object.fromEntries(
        RetentionTargetKindEnum.options.map((k) => [k, form[k].unlimited ? null : form[k].value]),
      ) as Record<RetentionTargetKind, number | null>;
      const res = await governanceApi.retention.update({
        days,
        confirmText: requiresConfirm ? confirmText : undefined,
      });
      setPolicy(res);
      setForm(toFormState(res));
      setPreview(null);
      setConfirmText('');
      const scheduled = res.kinds.find((k) => k.pending);
      if (scheduled?.pending) {
        const text = msg.scheduleSuccess(formatDateTime(scheduled.pending.effectiveAt));
        setAriaLiveMsg(text);
        showToast(text);
      } else {
        setAriaLiveMsg(msg.saveSuccess);
        showToast(msg.saveSuccess);
      }
    } catch (e) {
      if (e instanceof ApiError && e.code === 'CONFIRM_NAME_MISMATCH') {
        setConfirmError(msg.confirmMismatchGlobal);
      } else if (e instanceof ApiError && e.code === 'RETENTION_OUT_OF_RANGE' && e.details) {
        const errs: Partial<Record<RetentionTargetKind, string>> = {};
        for (const d of e.details) errs[d.field as RetentionTargetKind] = d.message;
        setFieldErrors(errs);
      } else {
        showToast(e instanceof ApiError ? e.message : MESSAGES.errors.generic);
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleCancelAllPending(): Promise<void> {
    setCancellingPending(true);
    try {
      const res = await governanceApi.retention.cancelAllPending();
      setPolicy(res);
      setForm(toFormState(res));
      showToast(msg.cancelAllPendingSuccess);
    } catch {
      // 404(대기 항목 없음)는 버튼 자체가 렌더되지 않는 이상 실사용자에게 노출되지 않는다(방어적으로만 처리).
    } finally {
      setCancellingPending(false);
    }
  }

  if (loading || !form) {
    return (
      <>
        <SkeletonRow />
        <SkeletonRow />
        <SkeletonRow />
        <SkeletonRow />
        <SkeletonRow />
        <SkeletonRow />
      </>
    );
  }
  if (error || !policy) return <ErrorState title={msg.loadFailed} onRetry={load} />;

  const pendingKinds = policy.kinds.filter((k) => k.pending);

  return (
    <div className="data-governance-retention-page">
      <DataGovernanceModeBanner visible={!(user?.governanceModeOn ?? false)} />
      <p className="sr-only" role="status" aria-live="polite">
        {ariaLiveMsg}
      </p>

      <fieldset disabled={!canWrite} className="retention-fieldset">
        <legend className="sr-only">{msg.title}</legend>
        {!canWrite && <p className="field-hint">{MESSAGES.dataGovernance.consoleReadOnlyHint}</p>}
        {policy.kinds.map((k) => (
          <RetentionKindEditor
            key={k.kind}
            kind={k.kind}
            currentDays={k.days}
            value={form[k.kind].value}
            unlimited={form[k.kind].unlimited}
            minDays={minDaysFor(k.kind, policy.bounds)}
            maxDays={policy.bounds.maxDays}
            errorMessage={fieldErrors[k.kind]}
            onChange={(value, unlimited) => setForm((prev) => (prev ? { ...prev, [k.kind]: { value, unlimited } } : prev))}
          />
        ))}

        <div className="form-actions">
          <button type="button" className="btn btn-secondary" onClick={() => void handlePreview()} disabled={previewLoading}>
            {msg.previewButton}
          </button>
        </div>

        {previewLoading && <SkeletonRow />}
        {!previewLoading && previewError && <ErrorState title={msg.previewLoadFailed} onRetry={() => void handlePreview()} />}
        {!previewLoading && !previewError && preview && (
          <>
            <RetentionPreviewTable preview={preview} />
            {requiresConfirm && (
              <>
                <p className="field-hint">{msg.confirmRequiredHint}</p>
                <RetentionConfirmField expected={expectedConfirmText} value={confirmText} onChange={setConfirmText} variant="GLOBAL" />
              </>
            )}
            <div className="form-actions">
              <button type="button" className="btn btn-secondary" onClick={resetForm} disabled={saving}>
                {msg.cancelButton}
              </button>
              <button type="button" className="btn btn-primary" onClick={() => void handleSave()} disabled={saveDisabled} aria-disabled={saveDisabled}>
                {saving ? MESSAGES.common.saving : saveButtonLabel}
              </button>
            </div>
            {confirmError && (
              <p className="field-error" role="alert">
                {confirmError}
              </p>
            )}
          </>
        )}
      </fieldset>

      {pendingKinds.length > 0 && (
        <section className="settings-card">
          <h2>{msg.pendingSectionTitle}</h2>
          <ul>
            {pendingKinds.map((k) => (
              <li key={k.kind}>
                {k.pending && msg.pendingItemText(MESSAGES.dataGovernance.retention.kindLabels[k.kind], k.pending.days ?? 0, formatDateTime(k.pending.effectiveAt))}
              </li>
            ))}
          </ul>
          {canWrite && (
            <>
              <button type="button" className="btn btn-secondary" onClick={() => void handleCancelAllPending()} disabled={cancellingPending}>
                {msg.cancelAllPendingButton}
              </button>
              <p className="field-hint">{msg.cancelAllPendingHint}</p>
            </>
          )}
        </section>
      )}

      <RetentionOverridesTable />
    </div>
  );
}
