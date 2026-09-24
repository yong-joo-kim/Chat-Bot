import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { HandoffSettings, UpdateHandoffSettingsDto } from '@chat-bot/shared-types';
import { HANDOFF_LIMITS } from '@chat-bot/shared-types';
import { handoffApi } from '../../../api/handoff';
import { ApiError } from '../../../api/client';
import { useAuth } from '../../../context/AuthContext';
import { useToast } from '../../../components/Toast';
import { SkeletonCard } from '../../../components/Skeleton';
import { InlineFieldError } from '../../../components/InlineFieldError';
import { ResourcePickerField } from '../../../components/ResourcePickerField';
import { MESSAGES } from '../../../constants/messages';

interface FormState {
  enabled: boolean;
  cautionThreshold: number;
  warningThreshold: number;
  activeWindowMinutes: number;
  userIdleMinutes: number;
  agentNoReplyMinutes: number;
  connectNotice: string;
  endNotice: string;
  failNotice: string;
  endButtonLabel: string;
  endButtonNodeId: string | null;
}

function toFormState(s: HandoffSettings): FormState {
  return {
    enabled: s.enabled,
    cautionThreshold: s.cautionThreshold,
    warningThreshold: s.warningThreshold,
    activeWindowMinutes: s.activeWindowMinutes,
    userIdleMinutes: s.userIdleMinutes,
    agentNoReplyMinutes: s.agentNoReplyMinutes,
    connectNotice: s.connectNotice,
    endNotice: s.endNotice,
    failNotice: s.failNotice,
    endButtonLabel: s.endButtonLabel ?? '',
    endButtonNodeId: s.endButtonNodeId,
  };
}

function toDto(f: FormState): UpdateHandoffSettingsDto {
  const hasButton = f.endButtonLabel.trim() !== '' && f.endButtonNodeId;
  return {
    enabled: f.enabled,
    cautionThreshold: f.cautionThreshold,
    warningThreshold: f.warningThreshold,
    activeWindowMinutes: f.activeWindowMinutes,
    userIdleMinutes: f.userIdleMinutes,
    agentNoReplyMinutes: f.agentNoReplyMinutes,
    connectNotice: f.connectNotice,
    endNotice: f.endNotice,
    failNotice: f.failNotice,
    endButtonLabel: hasButton ? f.endButtonLabel.trim() : undefined,
    endButtonNodeId: hasButton ? (f.endButtonNodeId as string) : undefined,
  };
}

/**
 * HS1 — 상담 연계 설정(`AnswerSettingsTab` 3번째 섹션, hybrid-cs-ui-spec.md §3.7). ★ API가 별도
 * (`GET/PUT /chatbots/:chatbotId/handoff-settings`)이므로 답변 설정 저장 요청과 절대 합치지 않는다
 * (설계서 §26 D-1 — `ChatbotHandoffSetting`은 버전 스냅샷·복원 대상 밖의 별도 행이다).
 */
export function HandoffSettingsSection({ chatbotId, isArchived }: { chatbotId: string; isArchived: boolean }): JSX.Element {
  const { can } = useAuth();
  const { showToast } = useToast();
  const msg = MESSAGES.handoffSettings;
  const canWrite = can('chatbot:write') && !isArchived;

  const [settings, setSettings] = useState<HandoffSettings | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await handoffApi.getSettings(chatbotId);
      setSettings(res);
      setForm(toFormState(res));
    } catch {
      // 조회 실패는 조용히 로딩만 끝낸다 — 답변 설정 섹션과 독립적이라 페이지 전체를 막지 않는다.
    } finally {
      setLoading(false);
    }
  }, [chatbotId]);

  useEffect(() => {
    void load();
  }, [load]);

  function updateForm(patch: Partial<FormState>): void {
    setForm((prev) => (prev ? { ...prev, ...patch } : prev));
  }

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!form) return;
    setFieldErrors({});
    setSaving(true);
    try {
      const updated = await handoffApi.updateSettings(chatbotId, toDto(form));
      setSettings(updated);
      setForm(toFormState(updated));
      showToast(msg.saveSuccess);
    } catch (err) {
      if (err instanceof ApiError && err.details && err.details.length > 0) {
        const map: Record<string, string> = {};
        for (const d of err.details) map[d.field] = d.message;
        setFieldErrors(map);
      } else {
        showToast(err instanceof ApiError ? err.message : MESSAGES.errors.generic);
      }
    } finally {
      setSaving(false);
    }
  }

  if (loading || !form || !settings) {
    return (
      <section className="answer-settings-section">
        <h3>{msg.sectionTitle}</h3>
        <SkeletonCard />
      </section>
    );
  }

  return (
    <section className="answer-settings-section">
      <form onSubmit={(e) => void handleSubmit(e)} noValidate>
        <fieldset disabled={!canWrite} className="answer-settings-fieldset">
          <legend className="answer-settings-section-header">
            <h3>{msg.sectionTitle}</h3>
          </legend>

          {isArchived && <p className="field-hint">{msg.archivedNotice}</p>}
          {settings.draining && form.enabled === false && <p className="field-hint">{msg.drainingHint}</p>}

          <label className="form-field--inline">
            <input type="checkbox" checked={form.enabled} onChange={(e) => updateForm({ enabled: e.target.checked })} />
            {msg.enabledLabel}
          </label>

          <div className="form-field">
            <label htmlFor="hs-caution">{msg.cautionThresholdLabel}</label>
            <input
              id="hs-caution"
              type="number"
              min={1}
              max={10}
              value={form.cautionThreshold}
              onChange={(e) => updateForm({ cautionThreshold: Number(e.target.value) })}
            />
          </div>
          <div className="form-field">
            <label htmlFor="hs-warning">{msg.warningThresholdLabel}</label>
            <input
              id="hs-warning"
              type="number"
              min={1}
              max={10}
              value={form.warningThreshold}
              onChange={(e) => updateForm({ warningThreshold: Number(e.target.value) })}
              aria-describedby={fieldErrors.warningThreshold ? 'hs-warning-error' : undefined}
              aria-invalid={Boolean(fieldErrors.warningThreshold)}
            />
            <InlineFieldError id="hs-warning-error" message={fieldErrors.warningThreshold} />
          </div>
          <div className="form-field">
            <label htmlFor="hs-window">{msg.activeWindowLabel}</label>
            <input
              id="hs-window"
              type="number"
              min={5}
              max={60}
              value={form.activeWindowMinutes}
              onChange={(e) => updateForm({ activeWindowMinutes: Number(e.target.value) })}
            />
          </div>
          <div className="form-field">
            <label htmlFor="hs-idle">{msg.userIdleMinutesLabel}</label>
            <input
              id="hs-idle"
              type="number"
              min={3}
              max={60}
              value={form.userIdleMinutes}
              onChange={(e) => updateForm({ userIdleMinutes: Number(e.target.value) })}
            />
          </div>
          <div className="form-field">
            <label htmlFor="hs-agent-idle">{msg.agentNoReplyMinutesLabel}</label>
            <input
              id="hs-agent-idle"
              type="number"
              min={1}
              max={30}
              value={form.agentNoReplyMinutes}
              onChange={(e) => updateForm({ agentNoReplyMinutes: Number(e.target.value) })}
            />
          </div>

          <div className="form-field">
            <label htmlFor="hs-connect-notice">{msg.connectNoticeLabel}</label>
            <textarea
              id="hs-connect-notice"
              value={form.connectNotice}
              maxLength={HANDOFF_LIMITS.noticeMax}
              onChange={(e) => updateForm({ connectNotice: e.target.value })}
            />
            <p className="field-hint">{form.connectNotice.length}/{HANDOFF_LIMITS.noticeMax}</p>
          </div>
          <div className="form-field">
            <label htmlFor="hs-end-notice">{msg.endNoticeLabel}</label>
            <textarea
              id="hs-end-notice"
              value={form.endNotice}
              maxLength={HANDOFF_LIMITS.noticeMax}
              onChange={(e) => updateForm({ endNotice: e.target.value })}
            />
            <p className="field-hint">{form.endNotice.length}/{HANDOFF_LIMITS.noticeMax}</p>
          </div>
          <div className="form-field">
            <label htmlFor="hs-fail-notice">{msg.failNoticeLabel}</label>
            <textarea
              id="hs-fail-notice"
              value={form.failNotice}
              maxLength={HANDOFF_LIMITS.noticeMax}
              onChange={(e) => updateForm({ failNotice: e.target.value })}
            />
            <p className="field-hint">{form.failNotice.length}/{HANDOFF_LIMITS.noticeMax}</p>
          </div>

          <div className="form-field">
            <label htmlFor="hs-end-button-label">{msg.endButtonLabelField}</label>
            <input
              id="hs-end-button-label"
              type="text"
              value={form.endButtonLabel}
              maxLength={HANDOFF_LIMITS.buttonLabelMax}
              onChange={(e) => updateForm({ endButtonLabel: e.target.value })}
              aria-describedby={fieldErrors.endButtonNodeId ? 'hs-end-button-error' : undefined}
            />
          </div>
          <ResourcePickerField
            id="hs-end-button-node"
            label={msg.endButtonNodeLabel}
            resourceType="node"
            chatbotId={chatbotId}
            multiple={false}
            value={form.endButtonNodeId}
            onChange={(v) => updateForm({ endButtonNodeId: v as string | null })}
            disabled={!canWrite}
            errorMessage={fieldErrors.endButtonNodeId}
            helpText={msg.endButtonHelp}
          />
        </fieldset>

        {canWrite && (
          <div className="form-actions">
            <button type="button" className="btn btn-secondary" onClick={() => setForm(toFormState(settings))}>
              {MESSAGES.common.cancel}
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? MESSAGES.common.saving : MESSAGES.common.save}
            </button>
          </div>
        )}
      </form>
    </section>
  );
}
