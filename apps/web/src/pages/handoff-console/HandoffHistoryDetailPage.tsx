import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { HandoffHistoryDetailResponse } from '@chat-bot/shared-types';
import { ALERT_LEVEL_LABELS } from '@chat-bot/shared-types';
import { handoffApi } from '../../api/handoff';
import { ApiError } from '../../api/client';
import { ErrorState } from '../../components/ErrorState';
import { SkeletonRow } from '../../components/Skeleton';
import { EndReasonBadge } from '../../components/handoff/badges';
import { SessionRefLabel } from '../../components/handoff/SessionRefLabel';
import { TranscriptEntryList } from '../../components/handoff/TranscriptPanel';
import { formatDateTime } from '../../lib/date';
import { MESSAGES } from '../../constants/messages';
import { useHandoffConsoleChatbotContext } from './HandoffConsoleChatbotShell';

/**
 * HC4 — 상담 이력 상세(hybrid-cs-ui-spec.md §3.5, `/handoff-console/:chatbotId/history/:handoffId`).
 * ★ 원문 출구가 아니다(§9.3) — `TranscriptPanel`을 `readOnly`로 재사용해 `includeRaw` 자체를 렌더하지 않는다.
 */
export function HandoffHistoryDetailPage(): JSX.Element {
  const { chatbotId, chatbotName } = useHandoffConsoleChatbotContext();
  const { handoffId } = useParams<{ handoffId: string }>();
  const msg = MESSAGES.handoffConsole;

  const [detail, setDetail] = useState<HandoffHistoryDetailResponse | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!handoffId) return;
    setLoading(true);
    handoffApi
      .historyDetail(chatbotId, handoffId)
      .then(setDetail)
      .catch((e) => {
        if (e instanceof ApiError && e.status === 404) setNotFound(true);
      })
      .finally(() => setLoading(false));
  }, [chatbotId, handoffId]);

  if (!handoffId) return <ErrorState title={MESSAGES.errors.generic} />;
  if (notFound) return <ErrorState title={MESSAGES.handoffConsole.notFoundBanner} />;
  if (loading || !detail) return <SkeletonRow />;

  const { handoff } = detail;

  return (
    <div className="handoff-history-detail-page">
      <h2>
        {msg.pickerTitle} &gt; {chatbotName} &gt; {msg.historyTitle} &gt; <SessionRefLabel value={handoff.alias} />
      </h2>
      <p>
        {msg.historyColumnAssignee} {handoff.assignedUserName || '—'} · <EndReasonBadge reason={handoff.endReason} /> · {msg.historyColumnStarted}{' '}
        {formatDateTime(handoff.startedAt)} · {msg.historyColumnConnected} {handoff.connectedAt ? formatDateTime(handoff.connectedAt) : '—'} ·{' '}
        {msg.historyColumnEnded} {handoff.endedAt ? formatDateTime(handoff.endedAt) : '—'}
      </p>
      <p>
        {msg.historyDetailAlertAtStart}: {ALERT_LEVEL_LABELS[handoff.alertLevelAtStart]}
      </p>
      <TranscriptEntryList entries={detail.entries} />
    </div>
  );
}
