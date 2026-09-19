import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { Chatbot, EmbedCode, UpdateChatbotSkinDto } from '@chat-bot/shared-types';
import { DEFAULT_CHATBOT_SKIN } from '@chat-bot/shared-types';
import { useChatbotDetailContext } from '../ChatbotDetailLayout';
import { chatbotsApi } from '../../api/chatbots';
import { ApiError } from '../../api/client';
import { useToast } from '../../components/Toast';
import { InlineFieldError } from '../../components/InlineFieldError';
import { CopyButton } from '../../components/CopyButton';
import { ConfirmDialog } from '../../components/Modal';
import { MESSAGES } from '../../constants/messages';
import { fieldErrorsFromApiError } from '../../lib/apiErrorHelpers';
import { ArchivedBanner } from './ArchivedBanner';
import { FormActions } from './FormActions';
import { ContrastWarningBadge } from './ContrastWarningBadge';
import { SkinPreviewPanel } from './SkinPreviewPanel';
import { EmbedCodeBlock } from './EmbedCodeBlock';
import { DraftEmbedNotice } from './DraftEmbedNotice';

interface SkinFormState {
  primaryColor: string;
  headerTitle: string;
  logoUrl: string;
}

function toFormState(chatbot: Chatbot): SkinFormState {
  return {
    primaryColor: chatbot.skin.primaryColor,
    headerTitle: chatbot.skin.headerTitle,
    logoUrl: chatbot.skin.logoUrl ?? '',
  };
}

function buildPatch(initial: SkinFormState, form: SkinFormState): UpdateChatbotSkinDto {
  const patch: UpdateChatbotSkinDto = {};
  if (form.primaryColor !== initial.primaryColor) patch.primaryColor = form.primaryColor;
  if (form.headerTitle !== initial.headerTitle) patch.headerTitle = form.headerTitle;
  if (form.logoUrl !== initial.logoUrl) patch.logoUrl = form.logoUrl === '' ? null : form.logoUrl;
  return patch;
}

function validate(form: SkinFormState): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!/^#[0-9a-fA-F]{6}$/.test(form.primaryColor)) {
    errors.primaryColor = MESSAGES.skin.primaryColorFormatError;
  }
  if (form.headerTitle.length > 50) {
    errors.headerTitle = MESSAGES.skin.headerTitleMaxLengthError;
  }
  if (form.logoUrl && !/^https?:\/\//i.test(form.logoUrl)) {
    errors.logoUrl = MESSAGES.settings.avatarUrlFormatError;
  }
  return errors;
}

/** S4 스킨/임베드 탭(FR-4-*, ui-spec §3.5). */
export function SkinEmbedTab(): JSX.Element {
  const { chatbot, reload } = useChatbotDetailContext();
  const { showToast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const section = searchParams.get('section') === 'embed' ? 'embed' : 'skin';

  const [initial, setInitial] = useState<SkinFormState>(() => toFormState(chatbot));
  const [form, setForm] = useState<SkinFormState>(() => toFormState(chatbot));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);

  const [embedCode, setEmbedCode] = useState<EmbedCode | null>(null);
  const [embedLoading, setEmbedLoading] = useState(false);

  const isArchived = chatbot.status === 'ARCHIVED';
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);

  useEffect(() => {
    setInitial(toFormState(chatbot));
    setForm(toFormState(chatbot));
    setFieldErrors({});
  }, [chatbot]);

  const loadEmbedCode = useCallback(async () => {
    setEmbedLoading(true);
    try {
      const res = await chatbotsApi.embedCode(chatbot.id);
      setEmbedCode(res);
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : MESSAGES.errors.generic);
    } finally {
      setEmbedLoading(false);
    }
  }, [chatbot.id, showToast]);

  useEffect(() => {
    if (section === 'embed') void loadEmbedCode();
  }, [section, loadEmbedCode]);

  function setSection(next: 'skin' | 'embed'): void {
    const params = new URLSearchParams(searchParams);
    if (next === 'embed') params.set('section', 'embed');
    else params.delete('section');
    setSearchParams(params, { replace: false });
  }

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    const errors = validate(form);
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }
    const patch = buildPatch(initial, form);
    if (Object.keys(patch).length === 0) return;
    setSaving(true);
    setFieldErrors({});
    try {
      const updated = await chatbotsApi.updateSkin(chatbot.id, patch);
      setInitial(toFormState(updated));
      setForm(toFormState(updated));
      showToast(MESSAGES.skin.saveSuccess);
      void reload();
      void loadEmbedCode();
    } catch (e2) {
      if (e2 instanceof ApiError) {
        const details = fieldErrorsFromApiError(e2);
        if (Object.keys(details).length > 0) {
          setFieldErrors(details);
        } else if (e2.code === 'CHATBOT_ARCHIVED') {
          showToast(e2.message);
          void reload();
        } else {
          showToast(e2.message || MESSAGES.errors.generic);
        }
      } else {
        showToast(MESSAGES.errors.generic);
      }
    } finally {
      setSaving(false);
    }
  }

  function handleCancel(): void {
    setForm(initial);
    setFieldErrors({});
  }

  function handleResetConfirm(): void {
    setForm({ primaryColor: DEFAULT_CHATBOT_SKIN.primaryColor, headerTitle: DEFAULT_CHATBOT_SKIN.headerTitle, logoUrl: '' });
    setResetConfirmOpen(false);
  }

  async function handleActivateNow(): Promise<void> {
    try {
      await chatbotsApi.updateStatus(chatbot.id, { status: 'ACTIVE' });
      showToast(MESSAGES.detail.statusChangeSuccess);
      void reload();
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : MESSAGES.errors.generic);
    }
  }

  return (
    <div className="skin-embed-tab">
      <ArchivedBanner visible={isArchived} />
      <div className="sub-tabs" role="tablist" aria-label="스킨/임베드 서브탭">
        <button
          type="button"
          role="tab"
          aria-selected={section === 'skin'}
          className={`sub-tab-button${section === 'skin' ? ' sub-tab-button--active' : ''}`}
          onClick={() => setSection('skin')}
        >
          {MESSAGES.skin.subTabSkin}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={section === 'embed'}
          className={`sub-tab-button${section === 'embed' ? ' sub-tab-button--active' : ''}`}
          onClick={() => setSection('embed')}
        >
          {MESSAGES.skin.subTabEmbed}
        </button>
      </div>

      {section === 'skin' ? (
        <form onSubmit={handleSubmit} noValidate className="skin-form-layout">
          <fieldset disabled={isArchived} className="skin-fieldset">
            <legend className="sr-only">스킨 설정</legend>

            <div className="form-field">
              <label htmlFor="primaryColor">
                {MESSAGES.skin.primaryColorLabel}{' '}
                <span className="required-mark" aria-hidden="true">
                  *
                </span>
              </label>
              <div className="color-field-row">
                <input
                  id="primaryColor"
                  type="text"
                  value={form.primaryColor}
                  maxLength={7}
                  onChange={(e) => setForm((prev) => ({ ...prev, primaryColor: e.target.value }))}
                  aria-describedby={fieldErrors.primaryColor ? 'primaryColor-error' : undefined}
                  aria-invalid={Boolean(fieldErrors.primaryColor)}
                />
                <input
                  type="color"
                  aria-label="주 색상 선택"
                  value={/^#[0-9a-fA-F]{6}$/.test(form.primaryColor) ? form.primaryColor : '#4F46E5'}
                  onChange={(e) => setForm((prev) => ({ ...prev, primaryColor: e.target.value }))}
                />
              </div>
              <InlineFieldError id="primaryColor-error" message={fieldErrors.primaryColor} />
              <ContrastWarningBadge primaryColor={form.primaryColor} />
            </div>

            <div className="form-field">
              <label htmlFor="headerTitle">
                {MESSAGES.skin.headerTitleLabel}{' '}
                <span className="required-mark" aria-hidden="true">
                  *
                </span>
              </label>
              <input
                id="headerTitle"
                type="text"
                value={form.headerTitle}
                maxLength={60}
                onChange={(e) => setForm((prev) => ({ ...prev, headerTitle: e.target.value }))}
                aria-describedby={`headerTitle-count${fieldErrors.headerTitle ? ' headerTitle-error' : ''}`}
                aria-invalid={Boolean(fieldErrors.headerTitle)}
              />
              <p id="headerTitle-count" className={`char-counter${form.headerTitle.length > 50 ? ' char-counter--over' : ''}`}>
                {form.headerTitle.length}/50자 · {MESSAGES.skin.headerTitleHelp}
              </p>
              <InlineFieldError id="headerTitle-error" message={fieldErrors.headerTitle} />
            </div>

            <div className="form-field">
              <label htmlFor="logoUrl">{MESSAGES.skin.logoUrlLabel}</label>
              <input
                id="logoUrl"
                type="text"
                value={form.logoUrl}
                onChange={(e) => setForm((prev) => ({ ...prev, logoUrl: e.target.value }))}
                aria-describedby={fieldErrors.logoUrl ? 'logoUrl-error' : undefined}
                aria-invalid={Boolean(fieldErrors.logoUrl)}
              />
              <InlineFieldError id="logoUrl-error" message={fieldErrors.logoUrl} />
            </div>

            <button type="button" className="btn btn-secondary" onClick={() => setResetConfirmOpen(true)}>
              {MESSAGES.skin.resetButton}
            </button>
          </fieldset>

          <SkinPreviewPanel skin={form} />

          {!isArchived && (
            <div className="form-actions-full-width">
              <FormActions dirty={dirty} saving={saving} onCancel={handleCancel} />
            </div>
          )}
        </form>
      ) : (
        <div className="embed-section">
          <DraftEmbedNotice visible={chatbot.status !== 'ACTIVE'} onActivate={handleActivateNow} />
          {embedLoading || !embedCode ? (
            <p role="status">{MESSAGES.common.loading}</p>
          ) : (
            <>
              <div className="form-field">
                <span className="field-label-static">{MESSAGES.embed.publicUrlLabel}</span>
                <div className="public-url-row">
                  <span className="public-url-text">{embedCode.publicUrl}</span>
                  <CopyButton text={embedCode.publicUrl} />
                </div>
              </div>
              <EmbedCodeBlock label={MESSAGES.embed.pcSnippetLabel} code={embedCode.pc} />
              <EmbedCodeBlock label={MESSAGES.embed.mobileSnippetLabel} code={embedCode.mobile} />
            </>
          )}
        </div>
      )}

      <ConfirmDialog
        isOpen={resetConfirmOpen}
        title={MESSAGES.skin.resetConfirmTitle}
        description={MESSAGES.skin.resetConfirmDesc}
        confirmLabel={MESSAGES.skin.resetButton}
        onConfirm={handleResetConfirm}
        onCancel={() => setResetConfirmOpen(false)}
      />
    </div>
  );
}
