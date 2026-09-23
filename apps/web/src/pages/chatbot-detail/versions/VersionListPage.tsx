import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { ChatbotVersionListItem, RestoreResponse, VersionCurrentStatus, VersionTriggerGroup } from '@chat-bot/shared-types';
import { useChatbotDetailContext } from '../../ChatbotDetailLayout';
import { useAuth } from '../../../context/AuthContext';
import { useToast } from '../../../components/Toast';
import { ApiError } from '../../../api/client';
import { versionsApi } from '../../../api/versions';
import { MESSAGES } from '../../../constants/messages';
import { SkeletonRow } from '../../../components/Skeleton';
import { ErrorState } from '../../../components/ErrorState';
import { EmptyState } from '../../../components/EmptyState';
import { Pagination } from '../../../components/Pagination';
import { ArchivedBanner } from '../ArchivedBanner';
import { CreateVersionModal } from './CreateVersionModal';
import { VersionRow } from './VersionRow';
import { RestoreDialog } from './restore/RestoreDialog';
import { RestoreResultPanel } from './restore/RestoreResultPanel';

const PAGE_SIZE = 20;
type FilterValue = 'ALL' | VersionTriggerGroup;

/** L1 — 버전 목록(`version-history-ui-spec.md` §4.1). 셸 없는 단일 목적지(§1.5). */
export function VersionListPage(): JSX.Element {
  const { chatbot, reload } = useChatbotDetailContext();
  const { can } = useAuth();
  const { showToast } = useToast();
  const { versionId: deepLinkVersionId } = useParams<{ versionId?: string }>();
  const msg = MESSAGES.versions;

  const isArchived = chatbot.status === 'ARCHIVED';
  const canWrite = can('dialogue:write') && !isArchived;
  const canRestore = can('dialogue:write') && can('chatbot:write') && !isArchived;
  const canAudit = can('audit:read');

  const [current, setCurrent] = useState<VersionCurrentStatus | null>(null);
  const [items, setItems] = useState<ChatbotVersionListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<FilterValue>('ALL');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [liveMessage, setLiveMessage] = useState('');
  const [deepLinkNotFound, setDeepLinkNotFound] = useState(false);

  const [expandedId, setExpandedId] = useState<string | null>(deepLinkVersionId ?? null);
  const [createOpen, setCreateOpen] = useState(false);
  const [restoreTarget, setRestoreTarget] = useState<{ id: string; versionNo: number } | null>(null);
  const [restoreResult, setRestoreResult] = useState<RestoreResponse | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const [listRes, currentRes] = await Promise.all([
        versionsApi.list(chatbot.id, { page, pageSize: PAGE_SIZE, triggerGroup: filter === 'ALL' ? undefined : [filter] }),
        versionsApi.current(chatbot.id),
      ]);
      setItems(listRes.items);
      setTotal(listRes.total);
      setCurrent(currentRes);
      setLiveMessage(msg.filterResultAnnounce(listRes.total));
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [chatbot.id, page, filter, msg]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!deepLinkVersionId) return;
    versionsApi.detail(chatbot.id, deepLinkVersionId).catch((e) => {
      if (e instanceof ApiError && e.status === 404) setDeepLinkNotFound(true);
    });
  }, [chatbot.id, deepLinkVersionId]);

  function handleCreated(versionNo: number): void {
    setCreateOpen(false);
    showToast(msg.createSuccess(versionNo));
    setPage(1);
    void load();
  }

  function handleRestored(result: RestoreResponse): void {
    setRestoreTarget(null);
    setRestoreResult(result);
    setPage(1);
    void load();
    // M-2: 복원으로 챗봇 표시 설정(name/avatarUrl/description/skin)이 바뀔 수 있어 헤더·다른 탭이
    // 함께 갱신되도록 ChatbotDetailLayout의 챗봇 컨텍스트도 다시 불러온다.
    void reload();
  }

  /** L-3: 다른 관리자가 이미 복원 중이면(409 RESTORE_IN_PROGRESS) 목록 상태가 바뀌었을 수 있어 재조회한다. */
  function handleRestoreInProgressElsewhere(): void {
    setRestoreTarget(null);
    void load();
  }

  return (
    <div className="version-list-page">
      <ArchivedBanner visible={isArchived} />
      <div className="version-list-header">
        <h1>{msg.pageTitle}</h1>
        {canWrite && (
          <button type="button" className="btn btn-primary" onClick={() => setCreateOpen(true)}>
            {msg.createButton}
          </button>
        )}
      </div>
      <p className="field-hint">{msg.retentionNotice(30, 30, 10)}</p>

      <div className="version-filter-bar">
        <label htmlFor="version-trigger-filter">{msg.filterLabel}</label>
        <select
          id="version-trigger-filter"
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value as FilterValue);
            setPage(1);
          }}
        >
          <option value="ALL">{msg.filterAll}</option>
          <option value="MANUAL">{msg.filterManual}</option>
          <option value="AUTO">{msg.filterAuto}</option>
          <option value="RESTORE_BACKUP">{msg.filterRestoreBackup}</option>
        </select>
      </div>
      <p aria-live="polite" className="sr-only">
        {liveMessage}
      </p>

      {deepLinkNotFound && (
        <p className="form-banner form-banner--warning" role="status">
          {msg.notFoundDeepLink}
        </p>
      )}

      {current && (
        <p className="version-current-state-row" role="status">
          <strong>{msg.currentSectionLabel}</strong> ·{' '}
          {current.hasUnsavedChanges
            ? msg.currentHasChanges
            : current.latestVersion
              ? msg.currentUpToDate(current.latestVersion.versionNo)
              : msg.currentHasChanges}
        </p>
      )}

      {loading ? (
        <>
          <SkeletonRow />
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
          description={msg.emptyDesc}
          action={
            canWrite && (
              <button type="button" className="btn btn-primary" onClick={() => setCreateOpen(true)}>
                {msg.emptyCreateButton}
              </button>
            )
          }
        />
      ) : (
        <>
          <ul className="version-row-list">
            {items.map((item) => (
              <VersionRow
                key={item.id}
                chatbotId={chatbot.id}
                item={item}
                expanded={expandedId === item.id}
                onToggleExpand={() => setExpandedId((prev) => (prev === item.id ? null : item.id))}
                canWrite={canWrite}
                canRestore={canRestore}
                canAudit={canAudit}
                onLabelSaved={load}
                onDeleted={() => {
                  showToast(msg.deleteSuccess);
                  void load();
                }}
                onRestoreRequested={() => setRestoreTarget({ id: item.id, versionNo: item.versionNo })}
              />
            ))}
          </ul>
          <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />
          <p className="sr-only">{MESSAGES.common.totalCount(total)}</p>
        </>
      )}

      <CreateVersionModal chatbotId={chatbot.id} isOpen={createOpen} onClose={() => setCreateOpen(false)} onCreated={handleCreated} />

      {restoreTarget && (
        <RestoreDialog
          chatbotId={chatbot.id}
          targetVersionId={restoreTarget.id}
          targetVersionNo={restoreTarget.versionNo}
          isOpen={restoreTarget !== null}
          onClose={() => setRestoreTarget(null)}
          onRestored={handleRestored}
          onRestoreInProgressElsewhere={handleRestoreInProgressElsewhere}
        />
      )}

      {restoreResult && <RestoreResultPanel chatbotId={chatbot.id} result={restoreResult} onClose={() => setRestoreResult(null)} />}
    </div>
  );
}
