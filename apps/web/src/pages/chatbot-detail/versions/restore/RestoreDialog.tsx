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
  // [No.22] `TOPIC_EXPOSURE_CHANGE` 경고 전용 확인 체크박스(§3.9) — `ACTIVE_CHATBOT`과 같은 게이팅 패턴.
  const [acknowledgeTopicExposure, setAcknowledgeTopicExposure] = useState(false);
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
    setAcknowledgeTopicExposure(false);
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
        acknowledgeTopicExposure: needsAckTopicExposure ? acknowledgeTopicExposure : undefined,
      });
      if (!isMountedRef.current) return;
      onRestored(res);
    } catch (e) {
      if (!isMountedRef.current) return;
      if (
        e instanceof ApiError &&
        (e.code === 'RESTORE_PREVIEW_STALE' || e.code === 'RESTORE_BLOCKED_BY_ACTIVE_JOB' || e.code === 'RESTORE_BUSY')
      ) {
        // [No.22 — 코드 리뷰 1회차 L-7] 백엔드가 트랜잭션 안 재검증을 추가하면서, 토픽 노출 값이
        // 바뀐 경우에도 이 경합 경로(RESTORE_PREVIEW_STALE 등)로 온다 — 최신 미리보기를 다시
        // 받아 `TOPIC_EXPOSURE_CHANGE` 체크박스를 다시 보여주고, 확인 체크는 초기화해 재확인을 강제한다.
        setAcknowledgeTopicExposure(false);
        setStaleBanner(true);
        await fetchPreview();
      } else if (e instanceof ApiError && e.code === 'RESTORE_IN_PROGRESS') {
        showToast(msg.inProgressToast);
        (onRestoreInProgressElsewhere ?? onClose)();
      } else if (e instanceof ApiError && e.code === 'VERSION_SNAPSHOT_TOO_LARGE') {
        setBackupFailedBanner(true);
      } else if (e instanceof ApiError && e.code === 'VERSION_INTEGRITY_FAILED') {
        setAcknowledgeTopicExposure(false);
        setStaleBanner(true);
        await fetchPreview();
      } else if (
        e instanceof ApiError &&
        e.code === 'VALIDATION_FAILED' &&
        e.details?.some((d) => d.field === 'acknowledgeTopicExposure')
      ) {
        // 확정 요청 사이에 노출 값이 바뀌어 서버가 `acknowledgeTopicExposure`를 요구하는 경우
        // (§3.9) — 최신 미리보기를 다시 받아 체크박스를 다시 보여준다.
        setAcknowledgeTopicExposure(false);
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
  // [No.22] §3.9 — `exposed`·`hidden`이 둘 다 0이면 서버가 이 경고 자체를 내려주지 않으므로,
  // 배열에 존재한다는 것만으로 게이팅이 필요하다고 판단한다(PM 강화: 확인 체크 필수).
  const topicExposureWarning = preview?.warnings.find((w) => w.code === 'TOPIC_EXPOSURE_CHANGE');
  const needsAckTopicExposure = Boolean(topicExposureWarning);
  const acceptedWarning = preview?.warnings.find((w) => w.code === 'ACCEPTED_SUGGESTIONS_NOT_RESUGGESTED');
  // [신규 No.40] `ENV_DRAFT_ONLY`는 다른 경고와 분리해 강조 배너로 먼저 보여준다(§4.11 — 확인 체크박스는 요구하지 않는다).
  const envDraftOnlyWarning = preview?.warnings.find((w) => w.code === 'ENV_DRAFT_ONLY');
  const otherWarnings = preview?.warnings.filter((w) => w.code !== 'ACCEPTED_SUGGESTIONS_NOT_RESUGGESTED' && w.code !== 'ENV_DRAFT_ONLY') ?? [];

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
              {envDraftOnlyWarning && (
                <p className="modal-banner modal-banner--info" role="status">
                  <span aria-hidden="true">ⓘ</span> {warningText(envDraftOnlyWarning)}
                </p>
              )}
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
                <label className="restore-ack-checkbox" id="restore-ack-active-label">
                  <input type="checkbox" checked={acknowledgeActive} onChange={(e) => setAcknowledgeActive(e.target.checked)} />
                  {msg.activeChatbotCheckboxLabel}
                </label>
              )}
              {needsAckTopicExposure && topicExposureWarning?.code === 'TOPIC_EXPOSURE_CHANGE' && (
                <label className="restore-ack-checkbox" id="restore-ack-topic-exposure-label">
                  <input type="checkbox" checked={acknowledgeTopicExposure} onChange={(e) => setAcknowledgeTopicExposure(e.target.checked)} />
                  {msg.topicExposureCheckboxLabel(topicExposureWarning.exposed)}
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
                disabled={confirming || (needsAck && !acknowledgeActive) || (needsAckTopicExposure && !acknowledgeTopicExposure)}
                aria-disabled={confirming || (needsAck && !acknowledgeActive) || (needsAckTopicExposure && !acknowledgeTopicExposure)}
                // [코드 리뷰 1회차 L-6] 게이팅 사유(미체크 확인 항목)를 스크린리더가 함께 읽도록 연결한다.
                aria-describedby={
                  [needsAck && !acknowledgeActive ? 'restore-ack-active-label' : null, needsAckTopicExposure && !acknowledgeTopicExposure ? 'restore-ack-topic-exposure-label' : null]
                    .filter((id): id is string => Boolean(id))
                    .join(' ') || undefined
                }
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
