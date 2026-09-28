import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { KbMetaResponse, KbSourceListItem, KbSourceResponse } from '@chat-bot/shared-types';
import { kbSourcesApi } from '../../../api/kbSources';
import { ApiError } from '../../../api/client';
import { useAuth } from '../../../context/AuthContext';
import { useToast } from '../../../components/Toast';
import { EmptyState } from '../../../components/EmptyState';
import { ErrorState } from '../../../components/ErrorState';
import { SkeletonRow } from '../../../components/Skeleton';
import { KebabMenu } from '../../../components/KebabMenu';
import { MESSAGES } from '../../../constants/messages';
import { formatDateTime, formatRelativeTime } from '../../../lib/date';
import {
  KbDemotedBadge,
  KbNeedsCleanupBadge,
  KbNeedsPreviewBadge,
  KbRepeatedFailureBadge,
  KbRunStatusBadge,
  KbSourceEnabledBadge,
} from './badges';
import { KbSourceFilterBar } from './KbSourceFilterBar';
import { KbSourceEditModal } from './KbSourceEditModal';
import { DeleteKbSourceConfirmDialog } from './DeleteKbSourceConfirmDialog';
import { KbFeatureOffState } from './KbFeatureOffState';
import { KbGovernanceBlockedHint, clientGovernanceViolation } from './governanceBlock';

function scopeText(item: KbSourceListItem): string {
  return [item.scope.company, item.scope.category, item.scope.subcategory].filter(Boolean).join(' / ');
}

function scheduleText(item: KbSourceListItem): string {
  const msg = MESSAGES.kbSources;
  if (item.schedule.kind === 'MANUAL') return msg.scheduleLabel.MANUAL;
  if (item.schedule.kind === 'DAILY') return `${msg.scheduleLabel.DAILY} ${item.schedule.time}`;
  return `${msg.scheduleLabel.WEEKLY} ${msg.scheduleWeekdayLabel[item.schedule.weekday]} ${item.schedule.time}`;
}

/** KB2 — 소스 목록(`/settings/kb-crawling`, `kb-crawling-ui-spec.md` §3.1). */
export function KbSourcesPage(): JSX.Element {
  const { can } = useAuth();
  const { showToast } = useToast();
  const msg = MESSAGES.kbSources;
  const canWrite = can('security:write');

  const [meta, setMeta] = useState<KbMetaResponse | null>(null);
  const [featureOff, setFeatureOff] = useState(false);
  const [metaLoading, setMetaLoading] = useState(true);

  const [q, setQ] = useState('');
  const [enabledFilter, setEnabledFilter] = useState<boolean[]>([true, false]);
  const [items, setItems] = useState<KbSourceListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingDetail, setEditingDetail] = useState<KbSourceResponse | null>(null);
  const [editingLoading, setEditingLoading] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<KbSourceListItem | null>(null);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);

  const loadMeta = useCallback(async () => {
    setMetaLoading(true);
    try {
      const res = await kbSourcesApi.meta();
      setMeta(res);
      setFeatureOff(false);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setFeatureOff(true);
      else setFeatureOff(false);
    } finally {
      setMetaLoading(false);
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await kbSourcesApi.list(1, 50);
      setItems(res.items);
      setTotal(res.total);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadMeta();
  }, [loadMeta]);

  useEffect(() => {
    if (!metaLoading && !featureOff) void load();
  }, [metaLoading, featureOff, load]);

  const filtered = useMemo(() => {
    const lowered = q.trim().toLowerCase();
    return items.filter((it) => {
      if (lowered && !it.name.toLowerCase().includes(lowered)) return false;
      if (!enabledFilter.includes(it.enabled)) return false;
      return true;
    });
  }, [items, q, enabledFilter]);

  async function openCreate(): Promise<void> {
    setEditingId(null);
    setEditingDetail(null);
    setFormOpen(true);
  }

  async function openEdit(item: KbSourceListItem): Promise<void> {
    setEditingId(item.id);
    setFormOpen(true);
    setEditingLoading(true);
    try {
      const detail = await kbSourcesApi.findOne(item.id);
      setEditingDetail(detail);
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : MESSAGES.errors.generic);
      setFormOpen(false);
    } finally {
      setEditingLoading(false);
    }
  }

  async function handleDelete(): Promise<void> {
    if (!deleteTarget) return;
    setDeleteSubmitting(true);
    try {
      await kbSourcesApi.remove(deleteTarget.id);
      showToast(msg.deleteSuccess);
      setDeleteTarget(null);
      void load();
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : MESSAGES.errors.generic);
    } finally {
      setDeleteSubmitting(false);
    }
  }

  async function handleToggleEnabled(item: KbSourceListItem): Promise<void> {
    try {
      await kbSourcesApi.update(item.id, { enabled: !item.enabled });
      void load();
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : MESSAGES.errors.generic);
    }
  }

  /** "지금 실행" — 종류 선택 UI 없음, `ingestApproved` 여부로 클라이언트가 자동 결정한다(§13.1 사용자 결정 3). */
  async function handleRunNow(item: KbSourceListItem): Promise<void> {
    try {
      await kbSourcesApi.createRun(item.id, { kind: item.ingestApproved ? 'SYNC' : 'PREVIEW' });
      showToast(msg.runNowSuccess);
      void load();
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : MESSAGES.errors.generic);
    }
  }

  /** 표·카드가 함께 렌더되므로(반응형) 사유 문단 id는 배치(variant)별로 달리한다. */
  function governanceHintId(item: KbSourceListItem, variant: 'table' | 'card'): string {
    return `kb-gov-block-${variant}-${item.id}`;
  }

  /** 거버넌스 규칙 위반이 확실할 때만(메타 + 소스 값) 실행을 미리 막는다 — 모르면 null(활성 유지·서버 409 폴백). */
  function governanceViolationFor(item: KbSourceListItem) {
    return canWrite ? clientGovernanceViolation(meta, item) : null;
  }

  function kebabItemsFor(item: KbSourceListItem, variant: 'table' | 'card') {
    const violation = governanceViolationFor(item);
    return [
      { label: msg.menuEdit, onSelect: () => void openEdit(item), disabled: !canWrite },
      { label: item.enabled ? msg.badgeDisabled : msg.badgeEnabled, onSelect: () => void handleToggleEnabled(item), disabled: !canWrite },
            {
        label: msg.menuRunNow,
        onSelect: () => void handleRunNow(item),
        disabled: !canWrite || Boolean(item.activeRun) || Boolean(violation),
        describedBy: violation ? governanceHintId(item, variant) : undefined,
      },
      {
        label: msg.menuDelete,
        onSelect: () => setDeleteTarget(item),
        disabled: !canWrite || Boolean(item.activeRun),
        title: item.activeRun ? msg.menuDeleteDisabledHint : undefined,
      },
    ];
  }

  function badgesFor(item: KbSourceListItem, variant: 'table' | 'card') {
    const violation = governanceViolationFor(item);
    return (
      <>
        <div className="api-connection-badge-row">
          <KbSourceEnabledBadge enabled={item.enabled} />
          {item.needsPreview && <KbNeedsPreviewBadge />}
          {item.needsCleanupCount > 0 && (
            <KbNeedsCleanupBadge count={item.needsCleanupCount} linkTo={`/settings/kb-crawling/${item.id}/documents?cleanupOnly=true`} sourceName={item.name} />
          )}
          {item.repeatedFailureCount > 0 && <KbRepeatedFailureBadge />}
          {item.reviewRequiredReason && <KbDemotedBadge reason={item.reviewRequiredReason} />}
        </div>
        {violation && <KbGovernanceBlockedHint id={governanceHintId(item, variant)} violation={violation} />}
      </>
    );
  }

  if (metaLoading) {
    return (
      <div className="settings-page">
        <h1>{msg.pageTitle}</h1>
        <SkeletonRow />
        <SkeletonRow />
        <SkeletonRow />
      </div>
    );
  }
  if (featureOff) return <KbFeatureOffState />;

  const isEmpty = !loading && !error && items.length === 0;
  const atLimit = total >= 50;

  return (
    <div className="settings-page">
      <h1>{msg.pageTitle}</h1>

      {meta?.ingestAck === null && (
        <p className="form-banner form-banner--warning" role="status">
          <span aria-hidden="true">⚠</span> {msg.transportAckMissingBanner}
        </p>
      )}
      {meta?.governanceMode === 'ON' && (
        <p className="form-banner form-banner--info">{msg.governanceModeBanner}</p>
      )}

      <div className="dialogue-toolbar">
        <KbSourceFilterBar q={q} onQChange={setQ} enabled={enabledFilter} onEnabledChange={setEnabledFilter} />
        {canWrite && (
          <span title={atLimit ? msg.sourceLimitReachedTooltip(50) : undefined}>
            <button type="button" className="btn btn-primary" disabled={atLimit} onClick={() => void openCreate()}>
              {msg.addButton}
            </button>
          </span>
        )}
      </div>

      {loading && (
        <>
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </>
      )}
      {!loading && error && <ErrorState title={msg.loadFailed} onRetry={load} />}
      {isEmpty && (
        <EmptyState
          title={msg.emptyTitle}
          description={msg.emptyDesc}
          action={
            canWrite && (
              <button type="button" className="btn btn-primary" onClick={() => void openCreate()}>
                {msg.addButton}
              </button>
            )
          }
        />
      )}
      {!loading && !error && items.length > 0 && filtered.length === 0 && (
        <EmptyState
          title={msg.emptySearchTitle}
          action={
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                setQ('');
                setEnabledFilter([true, false]);
              }}
            >
              {msg.resetFilter}
            </button>
          }
        />
      )}
      {!loading && !error && filtered.length > 0 && (
        <div className="dialogue-table-wrap">
          <table className="dialogue-table desktop-only">
            <caption className="sr-only">{`${msg.pageTitle} — 총 ${filtered.length}건`}</caption>
            <thead>
              <tr>
                <th scope="col">{msg.columnName}</th>
                <th scope="col">{msg.columnScope}</th>
                <th scope="col">{msg.columnSchedule}</th>
                <th scope="col">{msg.columnLastRun}</th>
                <th scope="col">{msg.columnNextRun}</th>
                <th scope="col">{msg.columnStatus}</th>
                <th scope="col">{msg.columnActions}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item) => (
                <tr key={item.id}>
                  <td>
                    <Link to={`/settings/kb-crawling/${item.id}`}>{item.name}</Link>
                  </td>
                  <td>{scopeText(item)}</td>
                  <td>{scheduleText(item)}</td>
                  <td>
                    {item.lastRun ? (
                      <>
                        <KbRunStatusBadge status={item.lastRun.status} />{' '}
                        {item.lastRun.finishedAt && <span title={formatDateTime(item.lastRun.finishedAt)}>{formatRelativeTime(item.lastRun.finishedAt)}</span>}
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>{item.nextRunAt ? formatDateTime(item.nextRunAt) : '—'}</td>
                  <td>{badgesFor(item, 'table')}</td>
                  <td>
                    <KebabMenu label={msg.kebabManageLabel(item.name)} items={kebabItemsFor(item, 'table')} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* 반응형(≤640px) — `settings-card-list mobile-only`(DataGovernanceMapPage 선례, UIUX §9). */}
          <ul className="settings-card-list mobile-only">
            {filtered.map((item) => (
              <li key={item.id} className="settings-card">
                <div className="settings-card-header">
                  <Link to={`/settings/kb-crawling/${item.id}`} className="settings-card-title">
                    {item.name}
                  </Link>
                  <KebabMenu label={msg.kebabManageLabel(item.name)} items={kebabItemsFor(item, 'card')} />
                </div>
                {badgesFor(item, 'card')}
                <dl className="settings-card-fields">
                  <div>
                    <dt>{msg.columnScope}</dt>
                    <dd>{scopeText(item)}</dd>
                  </div>
                  <div>
                    <dt>{msg.columnSchedule}</dt>
                    <dd>{scheduleText(item)}</dd>
                  </div>
                  <div>
                    <dt>{msg.columnLastRun}</dt>
                    <dd>
                      {item.lastRun ? (
                        <>
                          <KbRunStatusBadge status={item.lastRun.status} />{' '}
                          {item.lastRun.finishedAt && formatRelativeTime(item.lastRun.finishedAt)}
                        </>
                      ) : (
                        '—'
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>{msg.columnNextRun}</dt>
                    <dd>{item.nextRunAt ? formatDateTime(item.nextRunAt) : '—'}</dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
        </div>
      )}

      {formOpen && !editingLoading && (
        <KbSourceEditModal
          key={editingId ?? 'new'}
          isOpen={formOpen}
          source={editingDetail}
          onClose={() => setFormOpen(false)}
          onSaved={() => {
            showToast(msg.saveSuccess);
            setFormOpen(false);
            void load();
          }}
        />
      )}

      <DeleteKbSourceConfirmDialog source={deleteTarget} submitting={deleteSubmitting} onConfirm={() => void handleDelete()} onCancel={() => setDeleteTarget(null)} />
    </div>
  );
}
