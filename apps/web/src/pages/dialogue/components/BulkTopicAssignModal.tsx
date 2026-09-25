import { useState } from 'react';
import type { Topic, TopicAssetKind } from '@chat-bot/shared-types';
import { Modal } from '../../../components/Modal';
import { TopicSelectField } from '../../../components/TopicSelectField';
import { useToast } from '../../../components/Toast';
import { MESSAGES } from '../../../constants/messages';
import { topicAssignmentsApi } from '../../../api/topics';
import { ApiError } from '../../../api/client';

export interface BulkTopicAssignModalProps {
  isOpen: boolean;
  chatbotId: string;
  resourceKind: TopicAssetKind;
  resourceKindLabel: string;
  selectedIds: string[];
  topics: Topic[];
  onClose: () => void;
  onAssigned: () => void;
  /** 선택에서 미리 걸러진 시작·폴백 노드 수(§3.4 — 서버도 `TOPIC_SYSTEM_NODE_LOCKED`로 이중 방어). */
  systemNodeExcludedCount?: number;
}

/** D1~D5 공용 — 자산 토픽 일괄 지정 모달(`topic-system-ui-spec.md` §3.4). */
export function BulkTopicAssignModal({
  isOpen,
  chatbotId,
  resourceKind,
  resourceKindLabel,
  selectedIds,
  topics,
  onClose,
  onAssigned,
  systemNodeExcludedCount = 0,
}: BulkTopicAssignModalProps): JSX.Element {
  const msg = MESSAGES.topics;
  const { showToast } = useToast();
  const [targetTopicId, setTargetTopicId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [banner, setBanner] = useState<string | undefined>(undefined);

  const targetTopic = targetTopicId ? topics.find((t) => t.id === targetTopicId) : undefined;
  const isTargetInactive = Boolean(targetTopic && !targetTopic.enabled);

  function resetAndClose(): void {
    setTargetTopicId(null);
    setBanner(undefined);
    onClose();
  }

  async function handleSubmit(): Promise<void> {
    if (submitting || selectedIds.length === 0) return;
    setSubmitting(true);
    setBanner(undefined);
    try {
      const res = await topicAssignmentsApi.assign(chatbotId, { kind: resourceKind, ids: selectedIds, topicId: targetTopicId });
      showToast(msg.bulkAssignSuccess(res.updated, targetTopicId ? targetTopic?.name ?? '' : msg.commonRowLabel));
      onAssigned();
      resetAndClose();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'INVALID_REFERENCE') {
        setBanner(msg.bulkAssignPartialFailure(e.details?.length ?? 0));
      } else {
        showToast(e instanceof ApiError ? e.message : MESSAGES.errors.generic);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal isOpen={isOpen} title={msg.bulkAssignTitle(resourceKindLabel, selectedIds.length)} onClose={resetAndClose} closeOnEsc={!submitting}>
      {banner && (
        <div className="form-banner form-banner--error" role="alert">
          {banner}
        </div>
      )}
      <TopicSelectField id="bulk-topic-target" label={msg.bulkAssignTargetLabel} topics={topics} value={targetTopicId} onChange={setTargetTopicId} disabled={submitting} />

      {isTargetInactive && targetTopic && (
        <p className="form-banner form-banner--warning" role="status">
          <span aria-hidden="true">⚠</span> {`'${targetTopic.name}'`}{' '}
          {msg.bulkAssignInactiveWarning(
            resourceKind === 'NODE' ? selectedIds.length : 0,
            resourceKind === 'INTENT' ? selectedIds.length : 0,
            resourceKind === 'FAQ' ? selectedIds.length : 0,
          )}
        </p>
      )}

      <p className="field-hint">
        <span aria-hidden="true">ⓘ</span> {msg.bulkAssignUpdatedAtHint}
      </p>

      {systemNodeExcludedCount > 0 && (
        <p className="form-banner form-banner--info" role="status">
          {msg.bulkAssignSystemNodeExcluded(systemNodeExcludedCount)}
        </p>
      )}

      <div className="modal-actions">
        <button type="button" className="btn btn-secondary" onClick={resetAndClose} disabled={submitting}>
          {MESSAGES.common.cancel}
        </button>
        <button type="button" className="btn btn-primary" onClick={() => void handleSubmit()} disabled={submitting}>
          {submitting ? MESSAGES.common.saving : msg.bulkAssignSubmit}
        </button>
      </div>
    </Modal>
  );
}
