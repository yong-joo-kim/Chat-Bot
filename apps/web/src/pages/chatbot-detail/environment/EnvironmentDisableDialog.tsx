import { useCallback, useEffect, useRef, useState } from 'react';
import type { DisableEnvironmentPreviewResponse, EnvironmentDisableMode } from '@chat-bot/shared-types';
import { Modal } from '../../../components/Modal';
import { MESSAGES } from '../../../constants/messages';
import { ApiError } from '../../../api/client';
import { environmentApi } from '../../../api/environment';
import { versionsApi } from '../../../api/versions';
import { summaryLine } from '../versions/restore/restorePreviewText';

export interface EnvironmentDisableDialogProps {
  chatbotId: string;
  isOpen: boolean;
  onClose: () => void;
  onDisabled: () => void;
}

/**
 * EN1-b 끄기 확인 대화상자(`environment-separation-ui-spec.md` §4.4). "운영 유지"(기본)를 고르면
 * 콘솔이 먼저 기존 복원 API(`versionsApi.restorePreview`→`restore`)를 호출한 뒤 끄기를 확정한다 —
 * 사용자에게는 한 번의 클릭·한 번의 로딩으로 보인다(내부 2단계는 숨긴다).
 */
export function EnvironmentDisableDialog({ chatbotId, isOpen, onClose, onDisabled }: EnvironmentDisableDialogProps): JSX.Element {
  const msg = MESSAGES.environment.disableDialog;
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [preview, setPreview] = useState<DisableEnvironmentPreviewResponse | null>(null);
  const [mode, setMode] = useState<EnvironmentDisableMode>('KEEP_PROD');
  const [confirming, setConfirming] = useState(false);
  const [restoringStep, setRestoringStep] = useState(false);
  const [draftNotRestoredError, setDraftNotRestoredError] = useState(false);
  const [otherError, setOtherError] = useState<string | null>(null);

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
      const res = await environmentApi.disablePreview(chatbotId);
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
    setMode('KEEP_PROD');
    setDraftNotRestoredError(false);
    setOtherError(null);
    void fetchPreview();
  }, [isOpen, fetchPreview]);

  function handleClose(): void {
    if (confirming) return;
    onClose();
  }

  async function runKeepProdRestoreStep(prodVersionId: string): Promise<{ expectedProdVersionId: string; expectedDraftHash: string } | null> {
    setRestoringStep(true);
    try {
      const restorePreview = await versionsApi.restorePreview(chatbotId, prodVersionId);
      // 이 복원은 "운영 유지" 확정(사용자가 이미 끄기 확인 버튼을 눌렀음)의 내부 1단계다 — 별도 화면 없이
      // 자동으로 진행되므로 복원 경고 확인 체크(ACTIVE_CHATBOT·TOPIC_EXPOSURE_CHANGE)를 여기서 함께 승인한다.
      const restoreRes = await versionsApi.restore(chatbotId, prodVersionId, {
        expectedCurrentHash: restorePreview.currentContentHash,
        acknowledgeActive: true,
        acknowledgeTopicExposure: true,
      });
      return { expectedProdVersionId: prodVersionId, expectedDraftHash: restoreRes.contentHash };
    } catch (e) {
      if (!isMountedRef.current) return null;
      setOtherError(e instanceof ApiError ? e.message : MESSAGES.errors.generic);
      return null;
    } finally {
      if (isMountedRef.current) setRestoringStep(false);
    }
  }

  async function handleConfirm(): Promise<void> {
    if (!preview || confirming) return;
    setConfirming(true);
    setOtherError(null);
    setDraftNotRestoredError(false);
    try {
      let expectedDraftHash = preview.draftContentHash;
      let expectedProdVersionId = preview.prod.versionId;
      if (mode === 'KEEP_PROD' && preview.draftDiffersFromProd) {
        const restored = await runKeepProdRestoreStep(preview.prod.versionId);
        if (!restored) return;
        expectedDraftHash = restored.expectedDraftHash;
        expectedProdVersionId = restored.expectedProdVersionId;
      }
      const res = await environmentApi.disable(chatbotId, { mode, expectedProdVersionId, expectedDraftHash });
      if (!isMountedRef.current) return;
      void res;
      onDisabled();
    } catch (e) {
      if (!isMountedRef.current) return;
      if (e instanceof ApiError && e.code === 'ENV_DRAFT_NOT_RESTORED') {
        setDraftNotRestoredError(true);
      } else if (e instanceof ApiError && (e.code === 'ENV_POINTER_STALE' || e.code === 'ENV_SWITCH_BUSY')) {
        setOtherError(MESSAGES.environment.errors[e.code]);
        await fetchPreview();
      } else {
        setOtherError(e instanceof ApiError ? e.message : MESSAGES.errors.generic);
      }
    } finally {
      if (isMountedRef.current) setConfirming(false);
    }
  }

  const busy = confirming || restoringStep;

  return (
    <Modal isOpen={isOpen} title={msg.title} onClose={handleClose} closeOnEsc={!busy} initialFocusSelector='[data-autofocus="cancel"]'>
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
          {otherError && (
            <p className="modal-banner modal-banner--error" role="alert">
              {otherError}
            </p>
          )}
          {draftNotRestoredError && (
            <p className="modal-banner modal-banner--error" role="alert">
              {msg.draftNotRestoredError}
            </p>
          )}

          {!preview.draftDiffersFromProd ? (
            <p>{msg.sameStateBody}</p>
          ) : (
            <>
              <p>{msg.diffBodyPrefix(summaryLine(preview.diffSummary.rows))}</p>
              <fieldset className="form-field">
                <legend className="sr-only">{msg.title}</legend>
                <label>
                  <input type="radio" name="environment-disable-mode" checked={mode === 'KEEP_PROD'} onChange={() => setMode('KEEP_PROD')} />
                  {msg.modeKeepProd(preview.prod.versionNo)}
                </label>
                {mode === 'KEEP_PROD' && preview.potentialTieShift && (
                  <p className="field-hint">
                    <span aria-hidden="true">⚠</span> {msg.potentialTieShiftWarning}
                  </p>
                )}
                <label>
                  <input type="radio" name="environment-disable-mode" checked={mode === 'PROMOTE_DRAFT'} onChange={() => setMode('PROMOTE_DRAFT')} />
                  {msg.modePromoteDraft}
                </label>
              </fieldset>
            </>
          )}

          {restoringStep && (
            <p role="status" aria-live="polite">
              {msg.restoringStep(preview.prod.versionNo)}
            </p>
          )}

          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy} data-autofocus="cancel">
              {msg.cancelButton}
            </button>
            <button type="button" className="btn btn-primary" onClick={() => void handleConfirm()} disabled={busy} aria-disabled={busy}>
              {busy ? msg.confirming : draftNotRestoredError ? msg.retryFromStep1 : msg.confirmButton}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
