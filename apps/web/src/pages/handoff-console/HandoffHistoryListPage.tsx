import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { HandoffHistoryItem, HandoffSummaryResponse } from '@chat-bot/shared-types';
import { handoffApi } from '../../api/handoff';
import { ApiError } from '../../api/client';
import { SkeletonRow } from '../../components/Skeleton';
import { ErrorState } from '../../components/ErrorState';
import { EmptyState } from '../../components/EmptyState';
import { Pagination } from '../../components/Pagination';
import { LowSampleBadge, EndReasonBadge } from '../../components/handoff/badges';
import { SessionRefLabel } from '../../components/handoff/SessionRefLabel';
import { formatDateTime, kstTodayDateInputValue, addDaysToDateInputValue } from '../../lib/date';
import { MESSAGES } from '../../constants/messages';
import { useHandoffConsoleChatbotContext } from './HandoffConsoleChatbotShell';

const PAGE_SIZE = 20;

function formatDuration(sec: number | null): string {
  if (sec === null) return '—';
  const min = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return min > 0 ? `${min}분${s}초` : `${s}초`;
}

/** HC3 — 상담 이력·요약(hybrid-cs-ui-spec.md §3.4, `/handoff-console/:chatbotId/history`). */
export function HandoffHistoryListPage(): JSX.Element {
  const { chatbotId, chatbotName } = useHandoffConsoleChatbotContext();
  const msg = MESSAGES.handoffConsole;

  const [from, setFrom] = useState(() => addDaysToDateInputValue(kstTodayDateInputValue(), -7));
  const [to, setTo] = useState(() => kstTodayDateInputValue());
  const [items, setItems] = useState<HandoffHistoryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [summary, setSummary] = useState<HandoffSummaryResponse | null>(null);
  const [summaryError, setSummaryError] = useState(false);
  const [rangeError, setRangeError] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const loadSummary = useCallback(async () => {
    setSummaryError(false);
    try {
      const res = await handoffApi.historySummary(chatbotId, { from, to, page: 1, pageSize: 1 });
      setSummary(res);
    } catch {
      setSummaryError(true);
    }
  }, [chatbotId, from, to]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    setRangeError(undefined);
    try {
      const res = await handoffApi.historyList(chatbotId, { from, to, page, pageSize: PAGE_SIZE });
      setItems(res.items);
      setTotal(res.total);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'STATS_RANGE_TOO_WIDE') {
        setRangeError(msg.historyRangeTooWide);
      } else {
        setError(true);
      }
    } finally {
      setLoading(false);
    }
  }, [chatbotId, from, to, page, msg]);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="handoff-history-list-page">
      <h2>
        {msg.pickerTitle} &gt; {chatbotName} &gt; {msg.historyTitle}
      </h2>

      <div className="handoff-history-summary-cards">
        {summaryError ? (
          <ErrorState title={msg.historyAggregationTimeout} onRetry={loadSummary} />
        ) : (
          summary && (
            <>
              <span>
                {msg.summaryCount} {summary.count}건
              </span>
              <span>
                {msg.summaryAvgFirstResponse} {summary.avgFirstResponseSec !== null ? formatDuration(summary.avgFirstResponseSec) : '—'}{' '}
                <LowSampleBadge n={summary.firstResponseSamples} />
              </span>
              <span>
                {msg.summaryAvgDuration} {summary.avgDurationSec !== null ? formatDuration(summary.avgDurationSec) : '—'}{' '}
                <LowSampleBadge n={summary.durationSamples} />
              </span>
            </>
          )
        )}
      </div>

      <div className="chatbot-filter-bar">
        <label className="form-field--inline">
          {msg.historyFilterPeriodLabel}
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          ~
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
      </div>
      {rangeError && <p className="field-error" role="alert">{rangeError}</p>}

      {loading ? (
        <>
          <SkeletonRow />
          <SkeletonRow />
        </>
      ) : error ? (
        <ErrorState title={MESSAGES.errors.generic} onRetry={load} />
      ) : items.length === 0 ? (
        <EmptyState title={msg.historyEmpty} />
      ) : (
        <>
          <div className="import-report-table-wrap">
            <table className="import-report-table">
              <thead>
                <tr>
                  <th scope="col">{msg.historyColumnAlias}</th>
                  <th scope="col">{msg.historyColumnStarted}</th>
                  <th scope="col">{msg.historyColumnConnected}</th>
                  <th scope="col">{msg.historyColumnEnded}</th>
                  <th scope="col">{msg.historyColumnAssignee}</th>
                  <th scope="col">{msg.historyColumnEndReason}</th>
                  <th scope="col">{msg.historyColumnMessageCount}</th>
                  <th scope="col">{msg.historyColumnFirstResponse}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <Link to={`/handoff-console/${chatbotId}/history/${item.id}`}>
                        <SessionRefLabel value={item.alias} />
                      </Link>
                    </td>
                    <td>{formatDateTime(item.startedAt)}</td>
                    <td>{item.connectedAt ? formatDateTime(item.connectedAt) : '—'}</td>
                    <td>{item.endedAt ? formatDateTime(item.endedAt) : '—'}</td>
                    <td>{item.assignedUserName || '—'}</td>
                    <td>
                      <EndReasonBadge reason={item.endReason} />
                    </td>
                    <td>
                      {item.userMessageCount}/{item.agentMessageCount}
                    </td>
                    <td>{item.firstResponseSec !== null ? formatDuration(item.firstResponseSec) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />
        </>
      )}
    </div>
  );
}
