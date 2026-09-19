import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { IntentListItem, KeywordListItem } from '@chat-bot/shared-types';
import { useChatbotDetailContext } from '../ChatbotDetailLayout';
import { intentsApi, keywordsApi } from '../../api/dialogue';
import { ApiError } from '../../api/client';
import { useToast } from '../../components/Toast';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { SkeletonRow } from '../../components/Skeleton';
import { Pagination } from '../../components/Pagination';
import { KebabMenu } from '../../components/KebabMenu';
import { ConfirmDialog } from '../../components/Modal';
import { MESSAGES } from '../../constants/messages';
import { LinkedNodeCountBadge } from './badges';
import { IntentEditModal } from './components/IntentEditModal';
import { KeywordEditModal } from './components/KeywordEditModal';
import { BulkImportModal } from './components/BulkImportModal';
import { DeleteBlockedBanner, resolveBlockedRefKind } from './components/DeleteBlockedBanner';

type ResourceKind = 'intent' | 'keyword';

/** D2 — 의도·키워드 관리(ui-spec §4.3). `?resource=intent|keyword` 클라이언트 서브탭. */
export function IntentsKeywordsPage(): JSX.Element {
  const { chatbot } = useChatbotDetailContext();
  const { showToast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const isArchived = chatbot.status === 'ARCHIVED';
  const msg = MESSAGES.dialogue.intents;

  const resource: ResourceKind = searchParams.get('resource') === 'keyword' ? 'keyword' : 'intent';
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<(IntentListItem | KeywordListItem)[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<(IntentListItem | KeywordListItem) | null>(null);
  const [deleteBlocked, setDeleteBlocked] = useState<{ message: string; refs: { id: string; name: string }[] } | null>(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkDeleteBlocked, setBulkDeleteBlocked] = useState(false);

  const api = resource === 'intent' ? intentsApi : keywordsApi;

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await api.list(chatbot.id, { q: q || undefined, page, pageSize: 20 });
      setItems(res.items);
      setTotal(res.total);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [api, chatbot.id, q, page]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setSelectedIds([]);
    setPage(1);
  }, [resource, q]);

  useEffect(() => {
    const editParam = searchParams.get('edit');
    if (editParam) {
      setEditingId(editParam);
      setEditModalOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function switchResource(next: ResourceKind): void {
    const params = new URLSearchParams(searchParams);
    params.set('resource', next);
    params.delete('edit');
    setSearchParams(params);
  }

  function openCreate(): void {
    setEditingId(null);
    setEditModalOpen(true);
  }

  function openEdit(id: string): void {
    setEditingId(id);
    setEditModalOpen(true);
  }

  function closeEditModal(): void {
    setEditModalOpen(false);
    setEditingId(null);
    if (searchParams.get('edit')) {
      const params = new URLSearchParams(searchParams);
      params.delete('edit');
      setSearchParams(params);
    }
  }

  async function handleDeleteConfirm(): Promise<void> {
    if (!deleteTarget) return;
    try {
      await api.remove(chatbot.id, deleteTarget.id);
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

  async function handleBulkDeleteConfirm(): Promise<void> {
    try {
      await api.bulkDelete(chatbot.id, { ids: selectedIds });
      showToast(msg.bulkDeleteSuccess);
      setBulkDeleteOpen(false);
      setSelectedIds([]);
      void load();
    } catch (e) {
      if (e instanceof ApiError && (e.code === 'INTENT_IN_USE' || e.code === 'KEYWORD_IN_USE')) {
        setBulkDeleteBlocked(true);
      } else {
        showToast(e instanceof ApiError ? e.message : MESSAGES.errors.generic);
        setBulkDeleteOpen(false);
      }
    }
  }

  const allSelected = items.length > 0 && selectedIds.length === items.length;

  return (
    <div className="dialogue-intents-page">
      <div className="sub-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={resource === 'intent'}
          className={`sub-tab-button${resource === 'intent' ? ' sub-tab-button--active' : ''}`}
          onClick={() => switchResource('intent')}
        >
          {msg.tabIntent}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={resource === 'keyword'}
          className={`sub-tab-button${resource === 'keyword' ? ' sub-tab-button--active' : ''}`}
          onClick={() => switchResource('keyword')}
        >
          {msg.tabKeyword}
        </button>
      </div>

      <div className="dialogue-toolbar">
        <div className="dialogue-search-row">
          <label htmlFor="intent-search" className="sr-only">
            {msg.searchLabel}
          </label>
          <input id="intent-search" type="text" placeholder={msg.searchLabel} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {!isArchived && (
          <div className="dialogue-toolbar-actions">
            <a className="btn btn-secondary" href={api.exportUrl(chatbot.id)}>
              {msg.exportButton}
            </a>
            <button type="button" className="btn btn-secondary" onClick={() => setImportOpen(true)}>
              {msg.importButton}
            </button>
            <button type="button" className="btn btn-primary" onClick={openCreate}>
              {resource === 'intent' ? msg.addIntent : msg.addKeyword}
            </button>
          </div>
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

      {!loading && !error && items.length === 0 && (
        <EmptyState
          title={resource === 'intent' ? msg.emptyIntentTitle : msg.emptyKeywordTitle}
          description={resource === 'intent' ? msg.emptyIntentDesc : msg.emptyKeywordDesc}
          action={
            !isArchived && (
              <>
                <button type="button" className="btn btn-primary" onClick={openCreate}>
                  {resource === 'intent' ? msg.addIntent : msg.addKeyword}
                </button>{' '}
                <button type="button" className="btn btn-secondary" onClick={() => setImportOpen(true)}>
                  {msg.importCta}
                </button>
              </>
            )
          }
        />
      )}

      {!loading && !error && items.length > 0 && (
        <div className="dialogue-table-wrap">
          <table className="dialogue-table">
            <thead>
              <tr>
                <th scope="col">
                  <input
                    type="checkbox"
                    aria-label="전체 선택"
                    checked={allSelected}
                    onChange={(e) => setSelectedIds(e.target.checked ? items.map((i) => i.id) : [])}
                  />
                </th>
                <th scope="col">{msg.columnName}</th>
                <th scope="col">{msg.columnDescription}</th>
                <th scope="col">{resource === 'intent' ? msg.columnExamples : msg.columnSynonyms}</th>
                <th scope="col">{msg.columnLinkedNodes}</th>
                <th scope="col">{msg.columnUpdatedAt}</th>
                <th scope="col">{msg.columnActions}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const count = 'exampleCount' in item ? item.exampleCount : item.synonymCount;
                return (
                  <tr key={item.id}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`${item.name} 선택`}
                        checked={selectedIds.includes(item.id)}
                        onChange={(e) =>
                          setSelectedIds((prev) => (e.target.checked ? [...prev, item.id] : prev.filter((id) => id !== item.id)))
                        }
                      />
                    </td>
                    <td>
                      <button type="button" className="link-button" onClick={() => openEdit(item.id)}>
                        {item.name}
                      </button>
                    </td>
                    <td>{item.description || '—'}</td>
                    <td>
                      {count}
                      {resource === 'intent' && count === 0 && (
                        <span title={msg.emptyExampleHint} aria-label={msg.emptyExampleHint}>
                          {' '}
                          ⓘ
                        </span>
                      )}
                    </td>
                    <td>
                      <LinkedNodeCountBadge count={item.linkedNodeCount} />
                    </td>
                    <td>{new Date(item.updatedAt).toLocaleDateString('ko-KR')}</td>
                    <td>
                      {!isArchived && (
                        <KebabMenu
                          label={`${item.name} 관리`}
                          items={[
                            { label: '편집', onSelect: () => openEdit(item.id) },
                            { label: MESSAGES.common.delete, onSelect: () => setDeleteTarget(item) },
                          ]}
                        />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <Pagination page={page} pageSize={20} total={total} onPageChange={setPage} />
          {!isArchived && (
            <div className="dialogue-bulk-actions">
              <span>{msg.selectedCount(selectedIds.length)}</span>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={selectedIds.length === 0}
                onClick={() => setBulkDeleteOpen(true)}
              >
                {msg.bulkDelete}
              </button>
            </div>
          )}
        </div>
      )}

      <IntentEditModal
        isOpen={editModalOpen && resource === 'intent'}
        chatbotId={chatbot.id}
        intentId={editingId}
        onClose={closeEditModal}
        onSaved={load}
        readOnly={isArchived}
      />
      <KeywordEditModal
        isOpen={editModalOpen && resource === 'keyword'}
        chatbotId={chatbot.id}
        keywordId={editingId}
        onClose={closeEditModal}
        onSaved={load}
        readOnly={isArchived}
      />
      <BulkImportModal
        resourceType={resource === 'intent' ? 'INTENT' : 'KEYWORD'}
        chatbotId={chatbot.id}
        isOpen={importOpen}
        onClose={() => setImportOpen(false)}
        onCommitted={load}
      />

      <ConfirmDialog
        isOpen={Boolean(deleteTarget)}
        title={resource === 'intent' ? msg.deleteIntentTitle : msg.deleteKeywordTitle}
        description={deleteTarget ? msg.deleteConfirmDesc(deleteTarget.name) : ''}
        confirmLabel={MESSAGES.common.delete}
        danger
        onConfirm={handleDeleteConfirm}
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
            kind={resolveBlockedRefKind(resource, deleteBlocked.message)}
            onBeforeNavigate={() => {
              setDeleteTarget(null);
              setDeleteBlocked(null);
            }}
          />
        )}
      </ConfirmDialog>

      <ConfirmDialog
        isOpen={bulkDeleteOpen}
        title={msg.bulkDeleteTitle}
        description={msg.bulkDeleteDesc(selectedIds.length)}
        confirmLabel={MESSAGES.common.delete}
        danger
        onConfirm={handleBulkDeleteConfirm}
        onCancel={() => {
          setBulkDeleteOpen(false);
          setBulkDeleteBlocked(false);
        }}
      >
        {bulkDeleteBlocked && (
          <div className="form-banner form-banner--error" role="alert">
            {msg.bulkDeleteBlocked}
          </div>
        )}
      </ConfirmDialog>
    </div>
  );
}
