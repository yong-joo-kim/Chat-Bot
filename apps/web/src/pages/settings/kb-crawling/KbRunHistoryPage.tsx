import { useCallback, useEffect, useRef, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import type { KbRunView } from '@chat-bot/shared-types';
import { kbSourcesApi } from '../../../api/kbSources';
import { ApiError } from '../../../api/client';
import { useAuth } from '../../../context/AuthContext';
import { useToast } from '../../../components/Toast';
import { EmptyState } from '../../../components/EmptyState';
import { ErrorState } from '../../../components/ErrorState';
import { SkeletonRow } from '../../../components/Skeleton';
import { Pagination } from '../../../components/Pagination';
import { useLatestRequest } from '../../../lib/useLatestRequest';
import { MESSAGES } from '../../../constants/messages';
import { KbRunTable } from './KbRunTable';
import { useAnnouncedTransition } from './useAnnouncedTransition';
import type { KbSourceOutletContext } from './KbSourceShell';

const POLL_MS = 5000;
const IN_FLIGHT_STATUSES: KbRunView['status'][] = ['QUEUED', 'CRAWLING', 'INGESTING'];

/**
 * KB4 — 소스 상세: 실행 이력(`/settings/kb-crawling/:sourceId/runs`, `kb-crawling-ui-spec.md` §3.4).
 * 진행 중 실행이 있을 때만 5초 간격으로 다시 읽는다(설계서 §12 화면 5 — 워크플로우의 10초 대신 5초).
 * 언마운트·`sourceId` 변경 시 폴링 정리, 경합은 `useLatestRequest`로 막는다.
 */
export function KbRunHistoryPage(): JSX.Element {
  const { source } = useOutletContext<KbSourceOutletContext>();
  const { can } = useAuth();
  const { showToast } = useToast();
  const msg = MESSAGES.kbRuns;
  const canWrite = can('security:write');

  const [items, setItems] = useState<KbRunView[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const guard = useLatestRequest();
  const pollRef = useRef<number | null>(null);

  const fetchList = useCallback(async () => {
    const reqId = guard.next();
    try {
      const res = await kbSourcesApi.listRuns(source.id, page, 20);
      if (guard.isStale(reqId)) return;
      setItems(res.items);
      setTotal(res.total);
      setError(false);
    } catch {
      if (guard.isStale(reqId)) return;
      setError(true);
    } finally {
      if (!guard.isStale(reqId)) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source.id, page, guard]);

  useEffect(() => {
    setLoading(true);
    void fetchList();
  }, [fetchList]);

  // 진행 중 실행이 있을 때만 5초 폴링(§0-2) — 언마운트·`source.id` 변경 시 정리.
  useEffect(() => {
    const hasInFlight = items.some((i) => IN_FLIGHT_STATUSES.includes(i.status));
    if (!hasInFlight) {
      if (pollRef.current) window.clearInterval(pollRef.current);
      pollRef.current = null;
      return undefined;
    }
    pollRef.current = window.setInterval(() => {
      void fetchList();
    }, POLL_MS);
    return () => {
      if (pollRef.current) {
        window.clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [items, fetchList, source.id]);

  async function handleCancel(run: KbRunView): Promise<void> {
    try {
      await kbSourcesApi.cancelRun(source.id, run.id);
      showToast(msg.cancelSuccess);
      void fetchList();
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : MESSAGES.errors.generic);
    }
  }

  // 진행 중이던 실행이 완료(SUCCEEDED 등)로 넘어가도 "상태가 바뀔 때만" 알림에 최종 상태가 반영되도록
  // id로 계속 추적한다(§0-2) — `items.find(in-flight)`만 쓰면 완료 직후 대상이 사라져 최종 전이를
  // 낭독하지 못한다.
  const [trackedRunId, setTrackedRunId] = useState<string | null>(null);
  useEffect(() => {
    const inFlight = items.find((i) => IN_FLIGHT_STATUSES.includes(i.status));
    if (inFlight) setTrackedRunId(inFlight.id);
  }, [items]);
  const trackedRun = items.find((i) => i.id === trackedRunId);
  const liveStatusLabel = trackedRun ? msg.statusLabel[trackedRun.status] : '';
  const announced = useAnnouncedTransition(liveStatusLabel);

  const isEmpty = !loading && !error && items.length === 0;

  return (
    <div className="kb-run-history-page">
      <h1 className="sr-only">{msg.tabRuns}</h1>
      <div className="sr-only" aria-live="polite">
        {announced}
      </div>

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
          <KbRunTable items={items} expandedId={expandedId} onToggleExpand={(id) => setExpandedId((cur) => (cur === id ? null : id))} onCancel={handleCancel} canCancel={canWrite} />
          <Pagination page={page} pageSize={20} total={total} onPageChange={setPage} />
        </div>
      )}
    </div>
  );
}
