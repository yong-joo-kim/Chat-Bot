import { useCallback, useEffect, useState } from 'react';
import type { AlertLevel, LiveSessionListResponse } from '@chat-bot/shared-types';
import { handoffApi } from '../../api/handoff';
import { useLatestRequest } from '../../lib/useLatestRequest';
import { SkeletonRow } from '../../components/Skeleton';
import { ErrorState } from '../../components/ErrorState';
import { EmptyState } from '../../components/EmptyState';
import { LiveSessionFilterBar } from '../../components/handoff/LiveSessionFilterBar';
import { LiveSessionTable, SessionSummaryBar, PollingStaleBanner } from '../../components/handoff/LiveSessionTable';
import { MESSAGES } from '../../constants/messages';
import { useHandoffConsoleChatbotContext } from './HandoffConsoleChatbotShell';

const POLL_INTERVAL_MS = 5000;
const HIDDEN_POLL_INTERVAL_MS = 30000;

/** HC1 — 진행 중 세션 목록(hybrid-cs-ui-spec.md §3.2, `/handoff-console/:chatbotId/live`). */
export function LiveSessionListPage(): JSX.Element {
  const { chatbotId, chatbotName } = useHandoffConsoleChatbotContext();
  const msg = MESSAGES.handoffConsole;

  const [alert, setAlert] = useState<AlertLevel[]>([]);
  const [handoffFilter, setHandoffFilter] = useState<'NONE' | 'ACTIVE' | 'ENDED' | ''>('');
  const [data, setData] = useState<LiveSessionListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [failCount, setFailCount] = useState(0);
  const guard = useLatestRequest();

  const load = useCallback(async () => {
    const reqId = guard.next();
    try {
      const res = await handoffApi.liveSessions(chatbotId, {
        alert: alert.length ? alert : undefined,
        handoff: handoffFilter || undefined,
      });
      if (guard.isStale(reqId)) return;
      setData(res);
      setError(false);
      setFailCount(0);
    } catch {
      if (guard.isStale(reqId)) return;
      setError((prev) => prev || data === null);
      setFailCount((c) => c + 1);
    } finally {
      if (!guard.isStale(reqId)) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatbotId, alert, handoffFilter, guard]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  // §3.2: 진행 중 목록은 5초, 숨김 탭은 30초(Page Visibility) — `DeploySchedulesPage`/`TestRunListPage` 선례 재사용.
  useEffect(() => {
    let ticks = 0;
    const timer = window.setInterval(() => {
      ticks += 1;
      const hidden = document.visibilityState !== 'visible';
      if (hidden && ticks % (HIDDEN_POLL_INTERVAL_MS / POLL_INTERVAL_MS) !== 0) return;
      void load();
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  return (
    <div className="live-session-list-page">
      <h2>
        {msg.pickerTitle} &gt; {chatbotName}
      </h2>

      {data && !data.handoffEnabled && data.items.length > 0 && (
        <p className="field-hint" role="status">
          {msg.disabledBannerTitle}
        </p>
      )}

      {data && <SessionSummaryBar summary={data.summary} />}
      <PollingStaleBanner failedCount={failCount} />

      <LiveSessionFilterBar alert={alert} onAlertChange={setAlert} handoff={handoffFilter} onHandoffChange={setHandoffFilter} />

      {loading && !data ? (
        <>
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </>
      ) : error && !data ? (
        <ErrorState title={MESSAGES.errors.generic} onRetry={load} />
      ) : !data || data.items.length === 0 ? (
        <EmptyState title={msg.emptyLiveList} />
      ) : (
        <LiveSessionTable items={data.items} chatbotId={chatbotId} />
      )}
    </div>
  );
}
