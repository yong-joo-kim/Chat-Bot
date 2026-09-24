import { useState, type FormEvent } from 'react';
import type { HandoffDetail } from '@chat-bot/shared-types';
import { HANDOFF_LIMITS } from '@chat-bot/shared-types';
import { handoffApi } from '../../api/handoff';
import { ApiError } from '../../api/client';
import { ConfirmDialog, Modal } from '../Modal';
import { InlineFieldError } from '../InlineFieldError';
import { MESSAGES } from '../../constants/messages';

/**
 * 개입 후 헤더 고정 액션(hybrid-cs-ui-spec.md §2.2 `HandoffActionBar`) — 종료·강제 인수.
 * 전송은 `AgentMessageComposer`가 별도로 담당한다.
 */
export function HandoffActionBar({
  chatbotId,
  handoffId,
  isAssignee,
  isAdmin,
  endButtonPreviewLabel,
  onEnded,
  onTakenOver,
  onError,
  onNotActive,
  onNotAssignee,
}: {
  chatbotId: string;
  handoffId: string;
  isAssignee: boolean;
  isAdmin: boolean;
  endButtonPreviewLabel?: string | null;
  onEnded: (detail: HandoffDetail) => void;
  onTakenOver: (detail: HandoffDetail) => void;
  onError: (message: string) => void;
  /** M1(코드 리뷰 1회차): 종료 도중 상담이 이미 종료됐다(`409 HANDOFF_NOT_ACTIVE`). */
  onNotActive?: () => void;
  /** M1: 종료 도중 담당이 바뀌었다(`403 HANDOFF_NOT_ASSIGNEE`) — 상태를 재조회한다. */
  onNotAssignee?: () => void;
}): JSX.Element {
  const msg = MESSAGES.handoffConsole;
  const [endConfirmOpen, setEndConfirmOpen] = useState(false);
  const [takeoverOpen, setTakeoverOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);

  const canEnd = isAssignee || isAdmin;

  async function handleEnd(): Promise<void> {
    setSubmitting(true);
    try {
      const detail = await handoffApi.end(chatbotId, handoffId);
      setEndConfirmOpen(false);
      onEnded(detail);
    } catch (e) {
      setEndConfirmOpen(false);
      if (e instanceof ApiError && e.code === 'HANDOFF_NOT_ACTIVE') {
        onError(msg.composerDisabledNotActive);
        onNotActive?.();
      } else if (e instanceof ApiError && e.code === 'HANDOFF_NOT_ASSIGNEE') {
        onError(msg.composerDisabledNotAssignee);
        onNotAssignee?.();
      } else {
        onError(e instanceof ApiError ? e.message : MESSAGES.errors.generic);
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleTakeover(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!reason.trim()) {
      setReasonError(msg.takeoverReasonRequired);
      return;
    }
    setReasonError(undefined);
    setSubmitting(true);
    try {
      const detail = await handoffApi.takeover(chatbotId, handoffId, { reason: reason.trim() });
      setTakeoverOpen(false);
      setReason('');
      onTakenOver(detail);
    } catch (e2) {
      if (e2 instanceof ApiError && e2.code === 'HANDOFF_NOT_ACTIVE') {
        onError(msg.composerDisabledNotActive);
        onNotActive?.();
      } else if (e2 instanceof ApiError && e2.code === 'HANDOFF_NOT_ASSIGNEE') {
        onError(msg.composerDisabledNotAssignee);
        onNotAssignee?.();
      } else {
        onError(e2 instanceof ApiError ? e2.message : MESSAGES.errors.generic);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="handoff-action-bar">
      <button
        type="button"
        className="btn btn-secondary"
        disabled={!canEnd}
        aria-disabled={!canEnd}
        title={!canEnd ? msg.endDisabledReason : undefined}
        onClick={() => setEndConfirmOpen(true)}
      >
        {msg.endButton}
      </button>
      {/* H2(코드 리뷰 1회차): 담당 여부와 무관하게 액션바 자체는 렌더되므로, 비담당 AGENT에게는 버튼을
          비활성화하고 사유를 병기한다(NFR-CSA6 — 버튼을 숨기지 않는다). */}
      {!canEnd && <span className="field-hint">{msg.endDisabledReason}</span>}
      <button
        type="button"
        className="btn btn-secondary"
        disabled={!isAdmin}
        aria-disabled={!isAdmin}
        title={!isAdmin ? msg.takeoverDisabledReason : undefined}
        onClick={() => setTakeoverOpen(true)}
      >
        {msg.takeoverButton}
      </button>
      {!isAdmin && <span className="field-hint">{msg.takeoverDisabledReason}</span>}

      <ConfirmDialog
        isOpen={endConfirmOpen}
        title={msg.endConfirmTitle}
        description={
          <>
            {msg.endConfirmDesc}
            {/* `ConfirmDialog`가 description을 `<p>`로 감싸므로 블록 요소(p) 중첩을 피해 `<span>`을 쓴다. */}
            {endButtonPreviewLabel && (
              <span className="field-hint field-hint--block">{msg.endConfirmButtonPreview(endButtonPreviewLabel)}</span>
            )}
          </>
        }
        confirmLabel={msg.endButton}
        onConfirm={() => void handleEnd()}
        onCancel={() => setEndConfirmOpen(false)}
        confirmDisabled={submitting}
      />

      <Modal isOpen={takeoverOpen} title={msg.takeoverConfirmTitle} onClose={() => setTakeoverOpen(false)}>
        <form onSubmit={(e) => void handleTakeover(e)} noValidate>
          <p>{msg.takeoverConfirmTitle}</p>
          <div className="form-field">
            <label htmlFor="takeover-reason">{msg.takeoverReasonLabel}</label>
            <textarea
              id="takeover-reason"
              value={reason}
              maxLength={HANDOFF_LIMITS.takeoverReasonMax}
              required
              aria-describedby={reasonError ? 'takeover-reason-error' : undefined}
              aria-invalid={Boolean(reasonError)}
              onChange={(e) => setReason(e.target.value)}
            />
            <InlineFieldError id="takeover-reason-error" message={reasonError} />
          </div>
          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={() => setTakeoverOpen(false)}>
              {MESSAGES.common.cancel}
            </button>
            <button type="submit" className="btn btn-danger" disabled={submitting}>
              {msg.takeoverButton}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
