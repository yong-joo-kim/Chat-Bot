import { useEffect, useState } from 'react';
import { VERSION_LIMITS } from '@chat-bot/shared-types';
import type { PromoteToStagingResponse } from '@chat-bot/shared-types';
import { Modal } from '../../../components/Modal';
import { MESSAGES } from '../../../constants/messages';
import { ApiError } from '../../../api/client';
import { environmentApi } from '../../../api/environment';

export interface StagingPromoteDialogProps {
  chatbotId: string;
  isOpen: boolean;
  onClose: () => void;
  /** 승격될 버전 번호(§4.5 레이아웃 "스테이징(v45)") — `EnvironmentStatusPanel`이 미리 계산해 넘긴다. */
  nextVersionNo: number;
  expectedStagingVersionId: string | null;
  changesSummaryText: string;
  onPromoted: (result: PromoteToStagingResponse) => void;
}

/** EN1-c 스테이징 승격 확인(`environment-separation-ui-spec.md` §4.5). */
export function StagingPromoteDialog({
  chatbotId,
  isOpen,
  onClose,
  nextVersionNo,
  expectedStagingVersionId,
  changesSummaryText,
  onPromoted,
}: StagingPromoteDialogProps): JSX.Element {
  const msg = MESSAGES.environment.promoteDialog;
  const [label, setLabel] = useState('');
  const [memo, setMemo] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [staleBanner, setStaleBanner] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setLabel('');
    setMemo('');
    setError(null);
    setStaleBanner(false);
  }, [isOpen]);

  function handleClose(): void {
    if (submitting) return;
    onClose();
  }

  async function handleConfirm(): Promise<void> {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await environmentApi.promote(chatbotId, {
        expectedStagingVersionId,
        label: label.trim() ? label.trim() : undefined,
        memo: memo.trim() ? memo.trim() : undefined,
      });
      onPromoted(res);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'ENV_POINTER_STALE') {
        setStaleBanner(true);
      } else {
        setError(e instanceof ApiError ? e.message : MESSAGES.errors.generic);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal isOpen={isOpen} title={msg.title} onClose={handleClose} closeOnEsc={!submitting} initialFocusSelector='[data-autofocus="cancel"]'>
      {staleBanner && (
        <p className="modal-banner modal-banner--warning" role="status" aria-live="polite">
          {MESSAGES.environment.errors.ENV_POINTER_STALE}
        </p>
      )}
      {error && (
        <p className="modal-banner modal-banner--error" role="alert">
          {error}
        </p>
      )}
      <p>{msg.body(nextVersionNo)}</p>
      <p className="restore-diff-summary">{changesSummaryText}</p>

      <div className="form-field">
        <label htmlFor="staging-promote-label">{msg.labelField}</label>
        <input id="staging-promote-label" type="text" value={label} maxLength={VERSION_LIMITS.labelMaxLength} onChange={(e) => setLabel(e.target.value)} />
      </div>
      <div className="form-field">
        <label htmlFor="staging-promote-memo">{msg.memoField}</label>
        <textarea id="staging-promote-memo" value={memo} maxLength={VERSION_LIMITS.memoMaxLength} onChange={(e) => setMemo(e.target.value)} />
      </div>

      <div className="modal-actions">
        <button type="button" className="btn btn-secondary" onClick={onClose} disabled={submitting} data-autofocus="cancel">
          {msg.cancelButton}
        </button>
        <button type="button" className="btn btn-primary" onClick={() => void handleConfirm()} disabled={submitting} aria-disabled={submitting}>
          {submitting ? msg.confirming : msg.confirmButton}
        </button>
      </div>
    </Modal>
  );
}
