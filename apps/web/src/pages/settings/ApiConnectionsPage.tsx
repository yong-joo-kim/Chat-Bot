import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ApiConnection, ApiConnectionListItem, ApiErrorDetail } from '@chat-bot/shared-types';
import { apiConnectionsApi } from '../../api/apiConnections';
import { ApiError } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../components/Toast';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { SkeletonRow } from '../../components/Skeleton';
import { KebabMenu } from '../../components/KebabMenu';
import { MESSAGES } from '../../constants/messages';
import {
  ConnectionEnabledBadge,
  CircuitOpenBadge,
  InsecureHttpBadge,
  PersonalDataLookupBadge,
  RawPersonalDataBadge,
  SecretStatusBadge,
} from './api-connections/badges';
import { ApiConnectionFilterBar } from './api-connections/ApiConnectionFilterBar';
import { ApiConnectionEditModal } from './api-connections/ApiConnectionEditModal';
import { DeleteApiConnectionConfirmDialog } from './api-connections/DeleteApiConnectionConfirmDialog';

/** AC1 — API 연결 관리(`/settings/api-connections`, `legacy-api-integration-ui-spec.md` §3.1). */
export function ApiConnectionsPage(): JSX.Element {
  const { can } = useAuth();
  const { showToast } = useToast();
  const msg = MESSAGES.apiConnections;
  const canWrite = can('security:write');

  const [q, setQ] = useState('');
  const [enabledFilter, setEnabledFilter] = useState<boolean[]>([true, false]);
  const [items, setItems] = useState<ApiConnectionListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingDetail, setEditingDetail] = useState<ApiConnection | null>(null);
  const [editingLoading, setEditingLoading] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<ApiConnectionListItem | null>(null);
  const [deleteInUse, setDeleteInUse] = useState<ApiErrorDetail[] | null>(null);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await apiConnectionsApi.list();
      setItems(res.items);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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

  async function openEdit(item: ApiConnectionListItem): Promise<void> {
    setEditingId(item.id);
    setFormOpen(true);
    setEditingLoading(true);
    try {
      const detail = await apiConnectionsApi.findOne(item.id);
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
      await apiConnectionsApi.remove(deleteTarget.id);
      showToast(msg.deleteSuccess);
      setDeleteTarget(null);
      setDeleteInUse(null);
      void load();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'API_CONNECTION_IN_USE') {
        setDeleteInUse(e.details ?? []);
      } else {
        showToast(e instanceof ApiError ? e.message : MESSAGES.errors.generic);
        setDeleteTarget(null);
      }
    } finally {
      setDeleteSubmitting(false);
    }
  }

  async function handleToggleEnabled(item: ApiConnectionListItem): Promise<void> {
    try {
      await apiConnectionsApi.update(item.id, { enabled: !item.enabled });
      void load();
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : MESSAGES.errors.generic);
    }
  }

  const isEmpty = !loading && !error && items.length === 0;

  return (
    <div className="settings-page">
      <h1>{msg.pageTitle}</h1>
      <div className="dialogue-toolbar">
        <ApiConnectionFilterBar q={q} onQChange={setQ} enabled={enabledFilter} onEnabledChange={setEnabledFilter} />
        {canWrite && (
          <button type="button" className="btn btn-primary" onClick={() => void openCreate()}>
            {msg.addButton}
          </button>
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
          title={msg.emptyTitle}
          action={
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                setQ('');
                setEnabledFilter([true, false]);
              }}
            >
              {MESSAGES.users.resetFilter}
            </button>
          }
        />
      )}
      {!loading && !error && filtered.length > 0 && (
        <div className="dialogue-table-wrap">
          <table className="dialogue-table">
            <caption className="sr-only">{`${msg.pageTitle} — 총 ${filtered.length}건`}</caption>
            <thead>
              <tr>
                <th scope="col">{msg.columnName}</th>
                <th scope="col">{msg.columnHost}</th>
                <th scope="col">{msg.columnMethods}</th>
                <th scope="col">{msg.columnAuth}</th>
                <th scope="col">{msg.columnSecret}</th>
                <th scope="col">{msg.columnStatus}</th>
                <th scope="col">{msg.columnReferencing}</th>
                <th scope="col">{msg.column24h}</th>
                <th scope="col">{msg.columnActions}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item) => (
                <tr key={item.id}>
                  <td>
                    <div>{item.name}</div>
                    <div className="api-connection-badge-row">
                      {item.insecureHttp && <InsecureHttpBadge />}
                      {item.personalDataLookup && <PersonalDataLookupBadge />}
                      {item.allowRawPersonalData && <RawPersonalDataBadge />}
                    </div>
                  </td>
                  <td>{item.baseUrlHost}</td>
                  <td>{item.allowedMethods.join(', ')}</td>
                  <td>{item.authType}</td>
                  <td>
                    <SecretStatusBadge status={item.secretStatus} />
                  </td>
                  <td>
                    <ConnectionEnabledBadge enabled={item.enabled} />
                    {item.circuitOpen && <CircuitOpenBadge />}
                  </td>
                  <td>{item.referencingNodeCount}</td>
                  <td>{`${item.stats24h.calls}/${item.stats24h.failures}`}</td>
                  <td>
                    {/* `security:read`/`security:write`는 항상 함께 부여된다(페이지 자체가 security:read를
                        요구) — 이 화면에 도달했다면 canWrite도 항상 true이므로 조회 전용 분기를 두지 않는다. */}
                    <KebabMenu
                      label={`${item.name} 관리`}
                      items={[
                        { label: '수정', onSelect: () => void openEdit(item) },
                        { label: item.enabled ? msg.badgeDisabled : msg.badgeEnabled, onSelect: () => void handleToggleEnabled(item) },
                        { label: MESSAGES.common.delete, onSelect: () => setDeleteTarget(item) },
                      ]}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {formOpen && !editingLoading && (
        <ApiConnectionEditModal
          key={editingId ?? 'new'}
          isOpen={formOpen}
          connection={editingDetail}
          onClose={() => setFormOpen(false)}
          onSaved={() => {
            showToast(msg.saveSuccess);
            setFormOpen(false);
            void load();
          }}
        />
      )}

      <DeleteApiConnectionConfirmDialog
        connection={deleteTarget}
        inUseDetails={deleteInUse}
        submitting={deleteSubmitting}
        onConfirm={() => void handleDelete()}
        onCancel={() => {
          setDeleteTarget(null);
          setDeleteInUse(null);
        }}
      />
    </div>
  );
}
