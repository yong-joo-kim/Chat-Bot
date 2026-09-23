import { useCallback, useEffect, useRef, useState } from 'react';
import type { RestorePreviewResponse, RestoreResponse } from '@chat-bot/shared-types';
import { Modal } from '../../../../components/Modal';
import { SeverityBadge } from '../../../../components/SeverityBadge';
import { useToast } from '../../../../components/Toast';
import { MESSAGES } from '../../../../constants/messages';
import { ApiError } from '../../../../api/client';
import { versionsApi } from '../../../../api/versions';
import { BlockerText, summaryLine, warningText } from './restorePreviewText';

export interface RestoreDialogProps {
  chatbotId: string;
  targetVersionId: string;
  targetVersionNo: number;
  isOpen: boolean;
  onClose: () => void;
  onRestored: (result: RestoreResponse) => void;
  /**
   * `409 RESTORE_IN_PROGRESS`로 다이얼로그가 강제 종료될 때 호출한다(L-3, §4.4 "목록 새로고침").
   * 다른 관리자의 복원으로 목록 상태가 이미 바뀌었을 수 있어 단순 `onClose`(취소)와 달리 재조회가
   * 필요하다. 지정하지 않으면 `onClose`로 폴백한다.
   */
  onRestoreInProgressElsewhere?: () => void;
}

/**
 * L4 복원 미리보기/확정 대화상자(`version-history-ui-spec.md` §4.4). 오픈 즉시 미리보기를 자동
 * 호출하고, 기본 포커스는 "취소"에 둔다(NFR-HA2). L1/L2/L3 어디서나 재사용한다.
 */
export function RestoreDialog({
  chatbotId,
  targetVersionId,
  targetVersionNo,
  isOpen,
  onClose,
  onRestored,
  onRestoreInProgressElsewhere,
}: RestoreDialogProps): JSX.Element {
  const msg = MESSAGES.versions.restore;
  const { showToast } = useToast();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [preview, setPreview] = useState<RestorePreviewResponse | null>(null);
  const [acknowledgeActive, setAcknowledgeActive] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [staleBanner, setStaleBanner] = useState(false);
  const [backupFailedBanner, setBackupFailedBanner] = useState(false);

  /**
   * M-1 — 미리보기/확정 요청 진행 중 언마운트되면 이후 응답으로 setState하지 않는다.
   * mount 시에도 true로 되돌려야 StrictMode의 mount→unmount→remount에서 false로 고정되지 않는다.
   */
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const fetchPreview = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const res = await versionsApi.restorePreview(chatbotId, targetVersionId);
      if (!isMountedRef.current) return;
      setPreview(res);
    } catch {
      if (!isMountedRef.current) return;
      setLoadError(true);
    } finally {
      if (isMountedRef.current) setLoading(false);
    }
  }, [chatbotId, targetVersionId]);

  useEffect(() => {
    if (!isOpen) return;
    setAcknowledgeActive(false);
    setStaleBanner(false);
    setBackupFailedBanner(false);
    void fetchPreview();
  }, [isOpen, fetchPreview]);

  function handleClose(): void {
    if (confirming) return;
    onClose();
  }

  async function handleConfirm(): Promise<void> {
    if (!preview || confirming) return;
    setConfirming(true);
    setBackupFailedBanner(false);
    try {
      const res = await versionsApi.restore(chatbotId, targetVersionId, {
        expectedCurrentHash: preview.currentContentHash,
        acknowledgeActive: needsAck ? acknowledgeActive : undefined,
      });
      if (!isMountedRef.current) return;
      onRestored(res);
    } catch (e) {
      if (!isMountedRef.current) return;
      if (
        e instanceof ApiError &&
        (e.code === 'RESTORE_PREVIEW_STALE' || e.code === 'RESTORE_BLOCKED_BY_ACTIVE_JOB' || e.code === 'RESTORE_BUSY')
      ) {
        setStaleBanner(true);
        await fetchPreview();
      } else if (e instanceof ApiError && e.code === 'RESTORE_IN_PROGRESS') {
        showToast(msg.inProgressToast);
        (onRestoreInProgressElsewhere ?? onClose)();
      } else if (e instanceof ApiError && e.code === 'VERSION_SNAPSHOT_TOO_LARGE') {
        setBackupFailedBanner(true);
      } else if (e instanceof ApiError && e.code === 'VERSION_INTEGRITY_FAILED') {
        setStaleBanner(true);
        await fetchPreview();
      } else {
        showToast(e instanceof ApiError ? e.message : MESSAGES.errors.generic);
      }
    } finally {
      if (isMountedRef.current) setConfirming(false);
    }
  }

  const needsAck = preview?.warnings.some((w) => w.code === 'ACTIVE_CHATBOT') ?? false;
  const acceptedWarning = preview?.warnings.find((w) => w.code === 'ACCEPTED_SUGGESTIONS_NOT_RESUGGESTED');
  const otherWarnings = preview?.warnings.filter((w) => w.code !== 'ACCEPTED_SUGGESTIONS_NOT_RESUGGESTED') ?? [];

  return (
    <Modal
      isOpen={isOpen}
      title={msg.dialogTitle(targetVersionNo)}
      onClose={handleClose}
      closeOnEsc={!confirming}
      initialFocusSelector='[data-autofocus="cancel"]'
    >
      {loading && (
        <p role="status" aria-live="polite">
          {msg.previewLoading}
        </p>
      )}
      {!loading && loadError && (
        <p className="modal-banner modal-banner--error" role="alert">
          {msg.loadFailed}
        </p>
      )}
      {!loading && !loadError && preview && (
        <div>
          {staleBanner && (
            <p className="modal-banner modal-banner--warning" role="status" aria-live="polite">
              {msg.staleBanner}
            </p>
          )}
          {backupFailedBanner && (
            <p className="modal-banner modal-banner--error" role="alert">
              {msg.backupFailedBanner}
            </p>
          )}

          {preview.blockers.length > 0 ? (
            <ul className="restore-blocker-list">
              {preview.blockers.map((b, i) => (
                <li key={i}>
                  <span aria-hidden="true">⚠</span> <BlockerText blocker={b} />
                  {b.code === 'SCHEMA_UNSUPPORTED' && (
                    <>
                      {' '}
                      <a href={`/chatbots/${chatbotId}/versions/${targetVersionId}/content`}>{msg.goToContentButton}</a>
                    </>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <>
              <p>{msg.laterChangesNotice(preview.changesUndone)}</p>
              <p className="restore-diff-summary">{summaryLine(preview.diffSummary.rows)}</p>

              {(acceptedWarning || otherWarnings.length > 0) && (
                <div className="restore-warning-block">
                  <p className="restore-warning-heading">{msg.warningsHeading}</p>
                  {acceptedWarning && (
                    <p className="form-banner form-banner--warning restore-accepted-warning">
                      <SeverityBadge severity="WARNING" label={warningText(acceptedWarning)} />
                    </p>
                  )}
                  {otherWarnings.length > 0 && (
                    <ul className="restore-warning-list">
                      {otherWarnings.map((w, i) => (
                        <li key={i}>{warningText(w)}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {needsAck && (
                <label className="restore-ack-checkbox">
                  <input type="checkbox" checked={acknowledgeActive} onChange={(e) => setAcknowledgeActive(e.target.checked)} />
                  {msg.activeChatbotCheckboxLabel}
                </label>
              )}
            </>
          )}

          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={confirming} data-autofocus="cancel">
              {preview.blockers.length > 0 ? msg.confirmedButtonOnly : msg.cancelButton}
            </button>
            {preview.blockers.length === 0 && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void handleConfirm()}
                disabled={confirming || (needsAck && !acknowledgeActive)}
                aria-disabled={confirming || (needsAck && !acknowledgeActive)}
              >
                {confirming ? msg.confirming : msg.confirmButton(targetVersionNo)}
              </button>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
