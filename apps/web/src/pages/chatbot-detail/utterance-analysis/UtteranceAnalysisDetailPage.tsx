import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { UTTERANCE_ANALYSIS_LIMITS, type AnalyzedUtterance, type UtteranceAnalysisDetail, type UtteranceCluster } from '@chat-bot/shared-types';
import { useChatbotDetailContext } from '../../ChatbotDetailLayout';
import { useAuth } from '../../../context/AuthContext';
import { ApiError } from '../../../api/client';
import { utteranceAnalysesApi } from '../../../api/utteranceAnalyses';
import { MESSAGES } from '../../../constants/messages';
import { formatDateTime, toKstDateInputValue } from '../../../lib/date';
import { useDebouncedValue } from '../../../lib/useDebouncedValue';
import { useLatestRequest } from '../../../lib/useLatestRequest';
import { ConfirmDialog } from '../../../components/Modal';
import { EmptyState } from '../../../components/EmptyState';
import { ErrorState } from '../../../components/ErrorState';
import { GovernanceViewAuditBanner } from '../../../components/GovernanceViewAuditBanner';
import { Pagination } from '../../../components/Pagination';
import { ProposalContainer } from '../../../components/ProposalContainer';
import { SkeletonCard, SkeletonRow } from '../../../components/Skeleton';
import { useToast } from '../../../components/Toast';
import { useAnnouncedTransition } from '../../settings/kb-crawling/useAnnouncedTransition';
import { ArchivedBanner } from '../ArchivedBanner';
import { AnalysisNoticeList } from './AnalysisNoticeList';
import { AnalysisProgressSteps } from './AnalysisProgressSteps';
import { AnalysisStatusText, failureReasonText } from './AnalysisStatusText';
import { ApplyToIntentDialog, type ApplyDialogCloseInfo } from './ApplyToIntentDialog';
import { ClusterHelp } from './ClusterHelp';
import { ClusterTable } from './ClusterTable';
import { DeleteAnalysisDialog } from './DeleteAnalysisDialog';
import { RetentionExpiryText } from './RetentionExpiryText';
import { UploadPreviewTable } from './UploadPreviewTable';
import { UtteranceFilterBar, type UtteranceFilterValue } from './UtteranceFilterBar';
import { UtteranceTable } from './UtteranceTable';
import { usePolling } from './usePolling';
import { saveBlob } from './saveBlob';

const UTTERANCE_PAGE_SIZE = 50;
type LoadState = 'loading' | 'ready' | 'notFound' | 'error';

/** 분석 취소 확인(UA-3b). 기본 포커스는 "계속 진행"(=취소 버튼 자리)이다. */
function CancelAnalysisDialog({
  chatbotId,
  analysisId,
  isOpen,
  onClose,
  onDone,
  onGone,
}: {
  chatbotId: string;
  analysisId: string;
  isOpen: boolean;
  onClose: () => void;
  /** 성공(204) 또는 409(이미 끝남) — 상세를 다시 읽는다. */
  onDone: () => void;
  onGone: () => void;
}): JSX.Element | null {
  const msg = MESSAGES.utteranceAnalysis;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const handleCancel = useCallback((): void => {
    if (!busyRef.current) onCloseRef.current();
  }, []);

  useEffect(() => {
    if (isOpen) setError(null);
  }, [isOpen]);

  async function handleConfirm(): Promise<void> {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      await utteranceAnalysesApi.cancel(chatbotId, analysisId);
      onCloseRef.current();
      onDone();
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        onGone();
      } else if (e instanceof ApiError && e.status === 409) {
        setError(e.code === 'CHATBOT_ARCHIVED' ? msg.errors.CHATBOT_ARCHIVED : msg.cancelInvalidStatus);
        onDone();
      } else {
        setError(msg.genericError);
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <ConfirmDialog
      isOpen={isOpen}
      title={msg.cancelConfirmTitle}
      description={msg.cancelConfirmDesc}
      confirmLabel={busy ? msg.cancelInProgress : msg.cancelAction}
      cancelLabel={msg.cancelKeepRunning}
      danger
      confirmDisabled={busy}
      onConfirm={() => void handleConfirm()}
      onCancel={handleCancel}
    >
      {error && (
        <p className="field-error" role="alert">
          <span aria-hidden="true">⚠</span> {error}
        </p>
      )}
    </ConfirmDialog>
  );
}

function formatTransition(prev: string, next: string): string {
  const msg = MESSAGES.utteranceAnalysis;
  if (next === 'SUCCEEDED') return msg.announceSucceeded;
  if (next === 'FAILED') return msg.announceFailed;
  if (next === 'CANCELLED') return msg.announceCancelled;
  const names = msg.announceStep as Record<string, string>;
  return msg.announceTransition(names[prev] ?? prev, names[next] ?? next);
}

/** UA-3 — 결과 상세(`deep-clustering-ui-spec.md` §5). 상태에 따라 진행·오류·취소·완료 본문으로 갈린다. */
function DetailPageBody(): JSX.Element {
  const { chatbot } = useChatbotDetailContext();
  const { analysisId = '' } = useParams<{ analysisId: string }>();
  const { can, user } = useAuth();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const msg = MESSAGES.utteranceAnalysis;
  const base = `/chatbots/${chatbot.id}/stats/utterance-analyses`;
  const archived = chatbot.status === 'ARCHIVED';
  const canWrite = can('dialogue:write') && !archived;

  const [detail, setDetail] = useState<UtteranceAnalysisDetail | null>(null);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [now] = useState(() => new Date());
  const detailGuard = useLatestRequest();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const focusedRef = useRef(false);

  const [cancelOpen, setCancelOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [applyOpen, setApplyOpen] = useState(false);

  const fetchDetail = useCallback(
    async (throwOnError: boolean): Promise<void> => {
      const reqId = detailGuard.next();
      try {
        const res = await utteranceAnalysesApi.get(chatbot.id, analysisId);
        if (detailGuard.isStale(reqId)) return;
        setDetail(res);
        setLoadState('ready');
      } catch (e) {
        if (detailGuard.isStale(reqId)) return;
        if (e instanceof ApiError && e.status === 404) {
          setLoadState('notFound');
          return;
        }
        if (throwOnError) throw e;
        setLoadState((prev) => (prev === 'ready' ? prev : 'error'));
      }
    },
    [chatbot.id, analysisId, detailGuard],
  );

  useEffect(() => {
    setLoadState('loading');
    setDetail(null);
    focusedRef.current = false;
    void fetchDetail(false);
  }, [fetchDetail]);

  // 처음 화면이 그려질 때 한 번만 제목으로 포커스를 옮긴다(폴링 갱신 때마다 뺏지 않는다).
  useEffect(() => {
    if (loadState === 'ready' && !focusedRef.current) {
      focusedRef.current = true;
      headingRef.current?.focus();
    }
  }, [loadState]);

  const inFlight = detail !== null && (detail.status === 'QUEUED' || detail.status === 'RUNNING');
  const { degraded } = usePolling(() => fetchDetail(true), { enabled: loadState === 'ready' && inFlight, intervalMs: 2000 });

  // 상태·단계 단어가 바뀔 때만 1회 낭독한다(진행률 숫자는 낭독하지 않는다).
  const announceKey = detail ? (detail.status === 'RUNNING' ? (detail.stage ?? 'QUEUED') : detail.status) : '';
  const announced = useAnnouncedTransition(announceKey, formatTransition);

  /* ── 발화 표 ── */
  const [searchParams, setSearchParams] = useSearchParams();
  const filter: UtteranceFilterValue = {
    cluster: searchParams.get('cluster') ?? '',
    candidate: searchParams.get('candidate') === 'true',
    unapplied: searchParams.get('unapplied') === 'true',
    q: searchParams.get('q') ?? '',
  };
  const page = Math.max(1, Number(searchParams.get('page')) || 1);
  const succeeded = detail?.status === 'SUCCEEDED';
  const probeDone = detail?.probe.status === 'DONE';

  function updateParams(patch: Partial<UtteranceFilterValue>, nextPage = 1): void {
    const next = new URLSearchParams(searchParams);
    const merged = { ...filter, ...patch };
    const set = (k: string, v: string | null): void => {
      if (v) next.set(k, v);
      else next.delete(k);
    };
    set('cluster', merged.cluster || null);
    set('candidate', merged.candidate ? 'true' : null);
    set('unapplied', merged.unapplied ? 'true' : null);
    set('q', merged.q || null);
    set('page', nextPage > 1 ? String(nextPage) : null);
    setSearchParams(next, { replace: true });
  }

  const [items, setItems] = useState<AnalyzedUtterance[]>([]);
  const [total, setTotal] = useState(0);
  const [uttLoading, setUttLoading] = useState(true);
  const [uttError, setUttError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const uttGuard = useLatestRequest();
  const utterancesHeadingRef = useRef<HTMLHeadingElement>(null);

  const { cluster: fCluster, candidate: fCandidate, unapplied: fUnapplied, q: fQ } = filter;
  useEffect(() => {
    if (!succeeded) return;
    const reqId = uttGuard.next();
    setUttLoading(true);
    setUttError(false);
    utteranceAnalysesApi
      .listUtterances(chatbot.id, analysisId, {
        clusterId: fCluster || undefined,
        candidateOnly: fCandidate,
        unappliedOnly: fUnapplied,
        q: fQ || undefined,
        page,
        pageSize: UTTERANCE_PAGE_SIZE,
      })
      .then((res) => {
        if (uttGuard.isStale(reqId)) return;
        setItems(res.items);
        setTotal(res.total);
      })
      .catch(() => {
        if (!uttGuard.isStale(reqId)) setUttError(true);
      })
      .finally(() => {
        if (!uttGuard.isStale(reqId)) setUttLoading(false);
      });
  }, [succeeded, chatbot.id, analysisId, fCluster, fCandidate, fUnapplied, fQ, page, reloadKey, uttGuard]);

  /* ── 선택(최대 50, 페이지·필터가 바뀌어도 유지) ── */
  const [selected, setSelected] = useState<Map<string, string>>(new Map());
  const maxSelect = UTTERANCE_ANALYSIS_LIMITS.applyMaxUtterances;
  const debouncedSelectedCount = useDebouncedValue(selected.size, 500);

  const toggle = useCallback(
    (u: AnalyzedUtterance): void => {
      setSelected((prev) => {
        const next = new Map(prev);
        if (next.has(u.id)) next.delete(u.id);
        else if (next.size < maxSelect) next.set(u.id, u.text);
        return next;
      });
    },
    [maxSelect],
  );

  const togglePage = useCallback(
    (selectable: AnalyzedUtterance[], selectAll: boolean): void => {
      setSelected((prev) => {
        const next = new Map(prev);
        if (!selectAll) {
          selectable.forEach((u) => next.delete(u.id));
          return next;
        }
        for (const u of selectable) {
          if (next.size >= maxSelect) break;
          next.set(u.id, u.text);
        }
        return next;
      });
    },
    [maxSelect],
  );

  /* ── 동작 ── */
  async function handleExport(): Promise<void> {
    if (exporting) return;
    setExporting(true);
    setExportError(null);
    try {
      const file = await utteranceAnalysesApi.exportXlsx(chatbot.id, analysisId);
      saveBlob(file.blob, file.filename);
      showToast(msg.exportDone);
    } catch (e) {
      setExportError(e instanceof ApiError && e.status === 409 ? msg.errors.EXPORT_INVALID_STATUS : msg.exportFailed);
    } finally {
      setExporting(false);
    }
  }

  function handleRenamed(updated: UtteranceCluster): void {
    setDetail((d) => (d ? { ...d, clusters: d.clusters.map((c) => (c.id === updated.id ? updated : c)) } : d));
    setItems((prev) => prev.map((u) => (u.clusterId === updated.id ? { ...u, clusterDisplayName: updated.displayName } : u)));
  }

  function handleShowUtterances(clusterId: string): void {
    updateParams({ cluster: clusterId });
    window.setTimeout(() => {
      utterancesHeadingRef.current?.scrollIntoView?.({ block: 'start' });
      utterancesHeadingRef.current?.focus();
    }, 0);
  }

  function handleApplyClose(info?: ApplyDialogCloseInfo): void {
    setApplyOpen(false);
    if (info?.removeIds) {
      const remove = new Set(info.removeIds);
      setSelected((prev) => new Map([...prev].filter(([id]) => !remove.has(id))));
    }
    if (info?.reload) {
      void fetchDetail(false);
      setReloadKey((k) => k + 1);
    }
  }

  const clusters = detail?.clusters ?? [];
  const nonUnassigned = clusters.filter((c) => !c.unassigned).length;

  /* ── 렌더 ── */
  if (loadState === 'loading') {
    return (
      <div className="ua-page" aria-busy="true">
        <p className="sr-only" role="status">
          {msg.detailLoading}
        </p>
        <SkeletonCard />
        <SkeletonRow />
      </div>
    );
  }
  if (loadState === 'notFound') {
    return (
      <div className="ua-page">
        <EmptyState
          title={msg.notFoundTitle}
          action={
            <Link to={base} className="btn btn-secondary">
              {msg.backToList}
            </Link>
          }
        />
      </div>
    );
  }
  if (loadState === 'error' || !detail) {
    return (
      <div className="ua-page">
        <ErrorState
          title={msg.detailLoadFailed}
          onRetry={() => {
            setLoadState('loading');
            void fetchDetail(false);
          }}
        />
      </div>
    );
  }

  const terminal = detail.status === 'SUCCEEDED' || detail.status === 'FAILED' || detail.status === 'CANCELLED';
  const elapsedMinutes = detail.startedAt ? Math.floor((Date.now() - new Date(detail.startedAt).getTime()) / 60000) : 0;
  const isFiltered = Boolean(fCluster || fCandidate || fUnapplied || fQ);
  const selectionText = debouncedSelectedCount === 0 ? msg.selectionNone : msg.selectionCount(debouncedSelectedCount, maxSelect);
  const unassignedCount = detail.unassignedCount ?? clusters.find((c) => c.unassigned)?.utteranceCount ?? 0;

  const probeTargetText =
    detail.probe.targetKind === 'PROD'
      ? msg.probeTargetServingV(detail.probe.versionNo)
      : detail.conditions.probe.target === 'DRAFT'
        ? msg.probeTargetDraftV
        : msg.probeTargetCurrent;

  return (
    <div className="ua-page">
      <ArchivedBanner visible={archived} />
      <nav aria-label={msg.pageTitle} className="ua-breadcrumb">
        <Link to={base}>{msg.pageTitle}</Link> <span aria-hidden="true">&gt;</span> <span aria-current="page">{detail.fileName}</span>
      </nav>

      <div className="ua-detail-header">
        <h2 tabIndex={-1} ref={headingRef}>
          {detail.fileName}
        </h2>
        <div className="ua-header-status">
          <AnalysisStatusText status={detail.status} stage={detail.stage} progress={detail.progress} />
        </div>
        <dl className="ua-header-meta">
          <div>
            <dt>{msg.headerRequester}</dt>
            <dd>{detail.requestedByEmail ?? msg.noneDash}</dd>
          </div>
          <div>
            <dt>{msg.headerRequestedAt}</dt>
            <dd>{formatDateTime(detail.createdAt)}</dd>
          </div>
          {detail.durationMs !== null && (
            <div>
              <dt>{msg.headerDuration}</dt>
              <dd>{msg.durationText(detail.durationMs)}</dd>
            </div>
          )}
          <div>
            <dt>{msg.columnExpires}</dt>
            <dd>
              <RetentionExpiryText expiresAt={detail.expiresAt} now={now} />
            </dd>
          </div>
        </dl>
        <div className="ua-header-actions">
          {succeeded && (
            <>
              <button type="button" className="btn btn-primary" onClick={() => void handleExport()} disabled={exporting}>
                {exporting ? msg.exporting : msg.exportExcel}
              </button>
              <span className="field-hint">{msg.governanceExport}</span>
            </>
          )}
          {canWrite && inFlight && (
            <button type="button" className="btn btn-secondary" onClick={() => setCancelOpen(true)}>
              {msg.cancelAction}
            </button>
          )}
          {canWrite && terminal && (
            <button type="button" className="btn btn-secondary" onClick={() => setDeleteOpen(true)}>
              {msg.deleteAction}
            </button>
          )}
        </div>
        {exportError && (
          <p className="field-error" role="alert">
            <span aria-hidden="true">⚠</span> {exportError}
          </p>
        )}
      </div>

      {/* 단계·상태 전환 낭독 영역(화면당 3개 중 ①) */}
      <p role="status" className="sr-only">
        {announced}
      </p>
      {degraded && (
        <p className="form-banner form-banner--warning" role="status">
          {msg.connectionDegraded}
        </p>
      )}

      {inFlight && (
        <section className="settings-card" aria-labelledby="ua-running-title">
          <h3 id="ua-running-title">{msg.runningTitle}</h3>
          <p>{msg.runningKeepGoing}</p>
          <AnalysisProgressSteps status={detail.status} stage={detail.stage} progress={detail.progress} conditions={detail.conditions} />
          {detail.startedAt && <p className="field-hint">{msg.elapsedText(Math.max(0, elapsedMinutes))}</p>}
          <p className="field-hint">{msg.oneAtATimeLong}</p>
          {canWrite && (
            <button type="button" className="btn btn-secondary" onClick={() => setCancelOpen(true)}>
              {msg.cancelAction}
            </button>
          )}
        </section>
      )}

      {detail.status === 'CANCELLED' && (
        <section className="settings-card">
          <p className="form-banner form-banner--info">
            <span aria-hidden="true">ⓘ</span> {msg.cancelledCard}
          </p>
          {canWrite && (
            <Link to={`${base}/new`} className="btn btn-primary">
              {msg.emptyStartNew}
            </Link>
          )}
        </section>
      )}

      {detail.status === 'FAILED' && (
        <section className="settings-card">
          <div className="form-banner form-banner--error">
            <p>
              <span aria-hidden="true">✖</span> <strong>{msg.failedCardTitle}</strong>
            </p>
            <p>{failureReasonText(detail.failureReason)}</p>
          </div>
          <p>{msg.failedNoResult}</p>
          {canWrite && (
            <Link to={`${base}/new`} className="btn btn-primary">
              {msg.emptyStartNew}
            </Link>
          )}
        </section>
      )}

      {succeeded && (
        <>
          <dl className="ua-summary" aria-label={msg.summaryLabel}>
            <div>
              <dt>{msg.summaryValid}</dt>
              <dd>{msg.summaryUnit(detail.counts.validCount)}</dd>
            </div>
            <div>
              <dt>{msg.summaryClusters}</dt>
              <dd>{msg.summaryUnit(nonUnassigned)}</dd>
            </div>
            <div>
              <dt>{msg.summaryUnassigned}</dt>
              <dd>{msg.summaryUnit(unassignedCount)}</dd>
            </div>
            {probeDone && (
              <div>
                <dt>{msg.summaryCandidates}</dt>
                <dd>{msg.summaryUnit(detail.candidateCount ?? 0)}</dd>
              </div>
            )}
            <div>
              <dt>{msg.summaryApplied}</dt>
              <dd>{msg.summaryUnit(detail.appliedCount)}</dd>
            </div>
          </dl>

          <p className="form-banner form-banner--info">{msg.maskNotice}</p>
          <p className="form-banner form-banner--info">{msg.notIntentNotice}</p>
          <GovernanceViewAuditBanner visible={user?.governanceModeOn ?? false} />
          <p className="field-hint">{msg.retentionNotice(toKstDateInputValue(detail.expiresAt))}</p>
          <ClusterHelp />
          <AnalysisNoticeList detail={detail} canWrite={canWrite} newAnalysisPath={`${base}/new`} />

          <details className="ua-info">
            <summary>{msg.infoToggle}</summary>
            <table className="dialogue-table">
              <caption className="sr-only">{msg.infoCaption}</caption>
              <tbody>
                <tr>
                  <th scope="row">{msg.infoRows.targetClusterCount}</th>
                  <td>{detail.conditions.targetClusterCount}</td>
                </tr>
                <tr>
                  <th scope="row">{msg.infoRows.minClusterSize}</th>
                  <td>{detail.conditions.minClusterSize}</td>
                </tr>
                <tr>
                  <th scope="row">{msg.infoRows.keywordCount}</th>
                  <td>{detail.conditions.keywordCount}</td>
                </tr>
                <tr>
                  <th scope="row">{msg.infoRows.nounsOnly}</th>
                  <td>{detail.conditions.nounsOnly ? msg.yes : msg.no}</td>
                </tr>
                <tr>
                  <th scope="row">{msg.infoRows.probe}</th>
                  <td>{detail.conditions.probe.enabled ? msg.on : msg.off}</td>
                </tr>
                {detail.conditions.probe.enabled && (
                  <>
                    <tr>
                      <th scope="row">{msg.infoRows.probeTarget}</th>
                      <td>{probeTargetText}</td>
                    </tr>
                    <tr>
                      <th scope="row">{msg.infoRows.probeThreshold}</th>
                      <td>{detail.probe.threshold !== null ? Math.round(detail.probe.threshold * 100) : msg.thresholdFollow}</td>
                    </tr>
                  </>
                )}
                <tr>
                  <th scope="row">{msg.infoRows.model}</th>
                  <td>{detail.embeddingModelId ?? msg.noneDash}</td>
                </tr>
                <tr>
                  <th scope="row">{msg.infoRows.startedAt}</th>
                  <td>{detail.startedAt ? formatDateTime(detail.startedAt) : msg.noneDash}</td>
                </tr>
                <tr>
                  <th scope="row">{msg.infoRows.duration}</th>
                  <td>{detail.durationMs !== null ? msg.durationText(detail.durationMs) : msg.noneDash}</td>
                </tr>
                <tr>
                  <th scope="row">{msg.infoRows.fileKind}</th>
                  <td>{msg.fileKindLabel[detail.fileKind]}</td>
                </tr>
              </tbody>
            </table>
            <UploadPreviewTable counts={detail.counts} caption={msg.previewCaption(detail.counts.validCount)} />
          </details>

          <h3>{msg.clusterCaption}</h3>
          <ClusterTable
            chatbotId={chatbot.id}
            analysisId={analysisId}
            clusters={clusters}
            canWrite={canWrite}
            probeDone={probeDone}
            showAiSuggestions={detail.nameSuggest.status !== 'OFF'}
            onRenamed={handleRenamed}
            onShowUtterances={handleShowUtterances}
          />

          <ProposalContainer title={msg.proposalTitle} safetyNotice={msg.proposalSafety}>
            <h3 tabIndex={-1} ref={utterancesHeadingRef}>
              {msg.utterancesHeading}
            </h3>
            <UtteranceFilterBar
              clusters={clusters}
              value={filter}
              probeDone={probeDone}
              onChange={(patch) => updateParams(patch)}
              onClear={() => updateParams({ cluster: '', candidate: false, unapplied: false, q: '' })}
            />
            {/* 낭독 영역 ③ — 조회가 끝난 뒤의 결과 개수만 1회 낭독한다. */}
            <p role="status" className="ua-result-count">
              {!uttLoading && !uttError ? msg.resultCount(total, detail.counts.validCount) : ''}
            </p>
            {canWrite && (
              <div className="ua-selection-bar">
                {/* 낭독 영역 ② — 선택 변경이 멈춘 뒤(500ms) 1회. */}
                <p role="status" className="ua-selection-count">
                  {selectionText}
                  {debouncedSelectedCount >= maxSelect && ` · ${msg.selectionMaxed}`}
                </p>
                <button type="button" className="btn btn-secondary" onClick={() => setSelected(new Map())} disabled={selected.size === 0}>
                  {msg.selectionClear}
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  aria-disabled={selected.size === 0 ? 'true' : undefined}
                  aria-describedby={selected.size === 0 ? 'ua-apply-need-selection' : undefined}
                  onClick={() => {
                    if (selected.size > 0) setApplyOpen(true);
                  }}
                >
                  {msg.applyOpen}
                </button>
                {selected.size === 0 && (
                  <span id="ua-apply-need-selection" className="field-hint">
                    {msg.applyNeedSelection}
                  </span>
                )}
              </div>
            )}
            {uttLoading ? (
              <div aria-busy="true">
                <p className="sr-only">{msg.utterancesLoading}</p>
                {Array.from({ length: 5 }, (_, i) => (
                  <SkeletonRow key={i} />
                ))}
              </div>
            ) : uttError ? (
              <ErrorState title={msg.utterancesLoadFailed} onRetry={() => setReloadKey((k) => k + 1)} />
            ) : items.length === 0 ? (
              isFiltered ? (
                <EmptyState
                  title={msg.utterancesEmptyFiltered}
                  action={
                    <button type="button" className="btn btn-secondary" onClick={() => updateParams({ cluster: '', candidate: false, unapplied: false, q: '' })}>
                      {msg.clearFilter}
                    </button>
                  }
                />
              ) : (
                <EmptyState title={msg.utterancesEmptyAll} />
              )
            ) : (
              <>
                <UtteranceTable
                  items={items}
                  clusters={clusters}
                  canSelect={canWrite}
                  selected={selected}
                  maxSelect={maxSelect}
                  onToggle={toggle}
                  onTogglePage={togglePage}
                />
                <Pagination page={page} pageSize={UTTERANCE_PAGE_SIZE} total={total} onPageChange={(p) => updateParams({}, p)} />
              </>
            )}
          </ProposalContainer>
        </>
      )}

      {applyOpen && <ApplyToIntentDialog chatbotId={chatbot.id} analysisId={analysisId} selected={selected} onClose={handleApplyClose} />}
      <CancelAnalysisDialog
        chatbotId={chatbot.id}
        analysisId={analysisId}
        isOpen={cancelOpen}
        onClose={() => setCancelOpen(false)}
        onDone={() => void fetchDetail(false)}
        onGone={() => {
          setCancelOpen(false);
          setLoadState('notFound');
        }}
      />
      <DeleteAnalysisDialog
        chatbotId={chatbot.id}
        target={deleteOpen ? { id: analysisId, fileName: detail.fileName } : null}
        onClose={() => setDeleteOpen(false)}
        onDeleted={() => {
          setDeleteOpen(false);
          showToast(msg.deleteSuccess);
          navigate(base);
        }}
        onGone={() => {
          setDeleteOpen(false);
          setLoadState('notFound');
        }}
      />
    </div>
  );
}

/** analysisId가 바뀌면 통째로 다시 마운트해 선택·필터·발화 목록·대화상자 상태가 이전 분석 것으로 남지 않게 한다. */
export function UtteranceAnalysisDetailPage(): JSX.Element {
  const { analysisId = '' } = useParams<{ analysisId: string }>();
  return <DetailPageBody key={analysisId} />;
}
