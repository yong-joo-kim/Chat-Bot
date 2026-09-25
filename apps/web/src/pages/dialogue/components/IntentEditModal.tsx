import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ExampleConflict, ResourceRef, Topic } from '@chat-bot/shared-types';
import { Modal } from '../../../components/Modal';
import { InlineFieldError } from '../../../components/InlineFieldError';
import { ChipListEditor } from '../../../components/ChipListEditor';
import { TopicSelectField } from '../../../components/TopicSelectField';
import { useToast } from '../../../components/Toast';
import { MESSAGES } from '../../../constants/messages';
import { intentsApi } from '../../../api/dialogue';
import { ApiError } from '../../../api/client';
import { fieldErrorsFromApiError } from '../../../lib/apiErrorHelpers';
import { AugmentationPanel } from './AugmentationPanel';

export interface IntentEditModalProps {
  isOpen: boolean;
  chatbotId: string;
  intentId: string | null;
  /** [신규 No.22] `TopicSelectField`용 — 챗봇 전체 토픽(호출부가 1회 로드해 전달). */
  topics?: Topic[];
  onClose: () => void;
  onSaved: () => void;
  readOnly?: boolean;
}

/** D2a — 의도 편집 모달(ui-spec §4.3.1). */
export function IntentEditModal({ isOpen, chatbotId, intentId, topics = [], onClose, onSaved, readOnly = false }: IntentEditModalProps): JSX.Element {
  const msg = MESSAGES.dialogue.intents;
  const { showToast } = useToast();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [examples, setExamples] = useState<string[]>([]);
  const [topicId, setTopicId] = useState<string | null>(null);
  const [linkedNodes, setLinkedNodes] = useState<ResourceRef[]>([]);
  const [conflicts, setConflicts] = useState<ExampleConflict[]>([]);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setFieldErrors({});
    setConflicts([]);
    if (intentId) {
      setLoading(true);
      intentsApi
        .findOne(chatbotId, intentId)
        .then((detail) => {
          setName(detail.name);
          setDescription(detail.description ?? '');
          setExamples(detail.examples);
          setTopicId(detail.topicId ?? null);
          setLinkedNodes(detail.linkedNodes);
        })
        .catch(() => showToast(MESSAGES.errors.generic))
        .finally(() => setLoading(false));
    } else {
      setName('');
      setDescription('');
      setExamples([]);
      setTopicId(null);
      setLinkedNodes([]);
    }
  }, [isOpen, intentId, chatbotId, showToast]);

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
    try {
      const result = intentId
        ? await intentsApi.update(chatbotId, intentId, { name, description: description || null, examples, topicId })
        : await intentsApi.create(chatbotId, { name, description: description || undefined, examples, topicId: topicId ?? undefined });
      setConflicts(result.meta.conflicts);
      showToast(msg.saveSuccess);
      onSaved();
      if (result.meta.conflicts.length === 0) onClose();
    } catch (e2) {
      if (e2 instanceof ApiError) {
        const details = fieldErrorsFromApiError(e2);
        if (Object.keys(details).length > 0) setFieldErrors(details);
        else if (e2.code === 'DUPLICATE_NAME') setFieldErrors({ name: e2.message });
        else if (e2.code === 'INVALID_REFERENCE') setFieldErrors({ topicId: MESSAGES.topics.topicFieldInvalidReference });
        else showToast(e2.message || MESSAGES.errors.generic);
      } else {
        showToast(MESSAGES.errors.generic);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal isOpen={isOpen} title={intentId ? msg.editIntentTitle(name || '') : msg.newIntentTitle} onClose={onClose}>
      {loading ? (
        <p role="status">{MESSAGES.common.loading}</p>
      ) : (
        <form onSubmit={handleSubmit} noValidate>
          <fieldset disabled={readOnly} style={{ border: 'none', padding: 0, margin: 0 }}>
            <div className="form-field">
              <label htmlFor="intent-name">
                {msg.nameLabel} <span className="required-mark" aria-hidden="true">*</span>
              </label>
              <input
                id="intent-name"
                type="text"
                value={name}
                maxLength={100}
                onChange={(e) => setName(e.target.value)}
                aria-describedby={fieldErrors.name ? 'intent-name-error' : undefined}
                aria-invalid={Boolean(fieldErrors.name)}
              />
              <InlineFieldError id="intent-name-error" message={fieldErrors.name} />
            </div>
            <div className="form-field">
              <label htmlFor="intent-description">{msg.descriptionLabel}</label>
              <textarea
                id="intent-description"
                value={description}
                maxLength={300}
                rows={2}
                onChange={(e) => setDescription(e.target.value)}
              />
              <p className="char-counter">{description.length}/300자</p>
            </div>

            <TopicSelectField
              id="intent-topic"
              label={MESSAGES.topics.topicFieldLabel}
              topics={topics}
              value={topicId}
              onChange={setTopicId}
              disabled={readOnly}
              errorMessage={fieldErrors.topicId}
            />

            <ChipListEditor
              id="intent-examples"
              label={msg.examplesTitle(examples.length, 500)}
              values={examples}
              onChange={setExamples}
              placeholder={msg.exampleAddPlaceholder}
              addLabel={msg.addButton}
              maxItems={500}
              limitMessage={msg.exampleLimitReached}
              duplicateMessage={msg.duplicateExample}
              disabled={readOnly}
            />

            {intentId && (
              <AugmentationPanel
                chatbotId={chatbotId}
                intentId={intentId}
                currentExampleCount={examples.length}
                readOnly={readOnly}
                onExamplesAccepted={(newExampleTexts) => setExamples((prev) => [...prev, ...newExampleTexts])}
              />
            )}

            {conflicts.length > 0 && (
              <div className="form-banner form-banner--info" role="status">
                {conflicts.map((c) => (
                  <p key={`${c.example}-${c.intentId}`} style={{ margin: '4px 0' }}>
                    {msg.conflictBannerPrefix} '{c.intentName}'{msg.conflictBannerSuffix} "{c.example}"
                  </p>
                ))}
              </div>
            )}

            {intentId && (
              <div className="form-field">
                <span className="field-label-static">{msg.linkedNodesTitle}</span>
                {linkedNodes.length === 0 ? (
                  <p className="field-hint">{msg.linkedNodesEmpty}</p>
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
              {conflicts.length > 0 ? MESSAGES.common.confirm : MESSAGES.common.cancel}
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
