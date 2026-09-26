import { useCallback, useEffect, useState } from 'react';
import { CONVERSATION_RETENTION_KINDS, type RetentionPolicyResponse, type RetentionPreviewResponse } from '@chat-bot/shared-types';
import { chatbotRetentionApi } from '../../../api/governance';
import { ApiError } from '../../../api/client';
import { ErrorState } from '../../../components/ErrorState';
import { SkeletonRow } from '../../../components/Skeleton';
import { useToast } from '../../../components/Toast';
import { RetentionConfirmField } from '../../../components/DataGovernanceBadges';
import { MESSAGES } from '../../../constants/messages';
import { formatDateTime } from '../../../lib/date';
import { useAuth } from '../../../context/AuthContext';
import { ChatbotRetentionKindEditor, type ChatbotRetentionMode } from './ChatbotRetentionKindEditor';
import { RetentionPreviewTable } from './RetentionPreviewTable';

type ConversationKind = (typeof CONVERSATION_RETENTION_KINDS)[number];
type FormState = Record<ConversationKind, { mode: ChatbotRetentionMode; value: number }>;

function toFormState(policy: RetentionPolicyResponse, minDays: number): FormState {
  const state = {} as FormState;
  for (const kind of CONVERSATION_RETENTION_KINDS) {
    const k = policy.kinds.find((item) => item.kind === kind);
    if (!k || k.source !== 'CHATBOT') {
      state[kind] = { mode: 'GLOBAL', value: minDays };
    } else if (k.days === null) {
      state[kind] = { mode: 'UNLIMITED', value: minDays };
    } else {
      state[kind] = { mode: 'CUSTOM', value: k.days };
    }
  }
  return state;
}

/**
 * G2 — 챗봇 보존기간 재정의(`SettingsTab` "보존기간" 서브탭, `data-governance-ui-spec.md` §3.4).
 * 조회 `chatbot:read`+`security:read` · 저장 `chatbot:read`+`security:write`(부모가 서브탭 노출 자체를
 * `security:read`로 가드한다 — 이 컴포넌트는 저장 가능 여부만 추가로 판정한다).
 */
export function ChatbotRetentionSection({ chatbotId, chatbotName, isArchived }: { chatbotId: string; chatbotName: string; isArchived: boolean }): JSX.Element {
  const msg = MESSAGES.dataGovernance.retention;
  const { user } = useAuth();
  const { showToast } = useToast();
  const canWrite = user?.permissions.includes('security:write') ?? false;

  const [policy, setPolicy] = useState<RetentionPolicyResponse | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const [fieldErrors, setFieldErrors] = useState<Partial<Record<ConversationKind, string>>>({});
  const [preview, setPreview] = useState<RetentionPreviewResponse | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [confirmError, setConfirmError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const [cancellingPending, setCancellingPending] = useState(false);
  const [ariaLiveMsg, setAriaLiveMsg] = useState('');

  const minDays = policy?.bounds.minConversationDays ?? 7;
  const maxDays = policy?.bounds.maxDays ?? 3650;

  const load = useCallback(() => {
    setLoading(true);
    setError(false);
    chatbotRetentionApi
      .get(chatbotId)
      .then((res) => {
        setPolicy(res);
        setForm(toFormState(res, res.bounds.minConversationDays));
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [chatbotId]);

  useEffect(() => {
    load();
  }, [load]);

  function resetForm(): void {
    if (!policy) return;
    setForm(toFormState(policy, policy.bounds.minConversationDays));
    setFieldErrors({});
    setPreview(null);
    setConfirmText('');
    setConfirmError(undefined);
  }

  function buildDays(f: FormState): Record<ConversationKind, number | null | 'GLOBAL'> {
    const days = {} as Record<ConversationKind, number | null | 'GLOBAL'>;
    for (const kind of CONVERSATION_RETENTION_KINDS) {
      const entry = f[kind];
      days[kind] = entry.mode === 'GLOBAL' ? 'GLOBAL' : entry.mode === 'UNLIMITED' ? null : entry.value;
    }
    return days;
  }

  async function handlePreview(): Promise<void> {
    if (!form) return;
    setPreviewLoading(true);
    setPreviewError(false);
    setFieldErrors({});
    try {
      const res = await chatbotRetentionApi.preview(chatbotId, { days: buildDays(form) });
      setPreview(res);
      setConfirmText('');
      setConfirmError(undefined);
    } catch (e) {
      if (e instanceof ApiError && e.status === 503) {
        setPreviewError(true);
      } else if (e instanceof ApiError && e.details) {
        const errs: Partial<Record<ConversationKind, string>> = {};
        for (const d of e.details) errs[d.field as ConversationKind] = d.message;
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
  const representativeItem = shorteningItems.reduce<(typeof shorteningItems)[number] | null>((best, item) => {
    const cut = (item.currentDays ?? Number.POSITIVE_INFINITY) - (item.newDays ?? 0);
    const bestCut = best ? (best.currentDays ?? Number.POSITIVE_INFINITY) - (best.newDays ?? 0) : -1;
    return cut > bestCut ? item : best;
  }, null);
  const saveButtonLabel =
    requiresConfirm && representativeItem ? msg.shortenConfirmButton(representativeItem.newDays ?? 0) : msg.saveButton;
  // [코드 리뷰 R1 L-2] 서버가 `preview.confirmHint`로 기대 문구(보통 챗봇 이름)를 내려주면 그 값을,
  // 없으면 챗봇 이름으로 폴백한다 — G1-b(`DataGovernanceRetentionPage`)와 같은 방식.
  const expectedConfirmText = preview?.confirmHint ?? chatbotName;
  const saveDisabled = saving || !form || (requiresConfirm && confirmText !== expectedConfirmText);

  async function handleSave(): Promise<void> {
    if (!form) return;
    setSaving(true);
    setConfirmError(undefined);
    setFieldErrors({});
    try {
      const res = await chatbotRetentionApi.update(chatbotId, {
        days: buildDays(form),
        confirmText: requiresConfirm ? confirmText : undefined,
      });
      setPolicy(res);
      setForm(toFormState(res, res.bounds.minConversationDays));
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
        setConfirmError(msg.confirmMismatchChatbot(expectedConfirmText));
      } else if (e instanceof ApiError && e.code === 'RETENTION_OUT_OF_RANGE' && e.details) {
        const errs: Partial<Record<ConversationKind, string>> = {};
        for (const d of e.details) errs[d.field as ConversationKind] = d.message;
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
      const res = await chatbotRetentionApi.cancelPending(chatbotId);
      setPolicy(res);
      setForm(toFormState(res, res.bounds.minConversationDays));
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
      </>
    );
  }
  if (error || !policy) return <ErrorState title={msg.loadFailed} onRetry={load} />;

  const pendingKinds = policy.kinds.filter((k) => CONVERSATION_RETENTION_KINDS.includes(k.kind as ConversationKind) && k.pending);

  return (
    <div className="chatbot-retention-section">
      {isArchived && <p className="field-hint">{MESSAGES.dataGovernance.archivedRetentionHint}</p>}
      <h2>{msg.chatbotSectionTitle(chatbotName)}</h2>
      <p className="field-hint">{msg.chatbotSectionDesc}</p>
      <p className="sr-only" role="status" aria-live="polite">
        {ariaLiveMsg}
      </p>

      <fieldset disabled={!canWrite} className="retention-fieldset">
        <legend className="sr-only">{MESSAGES.settings.subTabRetention}</legend>
        {!canWrite && <p className="field-hint">{MESSAGES.dataGovernance.consoleReadOnlyHint}</p>}
        {CONVERSATION_RETENTION_KINDS.map((kind) => {
          const k = policy.kinds.find((item) => item.kind === kind);
          return (
            <ChatbotRetentionKindEditor
              key={kind}
              kind={kind}
              currentGlobalDays={k?.days ?? null}
              mode={form[kind].mode}
              value={form[kind].value}
              minDays={minDays}
              maxDays={maxDays}
              errorMessage={fieldErrors[kind]}
              onChange={(mode, value) => setForm((prev) => (prev ? { ...prev, [kind]: { mode, value } } : prev))}
            />
          );
        })}

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
                <RetentionConfirmField expected={expectedConfirmText} value={confirmText} onChange={setConfirmText} variant="CHATBOT" />
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
          <h3>{msg.pendingSectionTitle}</h3>
          <ul>
            {pendingKinds.map((k) => (
              <li key={k.kind}>
                {k.pending && msg.pendingItemText(msg.kindLabels[k.kind], k.pending.days ?? 0, formatDateTime(k.pending.effectiveAt))}
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
    </div>
  );
}
