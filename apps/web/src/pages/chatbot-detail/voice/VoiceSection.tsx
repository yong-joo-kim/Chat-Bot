import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { VoiceOverviewResponse } from '@chat-bot/shared-types';
import { voiceApi } from '../../../api/voice';
import { ApiError } from '../../../api/client';
import { useAuth } from '../../../context/AuthContext';
import { useToast } from '../../../components/Toast';
import { SkeletonCard, SkeletonRow } from '../../../components/Skeleton';
import { ErrorState } from '../../../components/ErrorState';
import { MESSAGES } from '../../../constants/messages';
import { VoiceContextBanners, VoiceLegalNotice, VoiceNotInVersionNotice, VoiceServerStatusBanner } from './VoiceServerStatusBanner';
import { VoiceRateField, VoiceToggleField } from './VoiceFields';
import { VoiceToneSettings } from './VoiceToneSettings';
import { VoiceNodeToneEditor } from './VoiceNodeToneEditor';
import { VoicePreviewPanel } from './VoicePreviewPanel';
import { VoiceStatsPanel } from './VoiceStatsPanel';
import { fromView, isDirty, missingNodeIdsFromDetails, rateForSlider, toInput, validateRate, type VoiceFormState } from './voiceForm';

/** 진입점 요약 배지 문구 — 색이 아니라 글자로 켜짐/꺼짐을 알린다(`VoiceSummaryBadge`). */
export function voiceSummaryText(input: boolean, tts: boolean): string {
  const msg = MESSAGES.voice;
  if (!input && !tts) return msg.summaryOff;
  return [input ? msg.summaryInputOn : null, tts ? msg.summaryTtsOn : null].filter(Boolean).join(' · ');
}

export interface VoiceSectionProps {
  chatbotId: string;
  isArchived: boolean;
  /** 로드 성공 후 진입점 요약 배지가 쓰도록 현재 저장값을 알린다. */
  onSummary?: (summary: { inputEnabled: boolean; ttsEnabled: boolean }) => void;
}

/**
 * [신규 No.32] VO-C1~C7 — WEB `ChannelCard` 안 "음성" 펼침 섹션(화면 설계서 §3). 새 라우트 0 · 선제 안내·채널 설정 폼과 독립으로 펼친다.
 * 서버 상태·법무 경고 → 기능 설정 → 말투 → 노드별 말투 → 들어보기 → 인식 숫자 → 저장 순서. 저장은 **전체 교체 PUT**이다.
 */
export function VoiceSection({ chatbotId, isArchived, onSummary }: VoiceSectionProps): JSX.Element {
  const msg = MESSAGES.voice;
  const { can } = useAuth();
  const { showToast } = useToast();
  const canWrite = can('channel:write') && !isArchived;
  const idPrefix = useId().replace(/:/g, '');
  const legalId = `${idPrefix}-legal`;

  const [overview, setOverview] = useState<VoiceOverviewResponse | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [form, setForm] = useState<VoiceFormState | null>(null);
  const [baseline, setBaseline] = useState<VoiceFormState | null>(null);
  const [rateError, setRateError] = useState<string | undefined>(undefined);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const rateRef = useRef<HTMLDivElement>(null);
  const savedOnce = useRef(false);

  async function load(): Promise<void> {
    setLoadError(false);
    try {
      const res = await voiceApi.getOverview(chatbotId);
      setOverview(res);
      const next = fromView(res.settings);
      setForm(next);
      setBaseline(next);
      onSummary?.({ inputEnabled: res.settings.inputEnabled, ttsEnabled: res.settings.ttsEnabled });
    } catch {
      setLoadError(true);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatbotId]);

  const dirty = useMemo(() => (form && baseline ? isDirty(form, baseline) : false), [form, baseline]);

  function patch(next: Partial<VoiceFormState>): void {
    setForm((prev) => (prev ? { ...prev, ...next } : prev));
  }

  async function handleSave(): Promise<void> {
    if (!form || !canWrite || saving) return;
    const problem = validateRate(form.rateText);
    if (problem) {
      setRateError(problem === 'range' ? msg.rateRangeError : msg.rateStepError);
      rateRef.current?.querySelector<HTMLInputElement>('input[type="number"]')?.focus();
      return;
    }
    setRateError(undefined);
    setRowErrors({});
    setFormError(undefined);
    setSaving(true);
    try {
      await voiceApi.saveSettings(chatbotId, toInput(form));
      savedOnce.current = true;
      showToast(msg.saved);
      await load();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'INVALID_REFERENCE') {
        const ids = missingNodeIdsFromDetails(e.details);
        const targets = ids.length > 0 ? ids : form.nodeTones.map((n) => n.nodeId);
        setRowErrors(Object.fromEntries(targets.map((id) => [id, msg.nodeInvalidRef])));
        setFormError(msg.saveFailed);
        showToast(msg.saveFailed);
        // 첫 오류 행으로 포커스 이동(저장 직후 렌더가 끝난 뒤).
        setTimeout(() => document.querySelector<HTMLElement>(`[data-node-id="${targets[0]}"] select`)?.focus(), 0);
      } else if (e instanceof ApiError && e.status === 403) {
        showToast(msg.noPermission);
      } else if (e instanceof ApiError) {
        setFormError(msg.saveFailed);
        showToast(msg.saveFailed);
      } else {
        showToast(msg.saveNetworkFailed); // 입력값은 그대로 둔다
      }
    } finally {
      setSaving(false);
    }
  }

  if (loadError && !overview) {
    return <ErrorState title={msg.loadFailed} onRetry={() => void load()} />;
  }
  if (!overview || !form) {
    return (
      <div aria-busy="true">
        <SkeletonRow />
        <SkeletonCard />
        <SkeletonRow />
        <SkeletonRow />
        <SkeletonRow />
      </div>
    );
  }

  const serverBlocksInput = !overview.server.inputAvailable;
  // 서버 불가 ∧ 현재 값이 꺼짐이면 켤 수 없다. **이미 켜져 있으면 끄기는 항상 가능**(켜진 채 갇히지 않게 — FR-VO5-2).
  const inputLocked = !canWrite || (serverBlocksInput && !form.inputEnabled);
  const inputReason = !canWrite ? msg.noPermission : serverBlocksInput && !form.inputEnabled ? msg.inputToggleBlocked : undefined;
  const rateNumeric = rateForSlider(form.rateText);

  return (
    <div className="voice-section" aria-label={msg.title} role="group">
      <VoiceServerStatusBanner server={overview.server} inputEnabled={form.inputEnabled} />
      <VoiceLegalNotice id={legalId} />
      <VoiceContextBanners context={overview.context} />
      {overview.settings.updatedAt === null && <p className="field-hint">{msg.neverSaved}</p>}
      {!canWrite && (
        <p className="form-banner form-banner--info" role="note">
          {msg.noPermission}
        </p>
      )}

      <section className="voice-block" aria-labelledby={`${idPrefix}-feature-title`}>
        <h4 id={`${idPrefix}-feature-title`}>{msg.featureGroupTitle}</h4>
        <VoiceToggleField
          id={`${idPrefix}-input`}
          label={msg.inputToggleLabel}
          help={msg.inputToggleHelp}
          checked={form.inputEnabled}
          onChange={(v) => patch({ inputEnabled: v })}
          disabled={inputLocked}
          disabledReason={inputReason}
          describedBy={legalId}
        >
          {serverBlocksInput && form.inputEnabled && (
            <p className="field-hint">
              <span aria-hidden="true">ⓘ</span> {msg.inputToggleLater}
            </p>
          )}
        </VoiceToggleField>
        <VoiceToggleField
          id={`${idPrefix}-tts`}
          label={msg.ttsToggleLabel}
          help={msg.ttsToggleHelp}
          checked={form.ttsEnabled}
          onChange={(v) => patch({ ttsEnabled: v })}
          disabled={!canWrite}
          disabledReason={!canWrite ? msg.noPermission : undefined}
        />
        <VoiceToggleField
          id={`${idPrefix}-autoread`}
          label={msg.autoReadToggleLabel}
          help={msg.autoReadToggleHelp}
          checked={form.autoReadToggleVisible}
          onChange={(v) => patch({ autoReadToggleVisible: v })}
          disabled={!canWrite || !form.ttsEnabled}
          disabledReason={!canWrite ? msg.noPermission : !form.ttsEnabled ? msg.autoReadToggleBlocked : undefined}
        />
      </section>

      <section className="voice-block" aria-labelledby={`${idPrefix}-rate-title`}>
        <h4 id={`${idPrefix}-rate-title`}>{msg.rateGroupTitle}</h4>
        <div ref={rateRef}>
          <VoiceRateField id={`${idPrefix}-rate`} text={form.rateText} onChange={(t) => patch({ rateText: t })} disabled={!canWrite} error={rateError} />
        </div>
        <p className="field-hint">
          <span aria-hidden="true">ⓘ</span> {msg.voiceDiffers}
        </p>
        <p className="field-hint">
          <span aria-hidden="true">ⓘ</span> {msg.systemNoticeUnread}
        </p>
      </section>

      <VoiceToneSettings
        idPrefix={idPrefix}
        defaultTone={form.defaultTone}
        unansweredTone={form.unansweredTone}
        onChangeDefault={(tone) => patch({ defaultTone: tone })}
        onChangeUnanswered={(tone) => patch({ unansweredTone: tone, unansweredExplicit: true })}
        disabled={!canWrite}
      />

      <VoiceNodeToneEditor
        chatbotId={chatbotId}
        rows={form.nodeTones}
        max={overview.limits.nodeTonesMax}
        disabled={!canWrite}
        rowErrors={rowErrors}
        onChange={(rows) => {
          setRowErrors({});
          patch({ nodeTones: rows });
        }}
      />

      <VoicePreviewPanel rateMultiplier={rateNumeric} initialTone={form.defaultTone} />

      <VoiceStatsPanel chatbotId={chatbotId} />

      <VoiceNotInVersionNotice />
      <p className="field-hint">{msg.cacheDelay}</p>
      {formError && (
        <p className="form-banner form-banner--error" role="alert">
          {formError}
        </p>
      )}
      <div className="form-actions voice-save-row">
        <span className="voice-dirty" role="status">
          {dirty ? msg.dirty : ''}
        </span>
        <button
          type="button"
          className="btn btn-primary"
          aria-disabled={!canWrite || saving || undefined}
          aria-describedby={!canWrite ? `${idPrefix}-save-reason` : undefined}
          onClick={() => void handleSave()}
        >
          {saving ? MESSAGES.common.saving : msg.saveButton}
        </button>
        {!canWrite && (
          <span id={`${idPrefix}-save-reason`} className="field-hint">
            {msg.noPermission}
          </span>
        )}
      </div>
    </div>
  );
}
