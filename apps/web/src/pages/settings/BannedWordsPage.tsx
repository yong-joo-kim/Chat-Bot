import { useCallback, useEffect, useState } from 'react';
import type { BannedWord, BannedWordPolicy } from '@chat-bot/shared-types';
import { bannedWordsApi } from '../../api/bannedWords';
import { ApiError } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../components/Toast';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { SkeletonRow } from '../../components/Skeleton';
import { Pagination } from '../../components/Pagination';
import { KebabMenu } from '../../components/KebabMenu';
import { ConfirmDialog } from '../../components/Modal';
import { MatchTypeBadge, BannedWordPolicyBadge } from '../../components/security/badges';
import { MESSAGES } from '../../constants/messages';
import { formatDate } from '../../lib/date';
import { BannedWordFilterBar } from './banned-words/BannedWordFilterBar';
import { BannedWordFormModal } from './banned-words/BannedWordFormModal';
import { BannedWordTestPanel } from './banned-words/BannedWordTestPanel';
import { BannedWordCardList } from './banned-words/BannedWordCard';

/** B1 — 금지어 관리(security-audit-ui-spec.md §3.8). */
export function BannedWordsPage(): JSX.Element {
  const { can } = useAuth();
  const { showToast } = useToast();
  const msg = MESSAGES.bannedWords;
  const canWrite = can('security:write');

  const [q, setQ] = useState('');
  const [policy, setPolicy] = useState<BannedWordPolicy[]>([]);
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<BannedWord[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<BannedWord | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<BannedWord | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await bannedWordsApi.list({ q: q || undefined, policy: policy.length > 0 ? policy : undefined, page, pageSize: 20 });
      setItems(res.items);
      setTotal(res.total);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [q, policy, page]);

  useEffect(() => {
    void load();
  }, [load]);

  function resetFilters(): void {
    setQ('');
    setPolicy([]);
    setPage(1);
  }

  async function handleToggleEnabled(item: BannedWord): Promise<void> {
    try {
      await bannedWordsApi.update(item.id, { enabled: !item.enabled });
      void load();
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : MESSAGES.errors.generic);
    }
  }

  async function handleDelete(): Promise<void> {
    if (!deleteTarget) return;
    try {
      await bannedWordsApi.remove(deleteTarget.id);
      showToast(msg.deleteSuccess);
      setDeleteTarget(null);
      void load();
    } catch (e) {
      setDeleteTarget(null);
      showToast(e instanceof ApiError ? e.message : MESSAGES.errors.generic);
    }
  }

  return (
    <div className="settings-page">
      <h1>{msg.title}</h1>
      <div className="dialogue-toolbar">
        <BannedWordFilterBar q={q} policy={policy} onQChange={(v) => { setQ(v); setPage(1); }} onPolicyChange={(v) => { setPolicy(v); setPage(1); }} />
        {canWrite && (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            {msg.addButton}
          </button>
        )}
      </div>

      {loading && (
        <>
          <SkeletonRow />
          <SkeletonRow />
        </>
      )}
      {!loading && error && <ErrorState title={msg.loadFailed} onRetry={load} />}
      {!loading && !error && items.length === 0 && total === 0 && q === '' && policy.length === 0 && (
        <EmptyState
          title={msg.emptyTitle}
          description={msg.emptyDesc}
          action={
            canWrite && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  setEditing(null);
                  setFormOpen(true);
                }}
              >
                {msg.addButton}
              </button>
            )
          }
        />
      )}
      {!loading && !error && items.length === 0 && (q !== '' || policy.length > 0) && (
        <EmptyState
          title={msg.emptyTitle}
          action={
            <button type="button" className="btn btn-secondary" onClick={resetFilters}>
              {MESSAGES.users.resetFilter}
            </button>
          }
        />
      )}
      {!loading && !error && items.length > 0 && (
        <div className="dialogue-table-wrap">
          <table className="dialogue-table desktop-only">
            <thead>
              <tr>
                <th scope="col">{msg.columnWord}</th>
                <th scope="col">{msg.columnMatchType}</th>
                <th scope="col">{msg.columnPolicy}</th>
                <th scope="col">{msg.columnEnabled}</th>
                <th scope="col">{msg.columnDescription}</th>
                <th scope="col">{msg.columnUpdatedAt}</th>
                <th scope="col">{msg.columnActions}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>{item.word}</td>
                  <td>
                    <MatchTypeBadge matchType={item.matchType} />
                  </td>
                  <td>
                    <BannedWordPolicyBadge policy={item.policy} />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="link-button"
                      disabled={!canWrite}
                      aria-pressed={item.enabled}
                      onClick={() => void handleToggleEnabled(item)}
                    >
                      {item.enabled ? msg.inUse : msg.notInUse}
                    </button>
                  </td>
                  <td>{item.description || '—'}</td>
                  <td>{formatDate(item.updatedAt)}</td>
                  <td>
                    {canWrite && (
                      <KebabMenu
                        label={`${item.word} 관리`}
                        items={[
                          {
                            label: '편집',
                            onSelect: () => {
                              setEditing(item);
                              setFormOpen(true);
                            },
                          },
                          { label: MESSAGES.common.delete, onSelect: () => setDeleteTarget(item) },
                        ]}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <BannedWordCardList
            items={items}
            loading={false}
            canWrite={canWrite}
            onToggleEnabled={(item) => void handleToggleEnabled(item)}
            onEdit={(item) => {
              setEditing(item);
              setFormOpen(true);
            }}
            onDelete={(item) => setDeleteTarget(item)}
          />
          <Pagination page={page} pageSize={20} total={total} onPageChange={setPage} />
        </div>
      )}

      <BannedWordTestPanel />

      <BannedWordFormModal
        isOpen={formOpen}
        editing={editing}
        onClose={() => setFormOpen(false)}
        onSaved={() => {
          showToast(msg.saveSuccess);
          setFormOpen(false);
          void load();
        }}
      />

      <ConfirmDialog
        isOpen={Boolean(deleteTarget)}
        title={msg.deleteTitle}
        description={deleteTarget ? msg.deleteDesc(deleteTarget.word) : ''}
        confirmLabel={MESSAGES.common.delete}
        danger
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
