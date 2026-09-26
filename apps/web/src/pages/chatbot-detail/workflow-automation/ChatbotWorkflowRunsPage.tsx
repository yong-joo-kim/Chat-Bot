import { useCallback, useEffect, useRef, useState } from 'react';
import { WORKFLOW_LIMITS, type ApiErrorDetail, type WorkflowEventType, type WorkflowRunItem, type WorkflowRunStatus, type WorkflowTriggerKind } from '@chat-bot/shared-types';
import { useChatbotDetailContext } from '../../ChatbotDetailLayout';
import { useAuth } from '../../../context/AuthContext';
import { useToast } from '../../../components/Toast';
import { ApiError } from '../../../api/client';
import { chatbotWorkflowRunsApi } from '../../../api/workflowSubscriptions';
import { EmptyState } from '../../../components/EmptyState';
import { ErrorState } from '../../../components/ErrorState';
import { SkeletonRow } from '../../../components/Skeleton';
import { Pagination } from '../../../components/Pagination';
import { ConfirmDialog } from '../../../components/Modal';
import { useLatestRequest } from '../../../lib/useLatestRequest';
import { MESSAGES } from '../../../constants/messages';
import { WorkflowRunFilterBar } from '../../settings/workflow-automation/WorkflowRunFilterBar';
import { WorkflowRunTable } from '../../settings/workflow-automation/WorkflowRunTable';

const POLL_MS = 10000;
const IN_FLIGHT_STATUSES: WorkflowRunStatus[] = ['PENDING', 'SENDING', 'HELD'];
const BULK_MAX = WORKFLOW_LIMITS.bulkRetryCancelMax;

/** WF3-b — 챗봇 > 업무 자동화 > 실행 이력·재발송/취소(`workflow-automation-ui-spec.md` §3.2b). */
export function ChatbotWorkflowRunsPage(): JSX.Element {
  const { chatbot } = useChatbotDetailContext();
  const { can } = useAuth();
  const { showToast } = useToast();
  const msg = MESSAGES.workflowRuns;
  const canWrite = can('chatbot:write');

  const [targetId, setTargetId] = useState('');
  const [triggerKind, setTriggerKind] = useState<WorkflowTriggerKind[]>([]);
  const [eventType, setEventType] = useState<WorkflowEventType[]>([]);
  const [status, setStatus] = useState<WorkflowRunStatus[]>([]);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [retryableOnly, setRetryableOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [rangeError, setRangeError] = useState<string | undefined>(undefined);

  const [items, setItems] = useState<WorkflowRunItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [pollFailing, setPollFailing] = useState(false);

  const [retryConfirmOpen, setRetryConfirmOpen] = useState(false);
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);
  const [bulkSubmitting, setBulkSubmitting] = useState(false);
  const [bulkPartialBlocked, setBulkPartialBlocked] = useState<{ kind: 'retry' | 'cancel'; count: number } | null>(null);
  // [코드리뷰 R1 L-5] `BULK_SIZE_EXCEEDED`(재발송·취소 한 번에 최대 100건) 전용 배너.
  const [bulkSizeExceeded, setBulkSizeExceeded] = useState(false);

  const guard = useLatestRequest();
  const pollRef = useRef<number | null>(null);

  const fetchList = useCallback(async () => {
    const reqId = guard.next();
    try {
      const res = await chatbotWorkflowRunsApi.list(chatbot.id, {
        targetId: targetId || undefined,
        triggerKind,
        eventType,
        status,
        from: from ? new Date(from) : undefined,
        to: to ? new Date(to) : undefined,
        retryableOnly,
        page,
        pageSize: 50,
      });
      if (guard.isStale(reqId)) return;
      setItems(res.items);
      setTotal(res.total);
      setError(false);
      setRangeError(undefined);
      setPollFailing(false);
    } catch (e) {
      if (guard.isStale(reqId)) return;
      const message = e instanceof Error ? e.message : '';
      if (message.includes('90')) setRangeError(msg.rangeTooWide);
      else setError(true);
    } finally {
      if (!guard.isStale(reqId)) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatbot.id, targetId, triggerKind.join(','), eventType.join(','), status.join(','), from, to, retryableOnly, page, guard]);

  useEffect(() => {
    setLoading(true);
    void fetchList();
  }, [fetchList]);

  // [코드리뷰 R1 L-5] 페이지나 필터가 바뀌면 이전 페이지에서 선택한 id가 새 목록에 없을 수 있으므로
  // 선택을 초기화한다(`fetchList`는 page·필터 전부를 의존성으로 갖는 콜백이라 이 변화를 그대로 탄다).
  useEffect(() => {
    setSelectedIds([]);
  }, [fetchList]);

  useEffect(() => {
    const hasInFlight = items.some((i) => IN_FLIGHT_STATUSES.includes(i.status));
    if (!hasInFlight) {
      if (pollRef.current) window.clearInterval(pollRef.current);
      return undefined;
    }
    pollRef.current = window.setInterval(() => {
      fetchList().catch(() => setPollFailing(true));
    }, POLL_MS);
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, [items, fetchList]);

  function detailsToCount(details: ApiErrorDetail[] | undefined): number {
    return details?.length ?? 0;
  }

  async function handleRetry(): Promise<void> {
    setBulkSubmitting(true);
    try {
      const res = await chatbotWorkflowRunsApi.retry(chatbot.id, { runIds: selectedIds });
      showToast(msg.retrySuccess(res.updated));
      setRetryConfirmOpen(false);
      setSelectedIds([]);
      setBulkPartialBlocked(null);
      setBulkSizeExceeded(false);
      void fetchList();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'WORKFLOW_RUN_NOT_RETRYABLE') {
        setBulkPartialBlocked({ kind: 'retry', count: detailsToCount(e.details) || selectedIds.length });
      } else if (e instanceof ApiError && e.code === 'BULK_SIZE_EXCEEDED') {
        setBulkSizeExceeded(true);
      } else {
        showToast(e instanceof ApiError ? e.message : MESSAGES.errors.generic);
        setRetryConfirmOpen(false);
      }
    } finally {
      setBulkSubmitting(false);
    }
  }

  async function handleCancel(): Promise<void> {
    setBulkSubmitting(true);
    try {
      const res = await chatbotWorkflowRunsApi.cancel(chatbot.id, { runIds: selectedIds });
      showToast(msg.cancelSuccess(res.updated));
      setCancelConfirmOpen(false);
      setSelectedIds([]);
      setBulkPartialBlocked(null);
      setBulkSizeExceeded(false);
      void fetchList();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'INVALID_STATUS_TRANSITION') {
        setBulkPartialBlocked({ kind: 'cancel', count: detailsToCount(e.details) || selectedIds.length });
      } else if (e instanceof ApiError && e.code === 'BULK_SIZE_EXCEEDED') {
        setBulkSizeExceeded(true);
      } else {
        showToast(e instanceof ApiError ? e.message : MESSAGES.errors.generic);
        setCancelConfirmOpen(false);
      }
    } finally {
      setBulkSubmitting(false);
    }
  }

  const isEmpty = !loading && !error && items.length === 0;
  const overBulkLimit = selectedIds.length > BULK_MAX;
  const selectedRetryable =
    !overBulkLimit && selectedIds.every((id) => items.find((i) => i.id === id)?.status === 'FAILED' && items.find((i) => i.id === id)?.retryable);
  const selectedCancelable =
    !overBulkLimit &&
    selectedIds.every((id) => {
      const s = items.find((i) => i.id === id)?.status;
      return s === 'PENDING' || s === 'HELD';
    });

  return (
    <div className="chatbot-workflow-runs-page">
      <WorkflowRunFilterBar
        targetId={targetId}
        onTargetIdChange={(v) => {
          setTargetId(v);
          setPage(1);
        }}
        triggerKind={triggerKind}
        onTriggerKindChange={(v) => {
          setTriggerKind(v);
          setPage(1);
        }}
        eventType={eventType}
        onEventTypeChange={(v) => {
          setEventType(v);
          setPage(1);
        }}
        status={status}
        onStatusChange={(v) => {
          setStatus(v);
          setPage(1);
        }}
        from={from}
        to={to}
        onDateChange={(f, t) => {
          setFrom(f);
          setTo(t);
          setPage(1);
        }}
        retryableOnly={retryableOnly}
        onRetryableOnlyChange={(v) => {
          setRetryableOnly(v);
          setPage(1);
        }}
        rangeError={rangeError}
      />

      {pollFailing && (
        <p className="form-banner form-banner--warning" role="status">
          {msg.pollingStalledNotice}
        </p>
      )}

      {canWrite && selectedIds.length > 0 && (
        <div className="workflow-run-bulk-action-bar">
          <span>{msg.selectedCount(selectedIds.length)}</span>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={!selectedRetryable}
            title={overBulkLimit ? msg.bulkSizeExceeded(BULK_MAX) : !selectedRetryable ? msg.retryDisabledTooltip : undefined}
            onClick={() => setRetryConfirmOpen(true)}
          >
            {msg.retryButton}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={!selectedCancelable}
            title={overBulkLimit ? msg.bulkSizeExceeded(BULK_MAX) : undefined}
            onClick={() => setCancelConfirmOpen(true)}
          >
            {msg.cancelButton}
          </button>
        </div>
      )}
      {overBulkLimit && (
        <p className="form-banner form-banner--warning" role="status">
          {msg.bulkSizeExceeded(BULK_MAX)}
        </p>
      )}

      {loading && (
        <>
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </>
      )}
      {!loading && error && <ErrorState title={msg.loadFailed} onRetry={fetchList} />}
      {isEmpty && <EmptyState title={msg.emptyTitle} />}
      {!loading && !error && items.length > 0 && (
        <div className="dialogue-table-wrap">
          <div aria-live="polite" className="sr-only">
            {`${total}건`}
          </div>
          <WorkflowRunTable
            items={items}
            expandedId={expandedId}
            onToggleExpand={(id) => setExpandedId((cur) => (cur === id ? null : id))}
            selectable={canWrite}
            selectedIds={selectedIds}
            onSelectionChange={setSelectedIds}
          />
          <Pagination page={page} pageSize={50} total={total} onPageChange={setPage} />
        </div>
      )}

      <ConfirmDialog
        isOpen={retryConfirmOpen}
        title={msg.retryConfirmTitle(selectedIds.length)}
        description={msg.retryConfirmDesc}
        confirmLabel={msg.retryConfirmSubmit(selectedIds.length)}
        onConfirm={() => void handleRetry()}
        onCancel={() => {
          setRetryConfirmOpen(false);
          setBulkPartialBlocked(null);
          setBulkSizeExceeded(false);
        }}
        confirmDisabled={bulkSubmitting}
      >
        {bulkPartialBlocked?.kind === 'retry' && (
          <p className="form-banner form-banner--error" role="alert">
            {msg.retryPartialBlocked(bulkPartialBlocked.count)}
          </p>
        )}
        {bulkSizeExceeded && (
          <p className="form-banner form-banner--error" role="alert">
            {msg.bulkSizeExceeded(BULK_MAX)}
          </p>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        isOpen={cancelConfirmOpen}
        title={msg.cancelConfirmTitle(selectedIds.length)}
        description={msg.cancelConfirmDesc}
        confirmLabel={msg.cancelConfirmSubmit(selectedIds.length)}
        onConfirm={() => void handleCancel()}
        onCancel={() => {
          setCancelConfirmOpen(false);
          setBulkPartialBlocked(null);
          setBulkSizeExceeded(false);
        }}
        confirmDisabled={bulkSubmitting}
      >
        {bulkPartialBlocked?.kind === 'cancel' && (
          <p className="form-banner form-banner--error" role="alert">
            {msg.cancelPartialBlocked(bulkPartialBlocked.count)}
          </p>
        )}
        {bulkSizeExceeded && (
          <p className="form-banner form-banner--error" role="alert">
            {msg.bulkSizeExceeded(BULK_MAX)}
          </p>
        )}
      </ConfirmDialog>
    </div>
  );
}
