import { useEffect, useState } from 'react';
import type { Topic } from '@chat-bot/shared-types';
import { TOPIC_LIMITS } from '@chat-bot/shared-types';
import { Modal } from '../../../components/Modal';
import { InlineFieldError } from '../../../components/InlineFieldError';
import { useToast } from '../../../components/Toast';
import { MESSAGES } from '../../../constants/messages';
import { topicsApi } from '../../../api/topics';
import { ApiError } from '../../../api/client';

export interface TopicFormProps {
  isOpen: boolean;
  chatbotId: string;
  /** `undefined` = 생성, `Topic` = 편집. */
  value?: Topic;
  atLimit: boolean;
  onClose: () => void;
  onSaved: () => void;
}

/** `TopicForm` — 토픽 생성/편집 모달(`topic-system-ui-spec.md` §3.1.1). */
export function TopicForm({ isOpen, chatbotId, value, atLimit, onClose, onSaved }: TopicFormProps): JSX.Element {
  const msg = MESSAGES.topics;
  const { showToast } = useToast();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setFieldErrors({});
    setBanner(value ? undefined : atLimit ? msg.limitExceeded : undefined);
    setName(value?.name ?? '');
    setDescription(value?.description ?? '');
    setEnabled(value?.enabled ?? true);
  }, [isOpen, value, atLimit, msg]);

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    const errors: Record<string, string> = {};
    if (name.trim().length === 0 || [...name.trim()].length > TOPIC_LIMITS.nameMax) errors.name = msg.nameLengthError;
    if (description.length > TOPIC_LIMITS.descriptionMax) errors.description = msg.descriptionLengthError;
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }
    setSaving(true);
    setBanner(undefined);
    try {
      if (value) {
        await topicsApi.update(chatbotId, value.id, { name: name.trim(), description: description.trim() || null });
      } else {
        await topicsApi.create(chatbotId, { name: name.trim(), description: description.trim() || undefined, enabled });
      }
      showToast(msg.saveSuccess);
      onSaved();
      onClose();
    } catch (e2) {
      if (e2 instanceof ApiError) {
        if (e2.code === 'DUPLICATE_NAME') setFieldErrors({ name: msg.duplicateName });
        else if (e2.code === 'LIMIT_EXCEEDED') setBanner(msg.limitExceeded);
        else if (e2.code === 'CHATBOT_ARCHIVED') setBanner(MESSAGES.dialogue.archivedBanner);
        else setBanner(e2.message || MESSAGES.errors.generic);
      } else {
        setBanner(MESSAGES.errors.generic);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal isOpen={isOpen} title={value ? msg.editTitle : msg.createTitle} onClose={onClose}>
      <form onSubmit={(e) => void handleSubmit(e)} noValidate>
        {banner && (
          <p className="modal-banner modal-banner--error" role="alert">
            {banner}
          </p>
        )}
        <div className="form-field">
          <label htmlFor="topic-name">
            {msg.formNameLabel} <span className="required-mark" aria-hidden="true">*</span>
          </label>
          <input
            id="topic-name"
            type="text"
            value={name}
            maxLength={TOPIC_LIMITS.nameMax}
            onChange={(e) => setName(e.target.value)}
            aria-describedby={fieldErrors.name ? 'topic-name-error' : undefined}
            aria-invalid={Boolean(fieldErrors.name)}
          />
          <InlineFieldError id="topic-name-error" message={fieldErrors.name} />
        </div>
        <div className="form-field">
          <label htmlFor="topic-description">{msg.formDescriptionLabel}</label>
          <textarea id="topic-description" value={description} maxLength={TOPIC_LIMITS.descriptionMax} rows={2} onChange={(e) => setDescription(e.target.value)} />
          <p className="char-counter">
            {description.length}/{TOPIC_LIMITS.descriptionMax}자
          </p>
          <InlineFieldError id="topic-description-error" message={fieldErrors.description} />
        </div>
        {!value && (
          <label className="form-field--inline">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            {msg.formInitialEnabledLabel}
          </label>
        )}
        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {MESSAGES.common.cancel}
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? MESSAGES.common.saving : MESSAGES.common.save}
          </button>
        </div>
      </form>
    </Modal>
  );
}
