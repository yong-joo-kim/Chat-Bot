import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { UtteranceAnalysisListItem, UtteranceAnalysisStatus } from '@chat-bot/shared-types';
import { useChatbotDetailContext } from '../../ChatbotDetailLayout';
import { useAuth } from '../../../context/AuthContext';
import { ApiError } from '../../../api/client';
import { utteranceAnalysesApi } from '../../../api/utteranceAnalyses';
import { MESSAGES } from '../../../constants/messages';
import { formatDateTime } from '../../../lib/date';
import { useLatestRequest } from '../../../lib/useLatestRequest';
import { useToast } from '../../../components/Toast';
import { EmptyState } from '../../../components/EmptyState';
import { ErrorState } from '../../../components/ErrorState';
import { Pagination } from '../../../components/Pagination';
import { SkeletonRow } from '../../../components/Skeleton';
import { MultiSelectDropdown } from '../../../components/MultiSelectDropdown';
import { ArchivedBanner } from '../ArchivedBanner';
import { AnalysisStatusText } from './AnalysisStatusText';
import { ClusterHelp } from './ClusterHelp';
import { DeleteAnalysisDialog, type DeleteAnalysisTarget } from './DeleteAnalysisDialog';
import { RetentionExpiryText } from './RetentionExpiryText';
import { TemplateDownloadButtons } from './TemplateDownloadButtons';
import { UtteranceAnalysisFeatureOffState } from './UtteranceAnalysisFeatureOffState';
import { computeNewAnalysisBlock } from './newAnalysisBlock';
import { usePolling } from './usePolling';
import { useUtteranceCapability } from './useUtteranceCapability';

const PAGE_SIZE = 20;
const IN_FLIGHT: UtteranceAnalysisStatus[] = ['QUEUED', 'RUNNING'];
type FilterKey = 'PROCESSING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';

function statusesOf(filter: FilterKey[]): UtteranceAnalysisStatus[] {
  return filter.flatMap((f): UtteranceAnalysisStatus[] => (f === 'PROCESSING' ? ['QUEUED', 'RUNNING'] : [f]));
}

/** UA-1 — 분석 목록(`deep-clustering-ui-spec.md` §3). 통계 서브내비 4번째 항목의 본문. */
export function UtteranceAnalysisListPage(): JSX.Element {
  const { chatbot } = useChatbotDetailContext();
  const { can } = useAuth();
  const { showToast } = useToast();
  const msg = MESSAGES.utteranceAnalysis;
  const archived = chatbot.status === 'ARCHIVED';
  const canWrite = can('dialogue:write') && !archived;
  const base = `/chatbots/${chatbot.id}/stats/utterance-analyses`;

  const { state: capState, refresh: refreshCap } = useUtteranceCapability(chatbot.id);
  const [filter, setFilter] = useState<FilterKey[]>([]);
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<UtteranceAnalysisListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [listNotFound, setListNotFound] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DeleteAnalysisTarget | null>(null);
  const [now] = useState(() => new Date());
  const guard = useLatestRequest();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const captionRef = useRef<HTMLTableCaptionElement>(null);

  const statuses = useMemo(() => statusesOf(filter), [filter]);
  const statusKey = statuses.join(',');

  /** 목록 조회. `throwOnError`는 폴링용(연속 실패를 세기 위해). */
  const fetchList = useCallback(
    async (throwOnError: boolean): Promise<void> => {
      const reqId = guard.next();
      try {
        const res = await utteranceAnalysesApi.list(chatbot.id, { page, pageSize: PAGE_SIZE, status: statusKey ? statusKey.split(',') : undefined });
        if (guard.isStale(reqId)) return;
        setItems(res.items);
        setTotal(res.total);
        setError(false);
        setListNotFound(false);
      } catch (e) {
        if (guard.isStale(reqId)) return;
        if (e instanceof ApiError && e.status === 404) setListNotFound(true);
        else if (!throwOnError) setError(true);
        if (throwOnError) throw e;
      } finally {
        if (!guard.isStale(reqId)) setLoading(false);
      }
    },
    [chatbot.id, page, statusKey, guard],
  );

  useEffect(() => {
    setLoading(true);
    void fetchList(false);
  }, [fetchList]);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const inFlightRow = items.find((i) => IN_FLIGHT.includes(i.status));
  const { degraded } = usePolling(
    async () => {
      await fetchList(true);
      void refreshCap();
    },
    { enabled: Boolean(inFlightRow), intervalMs: 5000 },
  );

  // 마지막 행을 지운 뒤 빈 페이지가 남으면 앞 페이지로 물러난다.
  useEffect(() => {
    if (!loading && items.length === 0 && page > 1) setPage((p) => p - 1);
  }, [loading, items.length, page]);

  const cap = capState.status === 'ready' ? capState.data : null;
  const block = computeNewAnalysisBlock(cap);
  const featureOff = capState.status === 'off' || listNotFound;

  function handleDeleted(id: string): void {
    setDeleteTarget(null);
    setItems((prev) => prev.filter((i) => i.id !== id));
    setTotal((t) => Math.max(0, t - 1));
    showToast(msg.deleteSuccess);
    void refreshCap();
    window.setTimeout(() => captionRef.current?.focus(), 0);
  }

  if (featureOff) {
    return (
      <div className="ua-page">
        <UtteranceAnalysisFeatureOffState chatbotId={chatbot.id} />
      </div>
    );
  }

  const newButton =
    block === null ? (
      <Link to={`${base}/new`} className="btn btn-primary">
        {msg.newAnalysis}
      </Link>
    ) : (
      <button type="button" className="btn btn-primary" aria-disabled="true" aria-describedby="ua-new-block-reason" onClick={(e) => e.preventDefault()}>
        {msg.newAnalysis}
      </button>
    );

  const filterOptions = (Object.keys(msg.statusFilterOptions) as FilterKey[]).map((value) => ({ value, label: msg.statusFilterOptions[value] }));
  const isFiltered = filter.length > 0;

  let body: JSX.Element;
  if (loading) {
    body = (
      <div aria-busy="true">
        <p className="sr-only" role="status">
          {msg.loadingList}
        </p>
        {Array.from({ length: 5 }, (_, i) => (
          <SkeletonRow key={i} />
        ))}
      </div>
    );
  } else if (error) {
    body = <ErrorState title={msg.listLoadFailed} onRetry={() => { setLoading(true); void fetchList(false); }} />;
  } else if (items.length === 0 && isFiltered) {
    body = (
      <EmptyState
        title={msg.emptyFiltered}
        action={
          <button type="button" className="btn btn-secondary" onClick={() => { setFilter([]); setPage(1); }}>
            {msg.clearFilter}
          </button>
        }
      />
    );
  } else if (items.length === 0 && canWrite) {
    body = (
      <div className="empty-state">
        <p className="empty-state-title">
          <span aria-hidden="true">ⓘ</span> {msg.emptyTitle}
        </p>
        <p className="empty-state-desc">{msg.emptyStepsTitle}</p>
        <ol className="ua-empty-steps">
          {msg.emptySteps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
        <div className="empty-state-action">
          <TemplateDownloadButtons chatbotId={chatbot.id} />
          {block === null ? (
            <Link to={`${base}/new`} className="btn btn-primary">
              {msg.emptyStartNew}
            </Link>
          ) : null}
        </div>
      </div>
    );
  } else if (items.length === 0) {
    body = <EmptyState title={msg.emptyReadOnly} />;
  } else {
    body = (
      <>
        <table className="dialogue-table ua-table">
          <caption className="sr-only" tabIndex={-1} ref={captionRef}>
            {msg.listCaption}
          </caption>
          <thead>
            <tr>
              <th scope="col">{msg.columnRequestedAt}</th>
              <th scope="col">{msg.columnRequester}</th>
              <th scope="col">{msg.columnFileName}</th>
              <th scope="col">{msg.columnStatus}</th>
              <th scope="col">{msg.columnUtterances}</th>
              <th scope="col">{msg.columnClusters}</th>
              <th scope="col">{msg.columnCandidates}</th>
              <th scope="col">{msg.columnApplied}</th>
              <th scope="col">{msg.columnExpires}</th>
              <th scope="col">{msg.columnActions}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => {
              const done = it.status === 'SUCCEEDED';
              const terminal = it.status === 'SUCCEEDED' || it.status === 'FAILED' || it.status === 'CANCELLED';
              const num = (v: number | null): string => (done && v !== null ? v.toLocaleString('ko-KR') : msg.noneDash);
              return (
                <tr key={it.id}>
                  <td data-label={msg.columnRequestedAt}>{formatDateTime(it.createdAt)}</td>
                  <td data-label={msg.columnRequester}>{it.requestedByEmail ?? msg.noneDash}</td>
                  <th scope="row" data-label={msg.columnFileName} className="ua-file-name">
                    {it.fileName}
                  </th>
                  <td data-label={msg.columnStatus}>
                    <AnalysisStatusText status={it.status} stage={it.stage} progress={it.progress} failureReason={it.failureReason} />
                  </td>
                  <td data-label={msg.columnUtterances}>{num(it.validCount)}</td>
                  <td data-label={msg.columnClusters}>{num(it.clusterCount)}</td>
                  <td data-label={msg.columnCandidates}>{num(it.candidateCount)}</td>
                  <td data-label={msg.columnApplied}>{num(it.appliedCount)}</td>
                  <td data-label={msg.columnExpires}>
                    <RetentionExpiryText expiresAt={it.expiresAt} now={now} />
                  </td>
                  <td data-label={msg.columnActions} className="ua-actions">
                    <Link to={`${base}/${it.id}`} className="btn btn-secondary" aria-label={msg.viewResultLabel(it.fileName)}>
                      {msg.viewResult}
                    </Link>
                    {canWrite && terminal && (
                      <button
                        type="button"
                        className="btn btn-secondary"
                        aria-label={msg.deleteActionLabel(it.fileName)}
                        onClick={() => setDeleteTarget({ id: it.id, fileName: it.fileName })}
                      >
                        {msg.deleteAction}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />
      </>
    );
  }

  return (
    <div className="ua-page">
      <ArchivedBanner visible={archived} />
      <div className="ua-page-header">
        <h2 tabIndex={-1} ref={headingRef}>
          {msg.pageTitle}
        </h2>
        {cap && <p className="ua-stored-count">{msg.storedCount(cap.stored.count, cap.stored.max)}</p>}
      </div>
      <p>{msg.pageDesc}</p>
      <ClusterHelp />
      <div className="ua-actions-row">
        {canWrite && newButton}
        <TemplateDownloadButtons chatbotId={chatbot.id} />
      </div>
      {canWrite && block && (
        <p id="ua-new-block-reason" className="form-banner form-banner--info">
          {block.message}
          {block.kind === 'BUSY_CHATBOT' && inFlightRow && (
            <>
              {' '}
              <Link to={`${base}/${inFlightRow.id}`}>{msg.busyChatbotLink}</Link>
            </>
          )}
        </p>
      )}
      {canWrite && <p className="field-hint">{msg.oneAtATime}</p>}
      {degraded && (
        <p className="form-banner form-banner--warning" role="status">
          {msg.connectionDegraded}
        </p>
      )}
      <div className="ua-filter-row">
        <MultiSelectDropdown label={msg.statusFilterLabel} options={filterOptions} selected={filter} allLabel={msg.statusFilterAll} onChange={(v) => { setFilter(v); setPage(1); }} />
      </div>
      {body}
      <DeleteAnalysisDialog
        chatbotId={chatbot.id}
        target={deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onDeleted={handleDeleted}
        onGone={() => void fetchList(false)}
      />
    </div>
  );
}
