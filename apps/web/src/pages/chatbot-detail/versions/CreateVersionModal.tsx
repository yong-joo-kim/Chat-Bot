import { useEffect, useState } from 'react';
import type { CreateChatbotVersionResponse } from '@chat-bot/shared-types';
import { VERSION_LIMITS } from '@chat-bot/shared-types';
import { Modal } from '../../../components/Modal';
import { MESSAGES } from '../../../constants/messages';
import { ApiError } from '../../../api/client';
import { versionsApi } from '../../../api/versions';

export interface CreateVersionModalProps {
  chatbotId: string;
  isOpen: boolean;
  onClose: () => void;
  /** 201(신규 생성) 성공 시에만 호출 — 목록을 다시 불러온다(§4.1.1). */
  onCreated: (versionNo: number) => void;
}

/**
 * L1 수동 저장 모달(`version-history-ui-spec.md` §4.1.1). `unchanged:true`(200)면 모달을 닫지 않고
 * "직전 버전과 내용이 같아 새로 저장하지 않았습니다" 안내로 전환하며, 입력한 라벨/메모를 그대로
 * 기존 최신 버전에 PATCH하는 단축 버튼을 제공한다(AC-H1-2).
 */
export function CreateVersionModal({ chatbotId, isOpen, onClose, onCreated }: CreateVersionModalProps): JSX.Element {
  const msg = MESSAGES.versions;
  const [label, setLabel] = useState('');
  const [memo, setMemo] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [unchanged, setUnchanged] = useState<{ latestVersionNo: number; latestVersionId: string } | null>(null);
  const [labelingLatest, setLabelingLatest] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setLabel('');
      setMemo('');
      setError(undefined);
      setUnchanged(null);
    }
  }, [isOpen]);

  async function handleSubmit(): Promise<void> {
    setSubmitting(true);
    setError(undefined);
    try {
      const res: CreateChatbotVersionResponse = await versionsApi.create(chatbotId, {
        label: label.trim() || undefined,
        memo: memo.trim() || undefined,
      });
      if (res.unchanged) {
        setUnchanged({ latestVersionNo: res.latestVersionNo, latestVersionId: res.latestVersionId });
      } else {
        onCreated(res.version.versionNo);
      }
    } catch (e) {
      if (e instanceof ApiError && e.code === 'VERSION_SNAPSHOT_TOO_LARGE') {
        setError(msg.snapshotTooLarge);
      } else {
        setError(e instanceof ApiError ? e.message : MESSAGES.errors.generic);
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleLabelLatest(): Promise<void> {
    if (!unchanged) return;
    setLabelingLatest(true);
    try {
      await versionsApi.update(chatbotId, unchanged.latestVersionId, {
        label: label.trim() || undefined,
        memo: memo.trim() || undefined,
      });
      onCreated(unchanged.latestVersionNo);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : MESSAGES.errors.generic);
    } finally {
      setLabelingLatest(false);
    }
  }

  return (
    <Modal isOpen={isOpen} title={msg.createTitle} onClose={onClose} closeOnEsc={!submitting && !labelingLatest}>
      {unchanged ? (
        <div>
          <p role="status">{msg.unchangedNotice(unchanged.latestVersionNo)}</p>
          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              {MESSAGES.common.close}
            </button>
            {(label.trim() || memo.trim()) && (
              <button type="button" className="btn btn-primary" onClick={() => void handleLabelLatest()} disabled={labelingLatest}>
                {msg.labelOnLatestButton(unchanged.latestVersionNo)}
              </button>
            )}
          </div>
        </div>
      ) : (
        <div>
          {error && (
            <p className="modal-banner modal-banner--error" role="alert">
              {error}
            </p>
          )}
          <div className="form-field">
            <label htmlFor="version-create-label">{msg.labelFieldLabel}</label>
            <input
              id="version-create-label"
              type="text"
              value={label}
              maxLength={VERSION_LIMITS.labelMaxLength}
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>
          <div className="form-field">
            <label htmlFor="version-create-memo">{msg.memoFieldLabel}</label>
            <textarea
              id="version-create-memo"
              value={memo}
              maxLength={VERSION_LIMITS.memoMaxLength}
              onChange={(e) => setMemo(e.target.value)}
            />
          </div>
          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={submitting}>
              {MESSAGES.common.cancel}
            </button>
            <button type="button" className="btn btn-primary" onClick={() => void handleSubmit()} disabled={submitting}>
              {submitting ? MESSAGES.common.saving : MESSAGES.common.save}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
