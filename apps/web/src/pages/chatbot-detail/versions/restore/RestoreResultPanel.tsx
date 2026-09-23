import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { EmbeddingIndexStatus, RestoreResponse } from '@chat-bot/shared-types';
import { embeddingApi } from '../../../../api/embedding';
import { MESSAGES } from '../../../../constants/messages';
import { IndexStatusBadge } from '../../answer-settings/IndexStatusBadge';

/**
 * L4 복원 완료 패널(`version-history-ui-spec.md` §4.4.4, FR-H4-5, S-1/S-8/S-9). 자동으로 사라지는
 * Toast가 아니라 상시 패널로 남아 "TC 세트로 검증하기" 흐름으로 바로 이어갈 수 있게 한다.
 */
export function RestoreResultPanel({
  chatbotId,
  result,
  onClose,
}: {
  chatbotId: string;
  result: RestoreResponse;
  onClose: () => void;
}): JSX.Element {
  const msg = MESSAGES.versions.restore.result;
  const [indexStatus, setIndexStatus] = useState<EmbeddingIndexStatus | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function poll(): Promise<void> {
      try {
        const status = await embeddingApi.status(chatbotId);
        if (cancelled) return;
        setIndexStatus(status);
        if (status.pending === 0 && timerRef.current !== null) {
          window.clearInterval(timerRef.current);
          timerRef.current = null;
        }
      } catch {
        // 폴링 실패는 배지를 갱신하지 않을 뿐 — 패널 자체는 유지한다.
      }
    }
    void poll();
    timerRef.current = window.setInterval(() => void poll(), 3000);
    return () => {
      cancelled = true;
      if (timerRef.current !== null) window.clearInterval(timerRef.current);
    };
  }, [chatbotId]);

  return (
    <div className="restore-result-panel" role="status" aria-live="polite">
      <p className="restore-result-title">
        <span aria-hidden="true">✔</span> {msg.success(result.restoredFromVersionNo)}
      </p>
      <p>{msg.backupNotice(result.backupVersionNo)}</p>
      {indexStatus && <IndexStatusBadge status={indexStatus} />}
      {result.reindexWasRunning && <p className="field-hint">{msg.reindexContinueNotice}</p>}
      {result.classifierDeleted && <p className="field-hint">{msg.classifierDeletedNotice}</p>}
      <div className="restore-result-actions">
        <Link to={`/chatbots/${chatbotId}/validation/sets`} className="btn btn-primary">
          {msg.validateLink}
        </Link>
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          {MESSAGES.common.close}
        </button>
      </div>
    </div>
  );
}
