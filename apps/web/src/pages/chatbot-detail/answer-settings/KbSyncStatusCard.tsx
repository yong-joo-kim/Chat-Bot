import { useEffect, useState } from 'react';
import type { ChatbotKbStatusResponse } from '@chat-bot/shared-types';
import { chatbotKbStatusApi } from '../../../api/kbChatbotStatus';
import { SkeletonRow } from '../../../components/Skeleton';
import { MESSAGES } from '../../../constants/messages';
import { formatRelativeTime } from '../../../lib/date';

/**
 * KB10 — 챗봇 답변 설정: 지식베이스 동기화 상태 카드(`kb-crawling-ui-spec.md` §3.7). 부가 정보라
 * 조회 실패 시 조용히 생략한다(다른 답변 설정 저장을 막지 않음 — 토스트도 띄우지 않는다). 기능 꺼짐도
 * 같은 404 경로로 조용히 생략된다.
 */
export function KbSyncStatusCard({ chatbotId }: { chatbotId: string }): JSX.Element | null {
  const msg = MESSAGES.answerSettings.rag;
  const [status, setStatus] = useState<ChatbotKbStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    chatbotKbStatusApi
      .get(chatbotId)
      .then((res) => {
        if (!cancelled) setStatus(res);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [chatbotId]);

  if (failed) return null;
  if (loading) return <SkeletonRow />;
  if (!status) return null;

  return (
    <div className="settings-card kb-sync-status-card">
      <h4>{msg.kbStatusCardTitle}</h4>
      {status.sources.length === 0 ? (
        <p>{msg.kbStatusEmptyText}</p>
      ) : (
        <>
          <p>{msg.kbStatusSourceCount(status.sources.length)}</p>
          <ul>
            {status.sources.map((s) => (
              <li key={s.id}>
                {s.name} — {msg.kbStatusLastSyncedLabel}: {s.lastSyncedAt ? formatRelativeTime(s.lastSyncedAt) : '—'}
                {s.needsCleanupCount > 0 && ` · ${msg.kbStatusNeedsCleanupLabel(s.needsCleanupCount)}`}
              </li>
            ))}
          </ul>
        </>
      )}
      {status.environmentModeOn && (
        <p className="field-hint">
          <span aria-hidden="true">ⓘ</span> {msg.kbStatusEnvironmentNotice}
        </p>
      )}
    </div>
  );
}
