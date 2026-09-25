import { useCallback, useEffect, useState } from 'react';
import type { Topic, TopicImpactPreview } from '@chat-bot/shared-types';
import { Modal } from '../../../components/Modal';
import { SkeletonRow } from '../../../components/Skeleton';
import { ErrorState } from '../../../components/ErrorState';
import { useToast } from '../../../components/Toast';
import { MESSAGES } from '../../../constants/messages';
import { topicsApi } from '../../../api/topics';
import { ApiError } from '../../../api/client';
import { topicStatusLabel } from './topicBadges';

export interface TopicImpactPreviewDialogProps {
  isOpen: boolean;
  chatbotId: string;
  topic: Topic | null;
  action: 'ENABLE' | 'DISABLE';
  onClose: () => void;
  onDone: (topic: Topic) => void;
}

/**
 * `TopicImpactPreviewDialog` — 활성/비활성 전환 전 영향 미리보기(`topic-system-ui-spec.md` §3.2).
 * 서버는 확인을 강제하지 않지만(D-7), 이 화면은 미리보기 응답을 받기 전까지 확인 버튼을 내주지
 * 않는 방식으로 "필수"를 구현한다 — 프런트가 유일한 게이팅 방어선이다.
 */
export function TopicImpactPreviewDialog({ isOpen, chatbotId, topic, action, onClose, onDone }: TopicImpactPreviewDialogProps): JSX.Element {
  const msg = MESSAGES.topics;
  const { showToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [preview, setPreview] = useState<TopicImpactPreview | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [archivedBanner, setArchivedBanner] = useState(false);

  const fetchPreview = useCallback(async () => {
    if (!topic) return;
    setLoading(true);
    setLoadError(false);
    try {
      const res = await topicsApi.impact(chatbotId, topic.id, action);
      setPreview(res);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [chatbotId, topic, action]);

  useEffect(() => {
    if (!isOpen || !topic) return;
    setPreview(null);
    setArchivedBanner(false);
    void fetchPreview();
  }, [isOpen, topic, fetchPreview]);

  function handleClose(): void {
    if (confirming) return;
    onClose();
  }

  async function handleConfirm(): Promise<void> {
    if (!topic || !preview || confirming || preview.alreadyInState) return;
    setConfirming(true);
    setArchivedBanner(false);
    try {
      const updated = action === 'DISABLE' ? await topicsApi.disable(chatbotId, topic.id) : await topicsApi.enable(chatbotId, topic.id);
      showToast(action === 'DISABLE' ? msg.impactToastDisabled(topic.name) : msg.impactToastEnabled(topic.name));
      onDone(updated);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'CHATBOT_ARCHIVED') {
        setArchivedBanner(true);
      } else {
        showToast(e instanceof ApiError ? e.message : MESSAGES.errors.generic);
      }
    } finally {
      setConfirming(false);
    }
  }

  const confirmDisabled = confirming || !preview || preview.alreadyInState;

  return (
    <Modal
      isOpen={isOpen}
      title={topic ? msg.impactDialogTitle(topic.name, action) : ''}
      onClose={handleClose}
      closeOnEsc={!confirming}
      initialFocusSelector='[data-autofocus="cancel"]'
    >
      {loading && (
        <p role="status" aria-live="polite">
          {msg.impactLoading}
        </p>
      )}
      {!loading && loadError && <ErrorState title={msg.impactErrorRetry} onRetry={() => void fetchPreview()} />}
      {!loading && !loadError && preview && (
        <div>
          {archivedBanner && (
            <p className="form-banner form-banner--error" role="alert">
              {MESSAGES.errors.notFoundChatbot}
            </p>
          )}
          {preview.alreadyInState ? (
            <p role="status">{msg.impactAlreadyInState(topicStatusLabel(action === 'DISABLE' ? 'INACTIVE' : 'ACTIVE'))}</p>
          ) : (
            <>
              <p>{msg.impactEntryPointsSummary(preview.entryPoints.dialogNodes, preview.entryPoints.intents, preview.entryPoints.faqs)}</p>

              <p className="field-label-static">
                {action === 'DISABLE' ? msg.impactBrokenRefsTitle(preview.brokenRefs.total) : msg.impactDuplicateExamplesTitle(preview.duplicateExamples.total)}
              </p>
              {action === 'DISABLE' ? (
                preview.brokenRefs.items.length === 0 ? (
                  <p className="field-hint">{msg.impactBrokenRefsEmpty}</p>
                ) : (
                  <ul className="topic-impact-ref-list">
                    {preview.brokenRefs.items.map((ref, i) => (
                      <li key={i}>
                        {ref.from.name}({ref.from.topicName}) → {ref.to.name}({ref.to.topicName})
                      </li>
                    ))}
                  </ul>
                )
              ) : preview.duplicateExamples.items.length === 0 ? (
                <p className="field-hint">—</p>
              ) : (
                <ul className="topic-impact-ref-list">
                  {preview.duplicateExamples.items.map((d, i) => (
                    <li key={i}>
                      "{d.example}" — {d.intentName}({d.topicName})
                    </li>
                  ))}
                </ul>
              )}

              {action === 'DISABLE' && preview.liveEntryPointsAfter === 0 && <p className="field-hint">{msg.impactLiveEntryPointsAfterZero}</p>}

              {preview.pendingRestoreSchedules > 0 && <p className="field-hint">{msg.impactPendingScheduleNotice(preview.pendingRestoreSchedules)}</p>}

              <p className="field-hint">{msg.impactMultiInstanceNotice}</p>
            </>
          )}

          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={confirming} data-autofocus="cancel">
              {MESSAGES.common.cancel}
            </button>
            {!preview.alreadyInState && (
              <button
                type="button"
                className={action === 'DISABLE' ? 'btn btn-danger' : 'btn btn-primary'}
                onClick={() => void handleConfirm()}
                disabled={confirmDisabled}
                aria-disabled={confirmDisabled}
              >
                {confirming ? MESSAGES.common.saving : action === 'DISABLE' ? msg.impactConfirmDisable : msg.impactConfirmEnable}
              </button>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
