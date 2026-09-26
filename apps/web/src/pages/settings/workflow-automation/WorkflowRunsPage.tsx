import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { ChatbotListItem, WorkflowEventType, WorkflowRunItem, WorkflowRunStatus, WorkflowTriggerKind } from '@chat-bot/shared-types';
import { workflowRunsApi } from '../../../api/workflowRuns';
import { chatbotsApi } from '../../../api/chatbots';
import { EmptyState } from '../../../components/EmptyState';
import { ErrorState } from '../../../components/ErrorState';
import { SkeletonRow } from '../../../components/Skeleton';
import { Pagination } from '../../../components/Pagination';
import { useLatestRequest } from '../../../lib/useLatestRequest';
import { MESSAGES } from '../../../constants/messages';
import { WorkflowRunFilterBar } from './WorkflowRunFilterBar';
import { WorkflowRunTable } from './WorkflowRunTable';

const POLL_MS = 10000;
const IN_FLIGHT_STATUSES: WorkflowRunStatus[] = ['PENDING', 'SENDING', 'HELD'];

/** `?status=FAILED,SKIPPED` 같은 콤마 구분 쿼리 파라미터를 배열로 읽는다(없으면 빈 배열=전체). */
function parseCsvParam(searchParams: URLSearchParams, key: string): string[] {
  const raw = searchParams.get(key);
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** WF1-b — 실행 이력(전역, `/settings/workflow-automation/runs`, ui-spec §3.2). */
export function WorkflowRunsPage(): JSX.Element {
  const msg = MESSAGES.workflowRuns;

  // [코드리뷰 R1 M-1] WF1-c "확인 필요" 항목이 쿼리스트링으로 필터를 실어 이 화면에 이동시킨다
  // (ui-spec §3.3). `useSearchParams`는 최초 마운트 시점 값만 초기 필터로 읽는다(그 뒤 사용자가
  // 필터바를 직접 조작하면 URL과 동기화하지 않는다 — 되돌아가기 전용, 양방향 바인딩 아님).
  const [searchParams] = useSearchParams();
  const [targetId, setTargetId] = useState(() => searchParams.get('targetId') ?? '');
  const [chatbotId, setChatbotId] = useState(() => searchParams.get('chatbotId') ?? '');
  const [triggerKind, setTriggerKind] = useState<WorkflowTriggerKind[]>(() => parseCsvParam(searchParams, 'triggerKind') as WorkflowTriggerKind[]);
  const [eventType, setEventType] = useState<WorkflowEventType[]>(() => parseCsvParam(searchParams, 'eventType') as WorkflowEventType[]);
  const [status, setStatus] = useState<WorkflowRunStatus[]>(() => parseCsvParam(searchParams, 'status') as WorkflowRunStatus[]);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [retryableOnly, setRetryableOnly] = useState(() => searchParams.get('retryableOnly') === 'true');
  const [page, setPage] = useState(1);
  const [rangeError, setRangeError] = useState<string | undefined>(undefined);

  const [items, setItems] = useState<WorkflowRunItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [chatbots, setChatbots] = useState<ChatbotListItem[]>([]);
  const [pollFailing, setPollFailing] = useState(false);

  const guard = useLatestRequest();
  const pollRef = useRef<number | null>(null);

  const [oldestPendingMinutes, setOldestPendingMinutes] = useState<number | null>(null);

  useEffect(() => {
    chatbotsApi
      .list({ page: 1, pageSize: 100 })
      .then((res) => setChatbots(res.items))
      .catch(() => undefined);
    workflowRunsApi
      .summary(7)
      .then((res) => setOldestPendingMinutes(res.attention.oldestPendingMinutes))
      .catch(() => undefined);
  }, []);

  const fetchList = useCallback(async () => {
    const reqId = guard.next();
    try {
      const res = await workflowRunsApi.list({
        targetId: targetId || undefined,
        chatbotId: chatbotId || undefined,
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
  }, [targetId, chatbotId, triggerKind.join(','), eventType.join(','), status.join(','), from, to, retryableOnly, page, guard]);

  useEffect(() => {
    setLoading(true);
    void fetchList();
  }, [fetchList]);

  // UIUX §8 — 진행 중 건이 있을 때만 10초 폴링. 스크롤/펼침 상태는 유지되고 새 항목은 aria-live 1회만 안내한다.
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

  const chatbotNameOf = (id: string | null): string => chatbots.find((c) => c.id === id)?.name ?? id ?? '—';

  const isEmpty = !loading && !error && items.length === 0;

  return (
    <div className="workflow-runs-page">
      <h1 className="sr-only">{msg.pageTitle}</h1>
      <WorkflowRunFilterBar
        targetId={targetId}
        onTargetIdChange={(v) => {
          setTargetId(v);
          setPage(1);
        }}
        chatbotId={chatbotId}
        onChatbotIdChange={(v) => {
          setChatbotId(v);
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

      {oldestPendingMinutes !== null && (
        <p className="form-banner form-banner--warning" role="status">
          {msg.oldestPendingWarning(oldestPendingMinutes)}
        </p>
      )}
      {pollFailing && (
        <p className="form-banner form-banner--warning" role="status">
          {msg.pollingStalledNotice}
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
            showChatbotColumn
            expandedId={expandedId}
            onToggleExpand={(id) => setExpandedId((cur) => (cur === id ? null : id))}
            chatbotNameOf={chatbotNameOf}
          />
          <Pagination page={page} pageSize={50} total={total} onPageChange={setPage} />
        </div>
      )}
    </div>
  );
}
