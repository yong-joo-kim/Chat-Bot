import { useEffect, useState } from 'react';
import type { TestCaseSet } from '@chat-bot/shared-types';
import { Modal } from '../../../../components/Modal';
import { InlineFieldError } from '../../../../components/InlineFieldError';
import { MESSAGES } from '../../../../constants/messages';

export interface TestSetFormModalProps {
  mode: 'create' | 'edit';
  isOpen: boolean;
  initial?: TestCaseSet | null;
  submitting: boolean;
  /** 서버 409(이름 중복) 응답을 부모가 그대로 넘겨 인라인 오류로 표시한다(§4.1). */
  nameError?: string;
  onSubmit: (values: { name: string; description: string }) => void;
  onClose: () => void;
}

/** V1 — 세트 생성/이름 변경 모달(`TestSetFormModal`, ui-spec §4.1). */
export function TestSetFormModal({ mode, isOpen, initial, submitting, nameError, onSubmit, onClose }: TestSetFormModalProps): JSX.Element {
  const msg = MESSAGES.validation.set;
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  useEffect(() => {
    if (isOpen) {
      setName(initial?.name ?? '');
      setDescription(initial?.description ?? '');
    }
  }, [isOpen, initial]);

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault();
    if (!name.trim() || submitting) return;
    onSubmit({ name: name.trim(), description: description.trim() });
  }

  return (
    <Modal isOpen={isOpen} title={mode === 'create' ? msg.formCreateTitle : msg.formEditTitle} onClose={onClose} closeOnEsc={!submitting}>
      <form onSubmit={handleSubmit}>
        <div className="form-field">
          <label htmlFor="test-set-name">
            {msg.nameLabel} <span className="required-mark" aria-hidden="true">*</span>
          </label>
          <input
            id="test-set-name"
            type="text"
            value={name}
            maxLength={100}
            required
            aria-describedby={nameError ? 'test-set-name-error' : undefined}
            aria-invalid={Boolean(nameError)}
            onChange={(e) => setName(e.target.value)}
          />
          <InlineFieldError id="test-set-name-error" message={nameError} />
        </div>
        <div className="form-field">
          <label htmlFor="test-set-desc">{msg.descLabel}</label>
          <textarea id="test-set-desc" rows={3} maxLength={300} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={submitting}>
            {MESSAGES.common.cancel}
          </button>
          <button type="submit" className="btn btn-primary" disabled={!name.trim() || submitting}>
            {submitting ? MESSAGES.common.saving : MESSAGES.common.save}
          </button>
        </div>
      </form>
    </Modal>
  );
}
