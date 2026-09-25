import { useEffect, useState } from 'react';
import type { Topic, TopicAssetCounts } from '@chat-bot/shared-types';
import { ConfirmDialog } from '../../../components/Modal';
import { useToast } from '../../../components/Toast';
import { MESSAGES } from '../../../constants/messages';
import { topicsApi } from '../../../api/topics';
import { ApiError } from '../../../api/client';

export interface DeleteTopicConfirmDialogProps {
  isOpen: boolean;
  chatbotId: string;
  topic: Topic | null;
  counts: TopicAssetCounts | null;
  onClose: () => void;
  onDeleted: () => void;
  /**
   * [코드 리뷰 1회차 M-5] 삭제 확인 이후 자산이 늘어나 `409 TOPIC_NOT_EMPTY`가 다시 오면
   * 대화상자를 닫지 않고 이 콜백으로 목록 재조회를 부모에 위임한다(§3.1.2) — 부모가 최신
   * `counts`를 담은 `topic`을 다시 넘겨주면 대화상자가 그 값으로 다시 렌더된다.
   */
  onStaleCounts?: () => void | Promise<void>;
}

/** `DeleteTopicConfirmDialog` — 자산 0건이면 즉시 삭제, 아니면 "공통으로 옮기고 삭제"(§3.1.2). */
export function DeleteTopicConfirmDialog({ isOpen, chatbotId, topic, counts, onClose, onDeleted, onStaleCounts }: DeleteTopicConfirmDialogProps): JSX.Element {
  const msg = MESSAGES.topics;
  const { showToast } = useToast();
  const [deleting, setDeleting] = useState(false);
  const [staleNotice, setStaleNotice] = useState(false);

  useEffect(() => {
    if (isOpen) setStaleNotice(false);
  }, [isOpen]);

  const totalCount = counts ? Object.values(counts).reduce((a, b) => a + b, 0) : 0;
  const isEmpty = totalCount === 0;

  async function handleConfirm(): Promise<void> {
    if (!topic || deleting) return;
    setDeleting(true);
    try {
      await topicsApi.remove(chatbotId, topic.id, { moveToCommon: !isEmpty });
      showToast(isEmpty ? MESSAGES.common.delete : msg.deleteSuccess(totalCount));
      onDeleted();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'TOPIC_NOT_EMPTY') {
        setStaleNotice(true);
        await onStaleCounts?.();
      } else {
        showToast(e instanceof ApiError ? e.message : MESSAGES.errors.generic);
      }
    } finally {
      setDeleting(false);
    }
  }

  return (
    <ConfirmDialog
      isOpen={isOpen}
      title={topic ? msg.deleteConfirmTitle(topic.name) : ''}
      description={
        topic
          ? isEmpty
            ? msg.deleteEmptyConfirmDesc(topic.name)
            : msg.deleteNotEmptyDesc(counts ?? { intents: 0, keywords: 0, homonyms: 0, contexts: 0, dialogNodes: 0, faqs: 0 })
          : ''
      }
      confirmLabel={isEmpty ? MESSAGES.common.delete : msg.deleteMoveToCommonButton}
      danger
      onConfirm={() => void handleConfirm()}
      onCancel={onClose}
      confirmDisabled={deleting}
    >
      {staleNotice && (
        <p className="form-banner form-banner--error" role="alert">
          {msg.deleteRetryStaleCounts}
        </p>
      )}
      {!isEmpty && counts && (
        <ul className="topic-delete-counts">
          {Object.entries(counts)
            .filter(([, v]) => v > 0)
            .map(([k, v]) => (
              <li key={k}>
                {msg.assetCountFieldLabel[k] ?? k} {v}
              </li>
            ))}
        </ul>
      )}
    </ConfirmDialog>
  );
}
