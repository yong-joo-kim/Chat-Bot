import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { DEPLOY_SCHEDULE_ACTION_LABELS, DEPLOY_SCHEDULE_STATUS_LABELS } from '@chat-bot/shared-types';
import type { ChatbotListItem, DeployScheduleAction, DeployScheduleListItem, DeployScheduleStatus, DeployScheduleSummary } from '@chat-bot/shared-types';
import { chatbotsApi } from '../../api/chatbots';
import { deploySchedulesApi } from '../../api/deploySchedules';
import { MESSAGES } from '../../constants/messages';
import { SkeletonRow } from '../../components/Skeleton';
import { ErrorState } from '../../components/ErrorState';
import { EmptyState } from '../../components/EmptyState';
import { Pagination } from '../../components/Pagination';
import { MultiSelectDropdown } from '../../components/MultiSelectDropdown';
import { DeployScheduleRow } from '../chatbot-detail/deploy-schedules/DeployScheduleRow';
import { Summary24hBar } from './deploy-schedules/Summary24hBar';

const PAGE_SIZE = 20;
const STATUS_OPTIONS: DeployScheduleStatus[] = ['PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'MISSED', 'HELD', 'CANCELLED'];
const ACTION_OPTIONS: DeployScheduleAction[] = ['RESTORE_VERSION', 'PUBLISH', 'SET_WEB_CHANNEL'];

/** S4 — 전역 예약 목록(`scheduled-deploy-ui-spec.md` §4.4). 쓰기 액션은 제공하지 않는다. */
export function DeploySchedulesPage(): JSX.Element {
  const msg = MESSAGES.deploySchedules;
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [chatbots, setChatbots] = useState<ChatbotListItem[]>([]);
  const [summary, setSummary] = useState<DeployScheduleSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [items, setItems] = useState<DeployScheduleListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [chatbotIdFilter, setChatbotIdFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<DeployScheduleStatus[]>([]);
  const [actionFilter, setActionFilter] = useState<DeployScheduleAction[]>([]);
  const [needsAttentionOnly, setNeedsAttentionOnly] = useState(searchParams.get('needsAttention') === 'true');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    chatbotsApi
      .list({ pageSize: 100, includeArchived: true })
      .then((res) => setChatbots(res.items))
      .catch(() => undefined);
  }, []);

  const loadSummary = useCallback(async () => {
    try {
      const res = await deploySchedulesApi.summary();
      setSummary(res);
    } catch {
      // 요약 조회 실패는 목록 조회를 막지 않는다.
    } finally {
      setSummaryLoading(false);
    }
  }, []);

  const load = useCallback(async () => {
    setError(false);
    try {
      const res = await deploySchedulesApi.globalList({
        page,
        pageSize: PAGE_SIZE,
        chatbotId: chatbotIdFilter || undefined,
        status: statusFilter.length ? statusFilter : undefined,
        action: actionFilter.length ? actionFilter : undefined,
        needsAttention: needsAttentionOnly || undefined,
      });
      setItems(res.items);
      setTotal(res.total);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [page, chatbotIdFilter, statusFilter, actionFilter, needsAttentionOnly]);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  // §9: RUNNING 있으면 5초, 그 외 summary만 60초.
  useEffect(() => {
    const hasRunning = items.some((i) => i.status === 'RUNNING');
    const interval = hasRunning ? 5000 : 60000;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      if (hasRunning) void load();
      else void loadSummary();
    }, interval);
    return () => window.clearInterval(timer);
  }, [items, load, loadSummary]);

  return (
    <div className="deploy-schedules-global-page">
      <h1>{msg.globalPageTitle}</h1>
      <Summary24hBar summary={summary} loading={summaryLoading} />

      <div className="deploy-schedule-filter-bar">
        <label className="form-field--inline">
          {msg.global.chatbotFilterLabel}
          <select
            value={chatbotIdFilter}
            onChange={(e) => {
              setChatbotIdFilter(e.target.value);
              setPage(1);
            }}
          >
            <option value="">{msg.global.chatbotFilterAll}</option>
            {chatbots.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <MultiSelectDropdown
          label={msg.filterLabel}
          options={STATUS_OPTIONS.map((s) => ({ value: s, label: DEPLOY_SCHEDULE_STATUS_LABELS[s] }))}
          selected={statusFilter}
          onChange={(v) => {
            setStatusFilter(v);
            setPage(1);
          }}
          allLabel={msg.filterAllStatus}
        />
        <MultiSelectDropdown
          label={msg.actionFilterLabel}
          options={ACTION_OPTIONS.map((a) => ({ value: a, label: DEPLOY_SCHEDULE_ACTION_LABELS[a] }))}
          selected={actionFilter}
          onChange={(v) => {
            setActionFilter(v);
            setPage(1);
          }}
          allLabel={msg.filterAllAction}
        />
        <label className="form-field--inline">
          <input
            type="checkbox"
            checked={needsAttentionOnly}
            onChange={(e) => {
              setNeedsAttentionOnly(e.target.checked);
              setPage(1);
            }}
          />
          {msg.needsAttentionFilterLabel}
        </label>
      </div>

      {loading ? (
        <>
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </>
      ) : error ? (
        <ErrorState title={msg.loadFailed} onRetry={load} />
      ) : items.length === 0 ? (
        <EmptyState title={msg.global.emptyTitle} />
      ) : (
        <>
          <ul className="deploy-schedule-row-list">
            {items.map((item) => (
              <DeployScheduleRow
                key={item.id}
                item={item}
                chatbotName={item.chatbotName}
                can={() => false}
                detailHref={`/chatbots/${item.chatbotId}/deploy-schedules/${item.id}`}
                onRetry={() => navigate(`/chatbots/${item.chatbotId}/deploy-schedules/${item.id}`)}
                onAcknowledge={() => navigate(`/chatbots/${item.chatbotId}/deploy-schedules/${item.id}`)}
                onCancel={() => navigate(`/chatbots/${item.chatbotId}/deploy-schedules/${item.id}`)}
              />
            ))}
          </ul>
          <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />
          <p className="sr-only">{MESSAGES.common.totalCount(total)}</p>
        </>
      )}
    </div>
  );
}
