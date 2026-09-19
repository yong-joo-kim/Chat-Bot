import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ResourceRef } from '@chat-bot/shared-types';
import { Modal } from '../../../components/Modal';
import { InlineFieldError } from '../../../components/InlineFieldError';
import { ChipListEditor } from '../../../components/ChipListEditor';
import { useToast } from '../../../components/Toast';
import { MESSAGES } from '../../../constants/messages';
import { keywordsApi } from '../../../api/dialogue';
import { ApiError } from '../../../api/client';
import { fieldErrorsFromApiError } from '../../../lib/apiErrorHelpers';

export interface KeywordEditModalProps {
  isOpen: boolean;
  chatbotId: string;
  keywordId: string | null;
  onClose: () => void;
  onSaved: () => void;
  readOnly?: boolean;
}

/** D2b — 키워드 편집 모달(ui-spec §4.3). */
export function KeywordEditModal({ isOpen, chatbotId, keywordId, onClose, onSaved, readOnly = false }: KeywordEditModalProps): JSX.Element {
  const msg = MESSAGES.dialogue.intents;
  const { showToast } = useToast();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [synonyms, setSynonyms] = useState<string[]>([]);
  const [linkedNodes, setLinkedNodes] = useState<ResourceRef[]>([]);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [conflictBanner, setConflictBanner] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setFieldErrors({});
    setConflictBanner(undefined);
    if (keywordId) {
      setLoading(true);
      keywordsApi
        .findOne(chatbotId, keywordId)
        .then((detail) => {
          setName(detail.name);
          setDescription(detail.description ?? '');
          setSynonyms(detail.synonyms);
          setLinkedNodes(detail.linkedNodes);
        })
        .catch(() => showToast(MESSAGES.errors.generic))
        .finally(() => setLoading(false));
    } else {
      setName('');
      setDescription('');
      setSynonyms([]);
      setLinkedNodes([]);
    }
  }, [isOpen, keywordId, chatbotId, showToast]);

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (readOnly) return;
    const errors: Record<string, string> = {};
    if (!name.trim()) errors.name = '이름을 입력해 주세요.';
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }
    setSaving(true);
    setConflictBanner(undefined);
    try {
      if (keywordId) {
        await keywordsApi.update(chatbotId, keywordId, { name, description: description || null, synonyms });
      } else {
        await keywordsApi.create(chatbotId, { name, description: description || undefined, synonyms });
      }
      showToast(msg.saveSuccess);
      onSaved();
      onClose();
    } catch (e2) {
      if (e2 instanceof ApiError) {
        const details = fieldErrorsFromApiError(e2);
        if (e2.code === 'SYNONYM_CONFLICT') {
          setConflictBanner(e2.message);
        } else if (Object.keys(details).length > 0) {
          setFieldErrors(details);
        } else if (e2.code === 'DUPLICATE_NAME') {
          setFieldErrors({ name: e2.message });
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

  return (
    <Modal isOpen={isOpen} title={keywordId ? msg.editKeywordTitle(name || '') : msg.newKeywordTitle} onClose={onClose}>
      {loading ? (
        <p role="status">{MESSAGES.common.loading}</p>
      ) : (
        <form onSubmit={handleSubmit} noValidate>
          {conflictBanner && (
            <div className="form-banner form-banner--error" role="alert">
              {conflictBanner}
            </div>
          )}
          <fieldset disabled={readOnly} style={{ border: 'none', padding: 0, margin: 0 }}>
            <div className="form-field">
              <label htmlFor="keyword-name">
                {msg.nameLabel} <span className="required-mark" aria-hidden="true">*</span>
              </label>
              <input
                id="keyword-name"
                type="text"
                value={name}
                maxLength={100}
                onChange={(e) => setName(e.target.value)}
                aria-describedby={fieldErrors.name ? 'keyword-name-error' : undefined}
                aria-invalid={Boolean(fieldErrors.name)}
              />
              <InlineFieldError id="keyword-name-error" message={fieldErrors.name} />
            </div>
            <div className="form-field">
              <label htmlFor="keyword-description">{msg.descriptionLabel}</label>
              <textarea
                id="keyword-description"
                value={description}
                maxLength={300}
                rows={2}
                onChange={(e) => setDescription(e.target.value)}
              />
              <p className="char-counter">{description.length}/300자</p>
            </div>

            <ChipListEditor
              id="keyword-synonyms"
              label={msg.synonymsTitle(synonyms.length, 200)}
              values={synonyms}
              onChange={setSynonyms}
              placeholder={msg.synonymAddPlaceholder}
              addLabel={msg.addButton}
              maxItems={200}
              limitMessage={msg.synonymLimitReached}
              duplicateMessage={msg.duplicateSynonym}
              disabled={readOnly}
            />

            {keywordId && (
              <div className="form-field">
                <span className="field-label-static">{msg.linkedNodesTitleKeyword}</span>
                {linkedNodes.length === 0 ? (
                  <p className="field-hint">{msg.linkedNodesEmptyKeyword}</p>
                ) : (
                  <p>
                    {linkedNodes.map((n, i) => (
                      <span key={n.id}>
                        {i > 0 && ', '}
                        <Link to={`/chatbots/${chatbotId}/dialogue/nodes/${n.id}`} onClick={onClose}>
                          {n.name}
                        </Link>
                      </span>
                    ))}
                  </p>
                )}
              </div>
            )}
          </fieldset>

          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              {MESSAGES.common.cancel}
            </button>
            {!readOnly && (
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? MESSAGES.common.saving : MESSAGES.common.save}
              </button>
            )}
          </div>
        </form>
      )}
    </Modal>
  );
}
