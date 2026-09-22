import { useEffect, useState, type FormEvent } from 'react';
import type { BannedWord, BannedWordMatchType, BannedWordPolicy } from '@chat-bot/shared-types';
import { Modal } from '../../../components/Modal';
import { InlineFieldError } from '../../../components/InlineFieldError';
import { bannedWordsApi } from '../../../api/bannedWords';
import { ApiError } from '../../../api/client';
import { MESSAGES } from '../../../constants/messages';

/** B1 등록/수정 모달(security-audit-ui-spec.md §3.8.1). `word`/`matchType`/`policy`/`enabled`/`description`. */
export function BannedWordFormModal({
  isOpen,
  editing,
  onClose,
  onSaved,
}: {
  isOpen: boolean;
  editing: BannedWord | null;
  onClose: () => void;
  onSaved: () => void;
}): JSX.Element {
  const msg = MESSAGES.bannedWords;
  const [word, setWord] = useState('');
  const [matchType, setMatchType] = useState<BannedWordMatchType>('CONTAINS');
  const [policy, setPolicy] = useState<BannedWordPolicy>('BLOCK');
  const [enabled, setEnabled] = useState(true);
  const [description, setDescription] = useState('');
  const [wordError, setWordError] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setWord(editing?.word ?? '');
    setMatchType(editing?.matchType ?? 'CONTAINS');
    setPolicy(editing?.policy ?? 'BLOCK');
    setEnabled(editing?.enabled ?? true);
    setDescription(editing?.description ?? '');
    setWordError(undefined);
  }, [isOpen, editing]);

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setSubmitting(true);
    setWordError(undefined);
    try {
      const dto = { word: word.trim(), matchType, policy, enabled, description: description.trim() || undefined };
      if (editing) {
        await bannedWordsApi.update(editing.id, dto);
      } else {
        await bannedWordsApi.create(dto);
      }
      onSaved();
    } catch (e2) {
      if (e2 instanceof ApiError && e2.code === 'DUPLICATE_NAME') {
        setWordError(msg.duplicateWordError);
      } else if (e2 instanceof ApiError && e2.details && e2.details.length > 0) {
        setWordError(e2.details[0].message);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal isOpen={isOpen} title={editing ? msg.editTitle : msg.createTitle} onClose={onClose}>
      <form onSubmit={handleSubmit} noValidate>
        <div className="form-field">
          <label htmlFor="banned-word-word">
            {msg.wordLabel} <span className="required-mark" aria-hidden="true">*</span>
          </label>
          <input id="banned-word-word" type="text" value={word} required maxLength={100} autoFocus onChange={(e) => setWord(e.target.value)} />
          <p className="field-hint">{msg.wordHelp}</p>
          <InlineFieldError id="banned-word-word-error" message={wordError} />
        </div>
        <fieldset className="form-field">
          <legend>{msg.matchTypeLabel}</legend>
          <label className="form-field--inline">
            <input type="radio" name="banned-word-match-type" checked={matchType === 'CONTAINS'} onChange={() => setMatchType('CONTAINS')} />
            {msg.matchTypeContains}
          </label>
          <label className="form-field--inline">
            <input type="radio" name="banned-word-match-type" checked={matchType === 'EXACT'} onChange={() => setMatchType('EXACT')} />
            {msg.matchTypeExact}
          </label>
        </fieldset>
        <fieldset className="form-field">
          <legend>{msg.policyLabel}</legend>
          <label className="form-field--inline">
            <input type="radio" name="banned-word-policy" checked={policy === 'BLOCK'} onChange={() => setPolicy('BLOCK')} />
            {msg.policyBlock}
          </label>
          <label className="form-field--inline">
            <input type="radio" name="banned-word-policy" checked={policy === 'WARN'} onChange={() => setPolicy('WARN')} />
            {msg.policyWarn}
          </label>
        </fieldset>
        <label className="form-field--inline">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          {msg.enabledLabel}
        </label>
        <div className="form-field">
          <label htmlFor="banned-word-description">{msg.descriptionLabel}</label>
          <textarea id="banned-word-description" value={description} maxLength={500} rows={2} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {MESSAGES.common.cancel}
          </button>
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {MESSAGES.common.save}
          </button>
        </div>
      </form>
    </Modal>
  );
}
