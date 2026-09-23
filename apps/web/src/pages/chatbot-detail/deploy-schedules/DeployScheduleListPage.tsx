import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DEPLOY_SCHEDULE_ACTION_LABELS, DEPLOY_SCHEDULE_STATUS_LABELS } from '@chat-bot/shared-types';
import type { DeployScheduleAction, DeployScheduleListItem, DeployScheduleStatus } from '@chat-bot/shared-types';
import { useChatbotDetailContext } from '../../ChatbotDetailLayout';
import { useAuth } from '../../../context/AuthContext';
import { useToast } from '../../../components/Toast';
import { ApiError } from '../../../api/client';
import { deploySchedulesApi } from '../../../api/deploySchedules';
import { MESSAGES } from '../../../constants/messages';
import { SkeletonRow } from '../../../components/Skeleton';
import { ErrorState } from '../../../components/ErrorState';
import { EmptyState } from '../../../components/EmptyState';
import { Pagination } from '../../../components/Pagination';
import { ConfirmDialog } from '../../../components/Modal';
import { MultiSelectDropdown } from '../../../components/MultiSelectDropdown';
import { EngineDisabledBanner } from '../../../components/EngineDisabledBanner';
import { SeverityBadge } from '../../../components/SeverityBadge';
import { useDeployScheduleMeta } from '../../../lib/useDeployScheduleMeta';
import { ArchivedBanner } from '../ArchivedBanner';
import { DeployScheduleRow } from './DeployScheduleRow';
import { ScheduleDeployDialog } from './ScheduleDeployDialog';

const PAGE_SIZE = 20;
const POLL_INTERVAL_MS = 5000;

const STATUS_OPTIONS: DeployScheduleStatus[] = ['PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'MISSED', 'HELD', 'CANCELLED'];
const ACTION_OPTIONS: DeployScheduleAction[] = ['RESTORE_VERSION', 'PUBLISH', 'SET_WEB_CHANNEL'];

/** S1 — 챗봇별 예약 목록(`scheduled-deploy-ui-spec.md` §4.1). */
export function DeployScheduleListPage(): JSX.Element {
  const { chatbot } = useChatbotDetailContext();
  const { can } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const msg = MESSAGES.deploySchedules;

  const isArchived = chatbot.status === 'ARCHIVED';
  // "+ 예약 만들기" 노출 여부는 3동작 중 하나라도 만들 수 있으면 보인다(어떤 동작이 가능한지는
  // ActionPickerStep이 동작별로 다시 gating한다 — 아래 actionOptions). 행별 판정은 canManageDeploySchedule을 쓴다.
  const canCreateAny = can('chatbot:write') || can('channel:write') || can('dialogue:write');

  const meta = useDeployScheduleMeta();
  const [items, setItems] = useState<DeployScheduleListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<DeployScheduleStatus[]>([]);
  const [actionFilter, setActionFilter] = useState<DeployScheduleAction[]>([]);
  const [needsAttentionOnly, setNeedsAttentionOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [liveMessage, setLiveMessage] = useState('');

  const [createOpen, setCreateOpen] = useState(false);
  const [retryTarget, setRetryTarget] = useState<{ item: DeployScheduleListItem; versionId?: string } | null>(null);
  const [cancelTarget, setCancelTarget] = useState<DeployScheduleListItem | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const load = useCallback(async () => {
    setError(false);
    try {
      const res = await deploySchedulesApi.list(chatbot.id, {
        page,
        pageSize: PAGE_SIZE,
        status: statusFilter.length ? statusFilter : undefined,
        action: actionFilter.length ? actionFilter : undefined,
        needsAttention: needsAttentionOnly || undefined,
      });
      setItems(res.items);
      setTotal(res.total);
      setLiveMessage(msg.filterResultAnnounce(res.total));
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [chatbot.id, page, statusFilter, actionFilter, needsAttentionOnly, msg]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  // §9: RUNNING 또는 재시도 중(PENDING·attemptCount≥1) 행이 있을 때만 5초 폴링. 탭 비활성 시 중단.
  useEffect(() => {
    const hasActive = items.some((i) => i.status === 'RUNNING' || (i.status === 'PENDING' && i.attemptCount >= 1));
    if (!hasActive) return undefined;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [items, load]);

  // H-1(리뷰 2라운드) — 목록 스키마에 `targetVersionId`가 추가되어 더 이상 상세 조회로 보완할 필요가 없다.
  function handleRetry(item: DeployScheduleListItem): void {
    setRetryTarget({ item, versionId: item.targetVersionId ?? undefined });
  }

  async function handleAcknowledge(item: DeployScheduleListItem): Promise<void> {
    try {
      await deploySchedulesApi.acknowledge(chatbot.id, item.id);
      showToast(msg.acknowledgeSuccess);
      void load();
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : MESSAGES.errors.generic);
    }
  }

  async function handleCancelConfirm(): Promise<void> {
    if (!cancelTarget) return;
    setCancelling(true);
    try {
      await deploySchedulesApi.cancel(chatbot.id, cancelTarget.id);
      showToast(msg.cancelSuccess);
      setCancelTarget(null);
      void load();
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : MESSAGES.errors.generic);
      setCancelTarget(null);
    } finally {
      setCancelling(false);
    }
  }

  function handleCreated(label: string): void {
    setCreateOpen(false);
    setRetryTarget(null);
    showToast(msg.dialog.createSuccess(label));
    setPage(1);
    void load();
  }

  return (
    <div className="deploy-schedule-list-page">
      <ArchivedBanner visible={isArchived} />
      <EngineDisabledBanner visible={Boolean(meta && !meta.engine.enabledOnThisInstance)} />
      {meta && meta.engine.overduePendingCount > 0 && (
        <SeverityBadge severity="WARNING" label={msg.overdueBanner(meta.engine.overduePendingCount)} />
      )}

      <div className="version-list-header">
        <h1>{msg.pageTitle}</h1>
        {canCreateAny && !isArchived && (
          <button type="button" className="btn btn-primary" onClick={() => setCreateOpen(true)}>
            {msg.createButton}
          </button>
        )}
      </div>

      <div className="deploy-schedule-filter-bar">
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
        <button type="button" className="btn btn-secondary" onClick={() => void load()}>
          {msg.refreshButton}
        </button>
      </div>
      <p aria-live="polite" className="sr-only">
        {liveMessage}
      </p>

      {loading ? (
        <>
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </>
      ) : error ? (
        <ErrorState title={msg.loadFailed} onRetry={load} />
      ) : items.length === 0 ? (
        <EmptyState
          title={msg.emptyTitle}
          description={`${msg.emptyDesc} ${msg.emptyRestoreHint}`}
          action={
            <div>
              {canCreateAny && !isArchived && (
                <button type="button" className="btn btn-primary" onClick={() => setCreateOpen(true)}>
                  {msg.emptyCreateButton}
                </button>
              )}{' '}
              <button type="button" className="btn btn-secondary" onClick={() => navigate(`/chatbots/${chatbot.id}/versions`)}>
                {msg.goToVersionsButton}
              </button>
            </div>
          }
        />
      ) : (
        <>
          <ul className="deploy-schedule-row-list">
            {items.map((item) => (
              <DeployScheduleRow
                key={item.id}
                item={item}
                can={isArchived ? () => false : can}
                detailHref={`/chatbots/${chatbot.id}/deploy-schedules/${item.id}`}
                onRetry={handleRetry}
                onAcknowledge={handleAcknowledge}
                onCancel={setCancelTarget}
              />
            ))}
          </ul>
          <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />
          <p className="sr-only">{MESSAGES.common.totalCount(total)}</p>
        </>
      )}

      {meta && (
        <ScheduleDeployDialog
          chatbotId={chatbot.id}
          isOpen={createOpen}
          onClose={() => setCreateOpen(false)}
          onCreated={handleCreated}
          timezone={meta.timezone}
          chatbotStatus={chatbot.status}
        />
      )}

      {meta && retryTarget && (
        <ScheduleDeployDialog
          chatbotId={chatbot.id}
          isOpen={retryTarget !== null}
          onClose={() => setRetryTarget(null)}
          onCreated={handleCreated}
          timezone={meta.timezone}
          chatbotStatus={chatbot.status}
          initialAction={retryTarget.item.action}
          versionId={retryTarget.versionId}
          versionNo={retryTarget.item.targetVersionNo ?? undefined}
          enabled={retryTarget.item.action === 'SET_WEB_CHANNEL' ? (retryTarget.item.channelEnabled ?? undefined) : undefined}
        />
      )}

      <ConfirmDialog
        isOpen={cancelTarget !== null}
        title={msg.cancelConfirmTitle}
        description={msg.cancelConfirmDesc}
        confirmLabel={msg.cancelButton}
        danger
        confirmDisabled={cancelling}
        onConfirm={() => void handleCancelConfirm()}
        onCancel={() => setCancelTarget(null)}
      />
    </div>
  );
}
