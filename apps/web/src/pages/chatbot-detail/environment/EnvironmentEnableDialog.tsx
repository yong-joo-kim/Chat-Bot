import { useCallback, useEffect, useRef, useState } from 'react';
import type { EnableEnvironmentPreviewResponse } from '@chat-bot/shared-types';
import { Modal } from '../../../components/Modal';
import { MESSAGES } from '../../../constants/messages';
import { ApiError } from '../../../api/client';
import { environmentApi } from '../../../api/environment';

export interface EnvironmentEnableDialogProps {
  chatbotId: string;
  isOpen: boolean;
  onClose: () => void;
  onEnabled: () => void;
}

/** EN1-a 켜기 확인 대화상자(`environment-separation-ui-spec.md` §4.3). */
export function EnvironmentEnableDialog({ chatbotId, isOpen, onClose, onEnabled }: EnvironmentEnableDialogProps): JSX.Element {
  const msg = MESSAGES.environment.enableDialog;
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [preview, setPreview] = useState<EnableEnvironmentPreviewResponse | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [staleBanner, setStaleBanner] = useState<string | null>(null);

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
      const res = await environmentApi.enablePreview(chatbotId);
      if (!isMountedRef.current) return;
      setPreview(res);
    } catch {
      if (!isMountedRef.current) return;
      setLoadError(true);
    } finally {
      if (isMountedRef.current) setLoading(false);
    }
  }, [chatbotId]);

  useEffect(() => {
    if (!isOpen) return;
    setStaleBanner(null);
    void fetchPreview();
  }, [isOpen, fetchPreview]);

  function handleClose(): void {
    if (confirming) return;
    onClose();
  }

  async function handleConfirm(): Promise<void> {
    if (!preview || confirming) return;
    setConfirming(true);
    try {
      await environmentApi.enable(chatbotId, { expectedDraftHash: preview.draftContentHash });
      if (!isMountedRef.current) return;
      onEnabled();
    } catch (e) {
      if (!isMountedRef.current) return;
      if (e instanceof ApiError && (e.code === 'ENV_POINTER_STALE' || e.code === 'ENV_SWITCH_BUSY' || e.code === 'ENV_MODE_ALREADY_ENABLED')) {
        setStaleBanner(MESSAGES.environment.errors[e.code]);
        await fetchPreview();
      }
      // 그 외 오류는 배너 없이 다이얼로그를 유지한다 — Toast로 안내(호출부 책임과 분리하지 않고 여기서 처리하지 않음).
    } finally {
      if (isMountedRef.current) setConfirming(false);
    }
  }

  return (
    <Modal isOpen={isOpen} title={msg.title} onClose={handleClose} closeOnEsc={!confirming} initialFocusSelector='[data-autofocus="cancel"]'>
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
              {staleBanner}
            </p>
          )}

          {preview.blockers.length > 0 ? (
            <ul className="restore-blocker-list">
              {preview.blockers.map((b, i) => (
                <li key={i}>
                  <span aria-hidden="true">⚠</span> {msg.blockers[b]}
                </li>
              ))}
            </ul>
          ) : (
            <>
              <p>{preview.version.action === 'REUSE' ? msg.bodyLine1Reuse(preview.version.versionNo) : msg.bodyLine1Create}</p>
              <p>{msg.bodyLine1b}</p>
              <p>{msg.bodyLine2}</p>
              <p>{msg.bodyLine3}</p>
              {preview.heldRestoreSchedules > 0 && <p>{msg.heldScheduleNotice(preview.heldRestoreSchedules)}</p>}
            </>
          )}

          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={confirming} data-autofocus="cancel">
              {msg.cancelButton}
            </button>
            {preview.blockers.length === 0 && (
              <button type="button" className="btn btn-primary" onClick={() => void handleConfirm()} disabled={confirming} aria-disabled={confirming}>
                {confirming ? msg.confirming : msg.confirmButton}
              </button>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
