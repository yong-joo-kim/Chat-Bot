import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type {
  ChatbotAnswerSetting,
  EmbeddingIndexStatus,
  FallbackPolicy,
  RagConnectionCheckResult,
  UpdateAnswerSettingDto,
} from '@chat-bot/shared-types';
import { answerSettingsApi } from '../../../api/answerSettings';
import { embeddingApi } from '../../../api/embedding';
import { ApiError } from '../../../api/client';
import { useAuth } from '../../../context/AuthContext';
import { useToast } from '../../../components/Toast';
import { SeverityBadge } from '../../../components/SeverityBadge';
import { SkeletonCard } from '../../../components/Skeleton';
import { EmptyState } from '../../../components/EmptyState';
import { ThresholdSliderField } from '../../../components/ThresholdSliderField';
import { MESSAGES } from '../../../constants/messages';
import { formatDateTime } from '../../../lib/date';
import { FormActions } from '../FormActions';
import { ThresholdBandVisualizer } from './ThresholdBandVisualizer';
import { IndexStatusBadge } from './IndexStatusBadge';
import { ReindexButton } from './ReindexButton';
import { RagScopeFields } from './RagScopeFields';
import { ProviderLockedField } from './ProviderLockedField';
import { FallbackPolicyRadioGroup } from './FallbackPolicyRadioGroup';
import { SimilarityThresholdField } from './SimilarityThresholdField';
import { RagTimeoutField } from './RagTimeoutField';
import { ConnectionStatusBadge } from './ConnectionStatusBadge';
import { ConnectionCheckButton } from './ConnectionCheckButton';
import { NoDestructiveActionsNotice } from './NoDestructiveActionsNotice';
import { AnswerSettingsPreviewPanel } from './AnswerSettingsPreviewPanel';
import { HandoffSettingsSection } from './HandoffSettingsSection';

interface FormState {
  semanticEnabled: boolean;
  acceptThreshold: number;
  lowThreshold: number;
  marginThreshold: number;
  ragEnabled: boolean;
  ragCompany: string;
  ragCategory: string;
  ragSubcategory: string;
  ragSimilarityThreshold: number | null;
  fallbackPolicy: FallbackPolicy;
  showSources: boolean;
  ragTimeoutSeconds: number;
}

function toFormState(setting: ChatbotAnswerSetting): FormState {
  return {
    semanticEnabled: setting.semanticEnabled,
    acceptThreshold: setting.acceptThreshold,
    lowThreshold: setting.lowThreshold,
    marginThreshold: setting.marginThreshold,
    ragEnabled: setting.ragEnabled,
    ragCompany: setting.ragCompany ?? '',
    ragCategory: setting.ragCategory ?? '',
    ragSubcategory: setting.ragSubcategory ?? '',
    ragSimilarityThreshold: setting.ragSimilarityThreshold,
    fallbackPolicy: setting.fallbackPolicy,
    showSources: setting.showSources,
    ragTimeoutSeconds: Math.round(setting.ragTimeoutMs / 1000),
  };
}

function toDto(form: FormState): UpdateAnswerSettingDto {
  return {
    semanticEnabled: form.semanticEnabled,
    acceptThreshold: form.acceptThreshold,
    lowThreshold: form.lowThreshold,
    marginThreshold: form.marginThreshold,
    ragEnabled: form.ragEnabled,
    ragCompany: form.ragCompany.trim() === '' ? null : form.ragCompany.trim(),
    ragCategory: form.ragCategory.trim() === '' ? null : form.ragCategory.trim(),
    ragSubcategory: form.ragSubcategory.trim() === '' ? null : form.ragSubcategory.trim(),
    ragSimilarityThreshold: form.ragSimilarityThreshold,
    fallbackPolicy: form.fallbackPolicy,
    showSources: form.showSources,
    ragTimeoutMs: Math.round(form.ragTimeoutSeconds * 1000),
  };
}

/** 클라이언트 사전검증(제출 전 — UIUX §7). 서버가 최종 검증하며 이 함수는 UX 보조일 뿐이다. */
function validate(form: FormState): Record<string, string> {
  const msg = MESSAGES.answerSettings;
  const errors: Record<string, string> = {};
  if (!(form.lowThreshold < form.acceptThreshold)) {
    errors.lowThreshold = msg.semantic.lowGteAcceptError;
  }
  if (form.marginThreshold < 0 || form.marginThreshold > 0.5) {
    errors.marginThreshold = msg.semantic.marginRangeError;
  }
  if (form.ragEnabled && form.ragCompany.trim() === '') {
    errors.ragCompany = msg.rag.companyRequiredError;
  }
  if (form.ragSubcategory.trim() !== '' && form.ragCategory.trim() === '') {
    errors.ragSubcategory = msg.rag.subcategoryRequiresCategoryError;
  }
  if (form.ragSimilarityThreshold !== null && !(form.ragSimilarityThreshold > 0 && form.ragSimilarityThreshold < 1)) {
    errors.ragSimilarityThreshold = msg.rag.similarityThresholdRangeError;
  }
  if (form.ragTimeoutSeconds < 120) {
    errors.ragTimeoutSeconds = msg.rag.timeoutMinError;
  }
  return errors;
}

/**
 * AS1 — AI 답변 설정(`/chatbots/:chatbotId/answer-settings`, `nlu-rag-answering-ui-spec.md` §4.1).
 * 1단계(의미 유사도) 임계값 + 2단계(RAG) 연동을 설정·점검하고 저장 전 미리보기로 효과를 확인한다.
 */
export function AnswerSettingsPage({
  chatbotId,
  isArchived,
  setUnsavedGuard,
  environmentEnabled = false,
}: {
  chatbotId: string;
  isArchived: boolean;
  setUnsavedGuard: (guard: (() => boolean) | null) => void;
  /** [신규 No.40] 상담 연계 섹션의 환경 밖 자산 배너용(§4.15) — 기본값 false(호출부가 안 넘기는 시험은 영향 없음). */
  environmentEnabled?: boolean;
}): JSX.Element {
  const { can } = useAuth();
  const { showToast } = useToast();
  const canWrite = can('chatbot:write') && !isArchived;

  const [setting, setSetting] = useState<ChatbotAnswerSetting | null>(null);
  const [settingIsDefault, setSettingIsDefault] = useState(false);
  const [indexStatus, setIndexStatus] = useState<EmbeddingIndexStatus | null>(null);
  const [initial, setInitial] = useState<FormState | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reindexing, setReindexing] = useState(false);
  const [checkingConnection, setCheckingConnection] = useState(false);
  const [connection, setConnection] = useState<RagConnectionCheckResult | null>(null);
  const pollTimerRef = useRef<number | null>(null);

  const msg = MESSAGES.answerSettings;

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current !== null) {
      window.clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const loadStatus = useCallback(async (): Promise<EmbeddingIndexStatus | null> => {
    try {
      const status = await embeddingApi.status(chatbotId);
      setIndexStatus(status);
      return status;
    } catch {
      return null;
    }
  }, [chatbotId]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const [settingRes, statusRes] = await Promise.all([answerSettingsApi.get(chatbotId), embeddingApi.status(chatbotId)]);
      setSetting(settingRes);
      // 행이 없으면 서버가 기본값(전부 비활성)을 반환한다(DD-89) — 저장된 적이 없다는 사실을 배지로 알린다.
      setSettingIsDefault(!settingRes.semanticEnabled && !settingRes.ragEnabled && settingRes.ragCompany === null);
      setIndexStatus(statusRes);
      const fs = toFormState(settingRes);
      setInitial(fs);
      setForm(fs);
      setFieldErrors({});
      setReindexing(statusRes.pending > 0);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [chatbotId]);

  useEffect(() => {
    void load();
    return () => stopPolling();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatbotId]);

  useEffect(() => {
    if (reindexing) {
      pollTimerRef.current = window.setInterval(() => {
        void loadStatus().then((status) => {
          if (status && status.pending === 0 && status.failed === 0) {
            setReindexing(false);
            stopPolling();
          }
        });
      }, 5000);
    }
    return () => stopPolling();
  }, [reindexing, loadStatus, stopPolling]);

  const dirty = Boolean(initial && form && JSON.stringify(initial) !== JSON.stringify(form));

  useEffect(() => {
    setUnsavedGuard(dirty ? () => window.confirm(msg.unsavedChangesConfirm) : null);
    return () => setUnsavedGuard(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty]);

  function updateForm(patch: Partial<FormState>): void {
    setForm((prev) => (prev ? { ...prev, ...patch } : prev));
  }

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!form) return;
    const errors = validate(form);
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});
    setSaving(true);
    try {
      const updated = await answerSettingsApi.update(chatbotId, toDto(form));
      setSetting(updated);
      setSettingIsDefault(false);
      const fs = toFormState(updated);
      setInitial(fs);
      setForm(fs);
      showToast(msg.saveSuccess);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.details && err.details.length > 0) {
          const map: Record<string, string> = {};
          for (const d of err.details) map[d.field] = d.message;
          setFieldErrors(map);
        } else if (err.code === 'CHATBOT_ARCHIVED') {
          showToast(err.message);
          void load();
        } else {
          showToast(err.message || MESSAGES.errors.generic);
        }
      } else {
        showToast(MESSAGES.errors.generic);
      }
    } finally {
      setSaving(false);
    }
  }

  function handleCancel(): void {
    if (initial) setForm(initial);
    setFieldErrors({});
  }

  async function handleReindex(): Promise<void> {
    try {
      await embeddingApi.reindex(chatbotId);
      showToast(msg.semantic.reindexSuccessToast);
      setReindexing(true);
      void loadStatus();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'REINDEX_IN_PROGRESS') {
        showToast(msg.semantic.reindexConflictToast);
      } else if (err instanceof ApiError && err.code === 'EMBEDDING_UNAVAILABLE') {
        showToast(msg.semantic.reindexUnavailableToast);
      } else {
        showToast(err instanceof ApiError ? err.message : MESSAGES.errors.generic);
      }
    }
  }

  async function handleConnectionCheck(): Promise<void> {
    setCheckingConnection(true);
    try {
      const res = await answerSettingsApi.test(chatbotId);
      setConnection(res);
      if (res.upstreamStatus === 'OK' && res.scopeChunkCount === 0) {
        setFieldErrors((prev) => ({ ...prev, ragScopeWarning: msg.rag.scopeZeroWarning }));
      } else {
        setFieldErrors((prev) => {
          const next = { ...prev };
          delete next.ragScopeWarning;
          return next;
        });
      }
    } catch (err) {
      if (err instanceof ApiError && err.code === 'RAG_NOT_CONFIGURED') {
        setFieldErrors((prev) => ({ ...prev, ragCompany: msg.rag.companyRequiredForTestError }));
      } else if (err instanceof ApiError && err.code === 'RAG_UPSTREAM_UNAVAILABLE') {
        setConnection({ upstreamStatus: 'UNAVAILABLE', vllmReady: null, neo4jReady: null, scopeChunkCount: null, checkedAt: new Date() });
        showToast(msg.rag.upstreamUnavailableToast);
      } else {
        showToast(err instanceof ApiError ? err.message : MESSAGES.errors.generic);
      }
    } finally {
      setCheckingConnection(false);
    }
  }

  if (loading) {
    return (
      <div className="answer-settings-page">
        <h2>{msg.title}</h2>
        <SkeletonCard />
        <SkeletonCard />
      </div>
    );
  }

  if (loadError || !form || !setting) {
    return (
      <div className="answer-settings-page">
        <h2>{msg.title}</h2>
        <SeverityBadge severity="ERROR" label={MESSAGES.errors.generic} />
        <button type="button" className="btn btn-secondary" onClick={() => void load()}>
          {MESSAGES.common.retry}
        </button>
      </div>
    );
  }

  const emptyIndex = indexStatus !== null && indexStatus.totalTargets === 0;
  // ui-spec §4.1 상태표: "저하 모드 경고 | providerHealthy === false" — semanticEnabled 여부와 무관하다.
  const showDegradedWarning = indexStatus !== null && !indexStatus.providerHealthy;

  return (
    <div className="answer-settings-page">
      <h2>{msg.title}</h2>
      {isArchived && (
        <div className="archived-banner" role="status">
          <span aria-hidden="true">⚠</span> {msg.archivedBanner}
        </div>
      )}
      {!isArchived && !can('chatbot:write') && <SeverityBadge severity="INFO" label={msg.viewerNotice} />}
      {settingIsDefault && <SeverityBadge severity="INFO" label={msg.emptySettingsNotice} />}
      {showDegradedWarning && <SeverityBadge severity="WARNING" label={msg.degradedModeWarning} />}

      <form onSubmit={(e) => void handleSubmit(e)} noValidate>
        <fieldset disabled={!canWrite} className="answer-settings-fieldset">
          <legend className="sr-only">{msg.title}</legend>

          <section className="answer-settings-section">
            <div className="answer-settings-section-header">
              <h3>{msg.semantic.sectionTitle}</h3>
              <label className="form-field--inline">
                <input
                  type="checkbox"
                  checked={form.semanticEnabled}
                  onChange={(e) => updateForm({ semanticEnabled: e.target.checked })}
                />
                {msg.semantic.enabledLabel}
              </label>
            </div>

            <p className="field-hint">
              {indexStatus?.modelId
                ? msg.semantic.modelInfo(
                    indexStatus.modelId,
                    indexStatus.dimension ?? 0,
                    indexStatus.lastIndexedAt ? formatDateTime(indexStatus.lastIndexedAt) : '—',
                  )
                : msg.semantic.modelInfoUnset}
            </p>

            <div className="index-status-row">
              {emptyIndex ? (
                <EmptyState
                  title={msg.semantic.emptyIndexTitle}
                  action={<a href={`/chatbots/${chatbotId}/dialogue`}>{msg.semantic.emptyIndexCta}</a>}
                />
              ) : (
                indexStatus && <IndexStatusBadge status={indexStatus} />
              )}
              {can('chatbot:write') && !isArchived && (
                <ReindexButton reindexing={reindexing} onClick={() => void handleReindex()} />
              )}
            </div>

            <ThresholdSliderField
              id="accept-threshold"
              label={msg.semantic.acceptLabel}
              value={form.acceptThreshold}
              min={0}
              max={1}
              step={0.01}
              onChange={(v) => updateForm({ acceptThreshold: v })}
              disabled={!canWrite}
            />
            <ThresholdSliderField
              id="low-threshold"
              label={msg.semantic.lowLabel}
              value={form.lowThreshold}
              min={0}
              max={1}
              step={0.01}
              onChange={(v) => updateForm({ lowThreshold: v })}
              disabled={!canWrite}
              error={fieldErrors.lowThreshold}
            />
            <ThresholdSliderField
              id="margin-threshold"
              label={msg.semantic.marginLabel}
              value={form.marginThreshold}
              min={0}
              max={0.5}
              step={0.01}
              onChange={(v) => updateForm({ marginThreshold: v })}
              disabled={!canWrite}
              error={fieldErrors.marginThreshold}
            />
            <p className="field-hint">{msg.semantic.thresholdHint}</p>

            <ThresholdBandVisualizer accept={form.acceptThreshold} low={form.lowThreshold} margin={form.marginThreshold} />
            {form.acceptThreshold >= 0.95 && <SeverityBadge severity="INFO" label={msg.semantic.narrowBandWarning} />}
          </section>

          <section className="answer-settings-section">
            <div className="answer-settings-section-header">
              <h3>{msg.rag.sectionTitle}</h3>
              <label className="form-field--inline">
                <input type="checkbox" checked={form.ragEnabled} onChange={(e) => updateForm({ ragEnabled: e.target.checked })} />
                {msg.rag.enabledLabel}
              </label>
            </div>

            <RagScopeFields
              ragEnabled={form.ragEnabled}
              company={form.ragCompany}
              category={form.ragCategory}
              subcategory={form.ragSubcategory}
              onChangeCompany={(v) => updateForm({ ragCompany: v })}
              onChangeCategory={(v) => updateForm({ ragCategory: v })}
              onChangeSubcategory={(v) => updateForm({ ragSubcategory: v })}
              disabled={!canWrite}
              companyError={fieldErrors.ragCompany}
              subcategoryError={fieldErrors.ragSubcategory}
              scopeWarning={fieldErrors.ragScopeWarning}
            />

            <ProviderLockedField />

            <FallbackPolicyRadioGroup value={form.fallbackPolicy} onChange={(v) => updateForm({ fallbackPolicy: v })} disabled={!canWrite} />

            <label className="form-field--inline">
              <input type="checkbox" checked={form.showSources} onChange={(e) => updateForm({ showSources: e.target.checked })} disabled={!canWrite} />
              {msg.rag.showSourcesLabel}
            </label>

            <SimilarityThresholdField
              value={form.ragSimilarityThreshold}
              onChange={(v) => updateForm({ ragSimilarityThreshold: v })}
              disabled={!canWrite}
              error={fieldErrors.ragSimilarityThreshold}
            />

            <RagTimeoutField
              valueSeconds={form.ragTimeoutSeconds}
              onChange={(v) => updateForm({ ragTimeoutSeconds: v })}
              disabled={!canWrite}
              error={fieldErrors.ragTimeoutSeconds}
            />

            <div className="connection-check-row">
              <span className="field-label-static">{msg.rag.connectionLabel}</span>
              <ConnectionStatusBadge connection={connection} />
              {can('chatbot:write') && !isArchived && (
                <ConnectionCheckButton checking={checkingConnection} onClick={() => void handleConnectionCheck()} />
              )}
            </div>

            <NoDestructiveActionsNotice />
          </section>
        </fieldset>

        {canWrite && <FormActions dirty={dirty} saving={saving} onCancel={handleCancel} />}
      </form>

      {/*
        [No.24] HS1 — 상담 연계 설정 3번째 섹션. ★ 별도 API(`/handoff-settings`)라 위 `<form>`과
        요청을 합치지 않는다(`ChatbotHandoffSetting`은 버전 스냅샷·복원 대상 밖의 별도 행,
        hybrid-cs-설계.md §26 D-1) — 독립된 `<form>`·저장 버튼을 갖는다.
      */}
      <HandoffSettingsSection chatbotId={chatbotId} isArchived={isArchived} environmentEnabled={environmentEnabled} />

      <AnswerSettingsPreviewPanel
        onPreview={(message) => answerSettingsApi.preview(chatbotId, { message })}
        formDiffersFromSaved={dirty}
      />
    </div>
  );
}
