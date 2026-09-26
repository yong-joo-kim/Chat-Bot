import { useCallback, useEffect, useState } from 'react';
import type { ApiCallLogItem, ApiCallLogSummary, ApiCallOutcome, ApiCallSource, ApiConnectionListItem } from '@chat-bot/shared-types';
import { useChatbotDetailContext } from '../ChatbotDetailLayout';
import { apiCallLogsApi } from '../../api/apiCallLogs';
import { apiConnectionsApi } from '../../api/apiConnections';
import { MESSAGES } from '../../constants/messages';
import { DateRangeField } from '../../components/DateRangeField';
import { SkeletonCard, SkeletonRow } from '../../components/Skeleton';
import { ErrorState } from '../../components/ErrorState';
import { EmptyState } from '../../components/EmptyState';
import { Pagination } from '../../components/Pagination';
import { MetricCard } from '../chatbot-detail/MetricCard';
import { formatDateTime, formatPercent } from '../../lib/date';
import { useLatestRequest } from '../../lib/useLatestRequest';
import { ApiCallOutcomeBadge } from '../settings/api-connections/badges';

const OUTCOMES: ApiCallOutcome[] = [
  'SUCCESS',
  'MAPPING_MISSING',
  'HTTP_ERROR',
  'TIMEOUT',
  'NETWORK_ERROR',
  'INVALID_RESPONSE',
  'RESPONSE_TOO_LARGE',
  'REDIRECT_NOT_ALLOWED',
  'BLOCKED_ADDRESS',
  'BLOCKED_URL',
  'CIRCUIT_OPEN',
  'RATE_LIMITED',
  'CONNECTION_DISABLED',
  'CONNECTION_MISSING',
  'METHOD_NOT_ALLOWED',
  'SECRET_MISSING',
  'BINDING_MISSING',
  'FEATURE_DISABLED',
  // [신규 No.45] 출구 허용 목록 밖 호스트 차단.
  'EGRESS_BLOCKED',
];

/** L1 — 외부 연동 로그(`StatsShell` 3번째 서브탭, `legacy-api-integration-ui-spec.md` §3.8). 메타데이터 전용(원문 0건). */
export function ApiCallLogPage(): JSX.Element {
  const { chatbot } = useChatbotDetailContext();
  const msg = MESSAGES.apiCallLogs;

  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [connectionId, setConnectionId] = useState('');
  const [connections, setConnections] = useState<ApiConnectionListItem[]>([]);
  const [outcome, setOutcome] = useState<ApiCallOutcome[]>([]);
  const [source, setSource] = useState<ApiCallSource[]>(['PUBLIC', 'SIMULATION_LIVE']);
  const [page, setPage] = useState(1);

  const [summary, setSummary] = useState<ApiCallLogSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryError, setSummaryError] = useState(false);
  const [rangeError, setRangeError] = useState<string | undefined>(undefined);

  const [items, setItems] = useState<ApiCallLogItem[]>([]);
  const [total, setTotal] = useState(0);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState(false);

  const summaryGuard = useLatestRequest();
  const listGuard = useLatestRequest();

  useEffect(() => {
    apiConnectionsApi
      .list()
      .then((res) => setConnections(res.items))
      .catch(() => undefined);
  }, []);

  const query = { from: from || undefined, to: to || undefined, connectionId: connectionId || undefined, outcome, source };

  const fetchSummary = useCallback(async () => {
    const reqId = summaryGuard.next();
    setSummaryLoading(true);
    setRangeError(undefined);
    try {
      const data = await apiCallLogsApi.summary(chatbot.id, query);
      if (summaryGuard.isStale(reqId)) return;
      setSummary(data);
      setSummaryError(false);
    } catch (e) {
      if (summaryGuard.isStale(reqId)) return;
      const message = e instanceof Error ? e.message : undefined;
      if (message?.includes('92')) {
        setRangeError(msg.rangeTooWide);
      } else {
        setSummaryError(true);
      }
    } finally {
      if (!summaryGuard.isStale(reqId)) setSummaryLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatbot.id, from, to, connectionId, outcome.join(','), source.join(','), summaryGuard]);

  const fetchList = useCallback(async () => {
    const reqId = listGuard.next();
    setListLoading(true);
    try {
      const res = await apiCallLogsApi.list(chatbot.id, { ...query, page, pageSize: 50 });
      if (listGuard.isStale(reqId)) return;
      setItems(res.items);
      setTotal(res.total);
      setListError(false);
    } catch {
      if (listGuard.isStale(reqId)) return;
      setListError(true);
    } finally {
      if (!listGuard.isStale(reqId)) setListLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatbot.id, from, to, connectionId, outcome.join(','), source.join(','), page, listGuard]);

  useEffect(() => {
    void fetchSummary();
  }, [fetchSummary]);
  useEffect(() => {
    void fetchList();
  }, [fetchList]);

  function toggleOutcome(o: ApiCallOutcome): void {
    setPage(1);
    setOutcome((prev) => (prev.includes(o) ? prev.filter((x) => x !== o) : [...prev, o]));
  }
  function toggleSource(s: ApiCallSource): void {
    setPage(1);
    setSource((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  }

  function branchLabel(item: ApiCallLogItem): string {
    if (item.branch === 'CONDITION') return msg.branchCondition(item.conditionIndex ?? 1);
    if (item.branch === 'DEFAULT') return msg.branchDefault;
    if (item.branch === 'FAILURE') return msg.branchFailure;
    if (item.branch === 'NOTICE') return msg.branchNotice;
    return '—';
  }

  const isEmpty = !listLoading && !listError && items.length === 0 && !summaryLoading && summary?.total === 0;

  return (
    <div className="api-call-log-page">
      <h1 className="sr-only">{msg.pageTitle}</h1>
      <div className="dialogue-filter-bar">
        <DateRangeField
          from={from}
          to={to}
          onChange={(f, t) => {
            setFrom(f);
            setTo(t);
            setPage(1);
          }}
          maxRangeDays={92}
          errorMessage={rangeError}
        />
        <div className="form-field">
          <label htmlFor="api-call-log-connection">{msg.filterConnectionLabel}</label>
          <select
            id="api-call-log-connection"
            value={connectionId}
            onChange={(e) => {
              setConnectionId(e.target.value);
              setPage(1);
            }}
          >
            <option value="">{msg.filterConnectionAll}</option>
            {connections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <fieldset className="form-field">
          <legend>{msg.filterSourceLabel}</legend>
          {(['PUBLIC', 'SIMULATION_LIVE', 'CONNECTION_TEST'] as ApiCallSource[]).map((s) => (
            <label key={s} className="form-field--inline">
              <input type="checkbox" checked={source.includes(s)} onChange={() => toggleSource(s)} />
              {s}
            </label>
          ))}
        </fieldset>
        <fieldset className="form-field">
          <legend>{msg.filterOutcomeLabel}</legend>
          {OUTCOMES.map((o) => (
            <label key={o} className="form-field--inline">
              <input type="checkbox" checked={outcome.length === 0 || outcome.includes(o)} onChange={() => toggleOutcome(o)} />
              {msg.outcomeLabel[o]}
            </label>
          ))}
        </fieldset>
      </div>

      {summaryLoading ? (
        <div className="dashboard-cards">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : summaryError ? (
        <ErrorState title={MESSAGES.stats.errorTitle} onRetry={fetchSummary} />
      ) : summary ? (
        <>
          <div className="dashboard-cards stats-metric-row">
            <MetricCard label={msg.summaryTotalCalls} value={String(summary.total)} caption="" />
            <MetricCard label={msg.summarySuccessRate} value={formatPercent(summary.successRate)} caption="" />
            <MetricCard label={msg.summaryTimeouts} value={String(summary.byOutcome.TIMEOUT ?? 0)} caption="" />
            <MetricCard label={msg.summaryCircuitOpen} value={String(summary.byOutcome.CIRCUIT_OPEN ?? 0)} caption="" />
            <MetricCard label={msg.summaryP95} value={`${summary.p95LatencyMs}ms`} caption="" />
          </div>
          <div className="api-call-outcome-distribution">
            <p className="field-label-static">{msg.outcomeDistributionTitle}</p>
            <ul>
              {OUTCOMES.filter((o) => (summary.byOutcome[o] ?? 0) > 0).map((o) => (
                <li key={o}>
                  {msg.outcomeLabel[o]} {summary.byOutcome[o]}
                </li>
              ))}
            </ul>
          </div>
        </>
      ) : null}

      {isEmpty && <EmptyState title={msg.emptyTitle} />}

      {!isEmpty && (
        <div className="dialogue-table-wrap">
          {listLoading && (
            <>
              <SkeletonRow />
              <SkeletonRow />
              <SkeletonRow />
            </>
          )}
          {!listLoading && listError && <ErrorState title={MESSAGES.stats.errorTitle} onRetry={fetchList} />}
          {!listLoading && !listError && items.length === 0 && <EmptyState title={msg.emptyTitle} />}
          {!listLoading && !listError && items.length > 0 && (
            <>
              <table className="dialogue-table">
                <caption className="sr-only">{`${msg.pageTitle} — 총 ${total}건`}</caption>
                <thead>
                  <tr>
                    <th scope="col">{msg.columnTime}</th>
                    <th scope="col">{msg.columnConnection}</th>
                    <th scope="col">{msg.columnMethod}</th>
                    <th scope="col">{msg.columnPath}</th>
                    <th scope="col">{msg.columnStatus}</th>
                    <th scope="col">{msg.columnLatency}</th>
                    <th scope="col">{msg.columnOutcome}</th>
                    <th scope="col">{msg.columnBranch}</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id}>
                      <td>{formatDateTime(item.createdAt)}</td>
                      <td>{item.connectionName}</td>
                      <td>{item.method}</td>
                      <td>{item.pathTemplate}</td>
                      <td>{item.httpStatus ?? '—'}</td>
                      <td>{item.latencyMs}ms</td>
                      <td>
                        <ApiCallOutcomeBadge outcome={item.outcome} />
                      </td>
                      <td>{branchLabel(item)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Pagination page={page} pageSize={50} total={total} onPageChange={setPage} />
            </>
          )}
        </div>
      )}
    </div>
  );
}
