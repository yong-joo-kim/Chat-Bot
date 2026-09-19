import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { Chatbot, UpdateChatbotSettingsDto } from '@chat-bot/shared-types';
import { useChatbotDetailContext } from '../ChatbotDetailLayout';
import { chatbotsApi } from '../../api/chatbots';
import { ApiError } from '../../api/client';
import { useToast } from '../../components/Toast';
import { InlineFieldError } from '../../components/InlineFieldError';
import { SlugAvailabilityField, type SlugCheckStatus } from '../../components/SlugAvailabilityField';
import { CopyButton } from '../../components/CopyButton';
import { ConfirmDialog } from '../../components/Modal';
import { Avatar } from '../../components/Avatar';
import { MESSAGES } from '../../constants/messages';
import { fieldErrorsFromApiError } from '../../lib/apiErrorHelpers';
import { ArchivedBanner } from './ArchivedBanner';
import { FormActions } from './FormActions';

interface SettingsFormState {
  name: string;
  avatarUrl: string;
  description: string;
  slug: string;
}

function toFormState(chatbot: Chatbot): SettingsFormState {
  return {
    name: chatbot.name,
    avatarUrl: chatbot.avatarUrl ?? '',
    description: chatbot.description ?? '',
    slug: chatbot.slug,
  };
}

function buildPatch(initial: SettingsFormState, form: SettingsFormState): UpdateChatbotSettingsDto {
  const patch: UpdateChatbotSettingsDto = {};
  if (form.name !== initial.name) patch.name = form.name;
  if (form.avatarUrl !== initial.avatarUrl) patch.avatarUrl = form.avatarUrl === '' ? null : form.avatarUrl;
  if (form.description !== initial.description) patch.description = form.description === '' ? null : form.description;
  if (form.slug !== initial.slug) patch.slug = form.slug;
  return patch;
}

function validate(form: SettingsFormState): Record<string, string> {
  const errors: Record<string, string> = {};
  if (form.name.trim().length === 0) errors.name = MESSAGES.settings.nameRequiredError;
  else if (form.name.length > 100) errors.name = MESSAGES.settings.nameMaxLengthError;
  if (form.description.length > 500) errors.description = MESSAGES.settings.descriptionMaxLengthError;
  if (form.avatarUrl && !/^https?:\/\//i.test(form.avatarUrl)) {
    errors.avatarUrl = MESSAGES.settings.avatarUrlFormatError;
  }
  if (form.slug.length < 3 || form.slug.length > 50 || !/^[a-z0-9-]+$/.test(form.slug)) {
    errors.slug = MESSAGES.settings.slugFormatError;
  }
  return errors;
}

/** S3 기본설정 탭(FR-3-*, ui-spec §3.4). */
export function SettingsTab(): JSX.Element {
  const { chatbot, reload, setUnsavedGuard } = useChatbotDetailContext();
  const { showToast } = useToast();
  const [initial, setInitial] = useState<SettingsFormState>(() => toFormState(chatbot));
  const [form, setForm] = useState<SettingsFormState>(() => toFormState(chatbot));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [slugStatus, setSlugStatus] = useState<SlugCheckStatus>('idle');
  const [slugChangeModalOpen, setSlugChangeModalOpen] = useState(false);
  const [publicUrl, setPublicUrl] = useState('');

  const isArchived = chatbot.status === 'ARCHIVED';
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);

  useEffect(() => {
    setInitial(toFormState(chatbot));
    setForm(toFormState(chatbot));
    setFieldErrors({});
  }, [chatbot]);

  useEffect(() => {
    chatbotsApi
      .embedCode(chatbot.id)
      .then((res) => setPublicUrl(res.publicUrl))
      .catch(() => setPublicUrl(''));
  }, [chatbot.id, chatbot.slug]);

  // AC-3-8: 저장하지 않은 변경 사항이 있으면 탭 이동/새로고침 시 확인한다.
  useEffect(() => {
    setUnsavedGuard(dirty ? () => window.confirm(MESSAGES.settings.unsavedChangesConfirm) : null);
    return () => setUnsavedGuard(null);
  }, [dirty, setUnsavedGuard]);

  useEffect(() => {
    function handleBeforeUnload(e: BeforeUnloadEvent): void {
      if (!dirty) return;
      e.preventDefault();
      e.returnValue = '';
    }
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [dirty]);

  const doSubmit = useCallback(async () => {
    const patch = buildPatch(initial, form);
    if (Object.keys(patch).length === 0) return;
    setSaving(true);
    try {
      const updated = await chatbotsApi.updateSettings(chatbot.id, patch);
      setInitial(toFormState(updated));
      setForm(toFormState(updated));
      setFieldErrors({});
      showToast(MESSAGES.settings.saveSuccess);
      void reload();
    } catch (e) {
      if (e instanceof ApiError) {
        const details = fieldErrorsFromApiError(e);
        if (Object.keys(details).length > 0) {
          setFieldErrors(details);
        } else if (e.code === 'DUPLICATE_SLUG' || e.code === 'RESERVED_SLUG') {
          setFieldErrors({ slug: e.message });
        } else if (e.code === 'CHATBOT_ARCHIVED') {
          showToast(e.message);
          void reload();
        } else {
          showToast(e.message || MESSAGES.errors.generic);
        }
      } else {
        showToast(MESSAGES.errors.generic);
      }
    } finally {
      setSaving(false);
      setSlugChangeModalOpen(false);
    }
  }, [chatbot.id, form, initial, reload, showToast]);

  function handleSubmit(e: FormEvent): void {
    e.preventDefault();
    const errors = validate(form);
    if (slugStatus === 'unavailable' && form.slug !== initial.slug) {
      errors.slug = errors.slug ?? MESSAGES.settings.slugUnavailableError;
    }
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});
    if (form.slug !== initial.slug) {
      setSlugChangeModalOpen(true);
      return;
    }
    void doSubmit();
  }

  function handleCancel(): void {
    setForm(initial);
    setFieldErrors({});
  }

  return (
    <div className="settings-tab">
      <ArchivedBanner visible={isArchived} />
      <form onSubmit={handleSubmit} noValidate>
        <fieldset disabled={isArchived} className="settings-fieldset">
          <legend className="sr-only">{MESSAGES.settings.title}</legend>

          <div className="form-field">
            <label htmlFor="name">
              {MESSAGES.settings.nameLabel}{' '}
              <span className="required-mark" aria-hidden="true">
                *
              </span>
            </label>
            <input
              id="name"
              type="text"
              value={form.name}
              maxLength={100}
              required
              onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
              aria-describedby={fieldErrors.name ? 'name-error' : undefined}
              aria-invalid={Boolean(fieldErrors.name)}
            />
            <InlineFieldError id="name-error" message={fieldErrors.name} />
          </div>

          <div className="form-field">
            <label htmlFor="avatarUrl">{MESSAGES.settings.avatarLabel}</label>
            <div className="avatar-field-row">
              <input
                id="avatarUrl"
                type="text"
                value={form.avatarUrl}
                onChange={(e) => setForm((prev) => ({ ...prev, avatarUrl: e.target.value }))}
                aria-describedby={fieldErrors.avatarUrl ? 'avatarUrl-error' : undefined}
                aria-invalid={Boolean(fieldErrors.avatarUrl)}
              />
              <Avatar name={form.name || chatbot.name} avatarUrl={form.avatarUrl || undefined} size={36} />
            </div>
            <InlineFieldError id="avatarUrl-error" message={fieldErrors.avatarUrl} />
          </div>

          <div className="form-field">
            <label htmlFor="description">{MESSAGES.settings.descriptionLabel}</label>
            <textarea
              id="description"
              value={form.description}
              maxLength={2000}
              rows={3}
              onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
              aria-describedby={`description-count${fieldErrors.description ? ' description-error' : ''}`}
              aria-invalid={Boolean(fieldErrors.description)}
            />
            <p id="description-count" className={`char-counter${form.description.length > 500 ? ' char-counter--over' : ''}`}>
              {MESSAGES.settings.descriptionCount(form.description.length, 500)}
            </p>
            <InlineFieldError id="description-error" message={fieldErrors.description} />
          </div>

          <SlugAvailabilityField
            id="slug"
            label={MESSAGES.settings.slugLabel}
            value={form.slug}
            onChange={(value) => setForm((prev) => ({ ...prev, slug: value }))}
            excludeChatbotId={chatbot.id}
            externalError={fieldErrors.slug}
            onStatusChange={setSlugStatus}
          />

          {publicUrl && (
            <div className="form-field">
              <span className="field-label-static">{MESSAGES.settings.publicUrlLabel}</span>
              <div className="public-url-row">
                <span className="public-url-text">{publicUrl}</span>
                <CopyButton text={publicUrl} />
              </div>
            </div>
          )}
        </fieldset>

        {!isArchived && <FormActions dirty={dirty} saving={saving} onCancel={handleCancel} />}
      </form>

      <ConfirmDialog
        isOpen={slugChangeModalOpen}
        title={MESSAGES.settings.slugChangeWarningTitle}
        description={MESSAGES.settings.slugChangeWarningDesc}
        confirmLabel={MESSAGES.settings.slugChangeWarningConfirm}
        onConfirm={() => void doSubmit()}
        onCancel={() => setSlugChangeModalOpen(false)}
      />
    </div>
  );
}
