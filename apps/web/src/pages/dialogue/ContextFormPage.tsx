import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { ContextSlot } from '@chat-bot/shared-types';
import { useChatbotDetailContext } from '../ChatbotDetailLayout';
import { contextsApi } from '../../api/dialogue';
import { ApiError } from '../../api/client';
import { useToast } from '../../components/Toast';
import { InlineFieldError } from '../../components/InlineFieldError';
import { ChipListEditor } from '../../components/ChipListEditor';
import { ReorderableList } from '../../components/ReorderableList';
import { ErrorState } from '../../components/ErrorState';
import { MESSAGES } from '../../constants/messages';
import { fieldErrorsFromApiError } from '../../lib/apiErrorHelpers';
import { ContextSlotEditor } from './components/ContextSlotEditor';
import { ContextPreviewPanel } from './components/ContextPreviewPanel';

interface SlotRow extends ContextSlot {
  key: string;
}

let keySeq = 0;
function nextKey(): string {
  keySeq += 1;
  return `slot-${keySeq}-${Date.now()}`;
}

function emptySlot(): SlotRow {
  return { key: nextKey(), name: '', label: '', prompt: '', type: 'TEXT', required: true, maxRetry: 2 };
}

/** D4a/D4b — 컨텍스트 생성/편집 폼(ui-spec §4.6). */
export function ContextFormPage(): JSX.Element {
  const { chatbot, setUnsavedGuard } = useChatbotDetailContext();
  const { contextId } = useParams<{ contextId: string }>();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const isArchived = chatbot.status === 'ARCHIVED';
  const msg = MESSAGES.dialogue.contexts;
  const isNew = !contextId;

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [cancelKeywords, setCancelKeywords] = useState<string[]>(['취소', '그만', '처음으로']);
  const [sessionTimeoutMinutes, setSessionTimeoutMinutes] = useState(30);
  const [slots, setSlots] = useState<SlotRow[]>([emptySlot()]);
  const [completionMessage, setCompletionMessage] = useState('');
  const [loading, setLoading] = useState(!isNew);
  const [notFound, setNotFound] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formBanner, setFormBanner] = useState<string | undefined>(undefined);

  const load = useCallback(async () => {
    if (isNew || !contextId) return;
    setLoading(true);
    setNotFound(false);
    try {
      const detail = await contextsApi.findOne(chatbot.id, contextId);
      setName(detail.name);
      setDescription(detail.description ?? '');
      setCancelKeywords(detail.cancelKeywords);
      setSessionTimeoutMinutes(detail.sessionTimeoutMinutes);
      setSlots(detail.slots.map((s) => ({ ...s, key: nextKey() })));
      setCompletionMessage(detail.completionMessage ?? '');
      setDirty(false);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setNotFound(true);
      else showToast(MESSAGES.errors.generic);
    } finally {
      setLoading(false);
    }
  }, [chatbot.id, contextId, isNew, showToast]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setUnsavedGuard(dirty ? () => window.confirm(msg.unsavedConfirm) : null);
    return () => setUnsavedGuard(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty]);

  function markDirty<T>(setter: (v: T) => void) {
    return (v: T) => {
      setDirty(true);
      setter(v);
    };
  }

  function updateSlot(key: string, patch: Partial<ContextSlot>): void {
    setDirty(true);
    setSlots((prev) => prev.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  }

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (isArchived) return;
    setFormBanner(undefined);
    setFieldErrors({});
    setSaving(true);
    const payload = {
      name,
      description: description || undefined,
      slots: slots.map(({ key: _key, ...rest }) => rest),
      completionMessage: completionMessage || undefined,
      cancelKeywords,
      sessionTimeoutMinutes,
    };
    try {
      if (isNew) {
        await contextsApi.create(chatbot.id, payload);
        showToast(msg.saveSuccess);
        setDirty(false);
        navigate(`/chatbots/${chatbot.id}/dialogue/contexts`);
      } else if (contextId) {
        await contextsApi.update(chatbot.id, contextId, payload);
        showToast(msg.saveSuccess);
        setDirty(false);
        void load();
      }
    } catch (e2) {
      if (e2 instanceof ApiError) {
        const details = fieldErrorsFromApiError(e2);
        if (Object.keys(details).length > 0) setFieldErrors(details);
        else if (e2.code === 'DUPLICATE_NAME') setFieldErrors({ name: e2.message });
        else setFormBanner(e2.message || MESSAGES.errors.generic);
      } else {
        setFormBanner(MESSAGES.errors.generic);
      }
    } finally {
      setSaving(false);
    }
  }

  const placeholderNames = slots.map((s) => s.name).filter(Boolean);

  if (loading) return <p role="status">{MESSAGES.common.loading}</p>;
  if (notFound) return <ErrorState title={MESSAGES.dialogue.contexts.loadFailed} />;

  return (
    <div className="context-form-layout">
      <div>
        <Link to={`/chatbots/${chatbot.id}/dialogue/contexts`} className="detail-back-link">
          {msg.backToList}
        </Link>
        <h2>{isNew ? msg.titleNew : msg.titleEdit(name)}</h2>
        {formBanner && (
          <div className="form-banner form-banner--error" role="alert">
            {formBanner}
          </div>
        )}
        <form onSubmit={handleSubmit} noValidate>
          <fieldset disabled={isArchived} style={{ border: 'none', padding: 0, margin: 0 }}>
            <div className="form-field">
              <label htmlFor="context-name">
                {msg.nameLabel} <span className="required-mark" aria-hidden="true">*</span>
              </label>
              <input
                id="context-name"
                type="text"
                value={name}
                maxLength={100}
                onChange={(e) => markDirty(setName)(e.target.value)}
                aria-describedby={fieldErrors.name ? 'context-name-error' : undefined}
                aria-invalid={Boolean(fieldErrors.name)}
              />
              <InlineFieldError id="context-name-error" message={fieldErrors.name} />
            </div>
            <div className="form-field">
              <label htmlFor="context-description">{msg.descriptionLabel}</label>
              <textarea
                id="context-description"
                value={description}
                maxLength={300}
                rows={2}
                onChange={(e) => markDirty(setDescription)(e.target.value)}
              />
            </div>

            <ChipListEditor
              id="context-cancel-keywords"
              label={msg.cancelKeywordsLabel}
              values={cancelKeywords}
              onChange={markDirty(setCancelKeywords)}
              placeholder={msg.cancelKeywordPlaceholder}
              maxItems={10}
            />

            <div className="form-field">
              <label htmlFor="context-timeout">{msg.sessionTimeoutLabel}</label>
              <input
                id="context-timeout"
                type="number"
                min={1}
                max={180}
                value={sessionTimeoutMinutes}
                onChange={(e) => markDirty(setSessionTimeoutMinutes)(Number(e.target.value))}
              />
              <p className="field-hint">{msg.sessionTimeoutHelp}</p>
            </div>

            <div className="form-field">
              <span className="field-label-static">{msg.slotsTitle(slots.length, 20)}</span>
              <ReorderableList
                items={slots}
                getKey={(s) => s.key}
                onChange={(next) => {
                  setDirty(true);
                  setSlots(next as SlotRow[]);
                }}
                minItems={1}
                maxItems={20}
                onAdd={() => {
                  setDirty(true);
                  setSlots((prev) => [...prev, emptySlot()]);
                }}
                addLabel={msg.addSlot}
                onRemove={(key) => {
                  setDirty(true);
                  setSlots((prev) => prev.filter((s) => s.key !== key));
                }}
                itemLabel={(s, i) => `${i + 1}번째 슬롯(${s.label || s.name || '이름 없음'})`}
                renderItem={(s, index) => (
                  <ContextSlotEditor
                    slot={s}
                    onChange={(patch) => updateSlot(s.key, patch)}
                    chatbotId={chatbot.id}
                    idPrefix={`slot-${s.key}`}
                    nameError={fieldErrors[`slots.${index}.name`]}
                    choicesError={fieldErrors[`slots.${index}.choices`]}
                  />
                )}
              />
            </div>

            <div className="form-field">
              <label htmlFor="context-completion">{msg.completionMessageLabel}</label>
              <textarea
                id="context-completion"
                value={completionMessage}
                maxLength={500}
                rows={2}
                onChange={(e) => markDirty(setCompletionMessage)(e.target.value)}
              />
              <p className="char-counter">{completionMessage.length}/500자</p>
              {placeholderNames.length > 0 && (
                <p className="field-hint">{msg.completionMessageHelp(placeholderNames.map((n) => `{${n}}`).join(' '))}</p>
              )}
            </div>
          </fieldset>

          {!isArchived && (
            <div className="form-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => navigate(`/chatbots/${chatbot.id}/dialogue/contexts`)}
                disabled={saving}
              >
                {MESSAGES.common.cancel}
              </button>
              <button type="submit" className="btn btn-primary" disabled={!dirty || saving}>
                {saving ? MESSAGES.common.saving : MESSAGES.common.save}
              </button>
            </div>
          )}
        </form>
      </div>
      <ContextPreviewPanel slots={slots} completionMessage={completionMessage} />
    </div>
  );
}
