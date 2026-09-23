import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { HomonymListItem } from '@chat-bot/shared-types';
import { useChatbotDetailContext } from '../ChatbotDetailLayout';
import { homonymsApi } from '../../api/dialogue';
import { ApiError } from '../../api/client';
import { useToast } from '../../components/Toast';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { SkeletonRow } from '../../components/Skeleton';
import { Pagination } from '../../components/Pagination';
import { KebabMenu } from '../../components/KebabMenu';
import { ConfirmDialog } from '../../components/Modal';
import { MESSAGES } from '../../constants/messages';
import { HomonymPolicyBadge } from './badges';
import { HomonymEditModal } from './components/HomonymEditModal';
import { ScheduleConflictBanner } from '../../components/ScheduleConflictBanner';

/** D3 — 동음이의어/다의어 사전 목록(ui-spec §4.5). */
export function HomonymsPage(): JSX.Element {
  const { chatbot } = useChatbotDetailContext();
  const { showToast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const isArchived = chatbot.status === 'ARCHIVED';
  const msg = MESSAGES.dialogue.homonyms;

  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<HomonymListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<HomonymListItem | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await homonymsApi.list(chatbot.id, { q: q || undefined, page, pageSize: 20 });
      setItems(res.items);
      setTotal(res.total);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [chatbot.id, q, page]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const editParam = searchParams.get('edit');
    if (editParam) {
      setEditingId(editParam);
      setEditModalOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function closeEditModal(): void {
    setEditModalOpen(false);
    setEditingId(null);
    if (searchParams.get('edit')) {
      const params = new URLSearchParams(searchParams);
      params.delete('edit');
      setSearchParams(params);
    }
  }

  async function handleDelete(): Promise<void> {
    if (!deleteTarget) return;
    try {
      await homonymsApi.remove(chatbot.id, deleteTarget.id);
      showToast(msg.deleteSuccess);
      setDeleteTarget(null);
      void load();
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : MESSAGES.errors.generic);
      setDeleteTarget(null);
    }
  }

  return (
    <div>
      <ScheduleConflictBanner chatbotId={chatbot.id} />
      <div className="dialogue-toolbar">
        <div className="dialogue-search-row">
          <label htmlFor="homonym-search" className="sr-only">
            {msg.searchLabel}
          </label>
          <input
            id="homonym-search"
            type="text"
            placeholder={msg.searchLabel}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
          />
        </div>
        {!isArchived && (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              setEditingId(null);
              setEditModalOpen(true);
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
      {!loading && !error && items.length === 0 && (
        <EmptyState
          title={msg.emptyTitle}
          description={msg.emptyDesc}
          action={
            !isArchived && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  setEditingId(null);
                  setEditModalOpen(true);
                }}
              >
                {msg.addButton}
              </button>
            )
          }
        />
      )}
      {!loading && !error && items.length > 0 && (
        <div className="dialogue-table-wrap">
          <table className="dialogue-table">
            <thead>
              <tr>
                <th scope="col">{msg.columnWord}</th>
                <th scope="col">{msg.columnMeaningCount}</th>
                <th scope="col">{msg.columnPolicy}</th>
                <th scope="col">{msg.columnUpdatedAt}</th>
                <th scope="col">{msg.columnActions}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => {
                        setEditingId(item.id);
                        setEditModalOpen(true);
                      }}
                    >
                      {item.word}
                    </button>
                  </td>
                  <td>{msg.meaningCount(item.meaningCount)}</td>
                  <td>
                    <HomonymPolicyBadge policy={item.policy} />
                  </td>
                  <td>{new Date(item.updatedAt).toLocaleDateString('ko-KR')}</td>
                  <td>
                    {!isArchived && (
                      <KebabMenu
                        label={`${item.word} 관리`}
                        items={[
                          { label: '편집', onSelect: () => { setEditingId(item.id); setEditModalOpen(true); } },
                          { label: MESSAGES.common.delete, onSelect: () => setDeleteTarget(item) },
                        ]}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination page={page} pageSize={20} total={total} onPageChange={setPage} />
        </div>
      )}

      <HomonymEditModal
        isOpen={editModalOpen}
        chatbotId={chatbot.id}
        homonymId={editingId}
        onClose={closeEditModal}
        onSaved={load}
        readOnly={isArchived}
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
