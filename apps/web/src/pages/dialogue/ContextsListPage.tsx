import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ContextListItem } from '@chat-bot/shared-types';
import { useChatbotDetailContext } from '../ChatbotDetailLayout';
import { contextsApi } from '../../api/dialogue';
import { ApiError } from '../../api/client';
import { useToast } from '../../components/Toast';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { SkeletonRow } from '../../components/Skeleton';
import { Pagination } from '../../components/Pagination';
import { KebabMenu } from '../../components/KebabMenu';
import { ConfirmDialog } from '../../components/Modal';
import { MESSAGES } from '../../constants/messages';
import { DeleteBlockedBanner } from './components/DeleteBlockedBanner';

/** D4 — 컨텍스트(멀티턴·슬롯필링) 목록(ui-spec §4.6). */
export function ContextsListPage(): JSX.Element {
  const { chatbot } = useChatbotDetailContext();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const isArchived = chatbot.status === 'ARCHIVED';
  const msg = MESSAGES.dialogue.contexts;

  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<ContextListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ContextListItem | null>(null);
  const [deleteBlocked, setDeleteBlocked] = useState<{ message: string; refs: { id: string; name: string }[] } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await contextsApi.list(chatbot.id, { q: q || undefined, page, pageSize: 20 });
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

  async function handleDelete(): Promise<void> {
    if (!deleteTarget) return;
    try {
      await contextsApi.remove(chatbot.id, deleteTarget.id);
      showToast(msg.deleteSuccess);
      setDeleteTarget(null);
      setDeleteBlocked(null);
      void load();
    } catch (e) {
      if (e instanceof ApiError && e.details && e.details.length > 0) {
        setDeleteBlocked({ message: e.message, refs: e.details.map((d) => ({ id: d.field, name: d.message })) });
      } else {
        showToast(e instanceof ApiError ? e.message : MESSAGES.errors.generic);
        setDeleteTarget(null);
      }
    }
  }

  return (
    <div>
      <div className="dialogue-toolbar">
        <div className="dialogue-search-row">
          <label htmlFor="context-search" className="sr-only">
            {msg.searchLabel}
          </label>
          <input
            id="context-search"
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
          <button type="button" className="btn btn-primary" onClick={() => navigate(`/chatbots/${chatbot.id}/dialogue/contexts/new`)}>
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
              <button type="button" className="btn btn-primary" onClick={() => navigate(`/chatbots/${chatbot.id}/dialogue/contexts/new`)}>
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
                <th scope="col">{msg.columnName}</th>
                <th scope="col">{msg.columnDescription}</th>
                <th scope="col">{msg.columnSlotCount}</th>
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
                      onClick={() => navigate(`/chatbots/${chatbot.id}/dialogue/contexts/${item.id}`)}
                    >
                      {item.name}
                    </button>
                  </td>
                  <td>{item.description || '—'}</td>
                  <td>{msg.slotCount(item.slotCount)}</td>
                  <td>{new Date(item.updatedAt).toLocaleDateString('ko-KR')}</td>
                  <td>
                    {!isArchived && (
                      <KebabMenu
                        label={`${item.name} 관리`}
                        items={[
                          { label: '편집', onSelect: () => navigate(`/chatbots/${chatbot.id}/dialogue/contexts/${item.id}`) },
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

      <ConfirmDialog
        isOpen={Boolean(deleteTarget)}
        title={msg.deleteTitle}
        description={deleteTarget ? msg.deleteDesc(deleteTarget.name) : ''}
        confirmLabel={MESSAGES.common.delete}
        danger
        onConfirm={handleDelete}
        onCancel={() => {
          setDeleteTarget(null);
          setDeleteBlocked(null);
        }}
      >
        {deleteBlocked && (
          <DeleteBlockedBanner
            chatbotId={chatbot.id}
            message={deleteBlocked.message}
            refs={deleteBlocked.refs}
            kind="node"
            onBeforeNavigate={() => {
              setDeleteTarget(null);
              setDeleteBlocked(null);
            }}
          />
        )}
      </ConfirmDialog>
    </div>
  );
}
