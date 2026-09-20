import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { FaqCategory, FaqEntry } from '@chat-bot/shared-types';
import { useChatbotDetailContext } from '../ChatbotDetailLayout';
import { faqsApi } from '../../api/dialogue';
import { ApiError } from '../../api/client';
import { useToast } from '../../components/Toast';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { SkeletonRow } from '../../components/Skeleton';
import { Pagination } from '../../components/Pagination';
import { KebabMenu } from '../../components/KebabMenu';
import { ConfirmDialog } from '../../components/Modal';
import { MESSAGES } from '../../constants/messages';
import { FaqCategoryBadge } from './badges';
import { FaqEditModal } from './components/FaqEditModal';
import { BulkImportModal } from './components/BulkImportModal';

const CATEGORIES: FaqCategory[] = ['FAQ', 'SMALL_TALK', 'SELF_SERVICE', 'ERROR_RESPONSE'];

/** D5 — FAQ 관리(ui-spec §4.7). */
export function FaqsPage(): JSX.Element {
  const { chatbot } = useChatbotDetailContext();
  const { showToast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const isArchived = chatbot.status === 'ARCHIVED';
  const msg = MESSAGES.dialogue.faqs;

  const [q, setQ] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<FaqCategory[]>([]);
  const [enabledOnly, setEnabledOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<FaqEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<Partial<Record<FaqCategory, number>>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [prefillQuestion, setPrefillQuestion] = useState<string | undefined>(undefined);
  const [importOpen, setImportOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<FaqEntry | null>(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await faqsApi.list(chatbot.id, {
        q: q || undefined,
        category: categoryFilter.length > 0 ? categoryFilter : undefined,
        enabled: enabledOnly ? true : undefined,
        page,
        pageSize: 20,
      });
      setItems(res.items);
      setTotal(res.total);
      setCounts(res.counts);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [chatbot.id, q, categoryFilter, enabledOnly, page]);

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

  function toggleCategory(c: FaqCategory): void {
    setCategoryFilter((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));
    setPage(1);
  }

  function closeEditModal(): void {
    setEditModalOpen(false);
    setEditingId(null);
    setPrefillQuestion(undefined);
    if (searchParams.get('edit')) {
      const params = new URLSearchParams(searchParams);
      params.delete('edit');
      setSearchParams(params);
    }
  }

  function openCreate(defaultCategory?: FaqCategory): void {
    setEditingId(null);
    setPrefillQuestion(undefined);
    setEditModalOpen(true);
    void defaultCategory;
  }

  function handleJumpToFaq(faqId: string, altQuestion: string): void {
    setEditingId(faqId);
    setPrefillQuestion(altQuestion);
    setEditModalOpen(true);
  }

  async function handleDelete(): Promise<void> {
    if (!deleteTarget) return;
    try {
      await faqsApi.remove(chatbot.id, deleteTarget.id);
      showToast(msg.deleteSuccess);
      setDeleteTarget(null);
      void load();
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : MESSAGES.errors.generic);
      setDeleteTarget(null);
    }
  }

  async function handleBulkDelete(): Promise<void> {
    try {
      await faqsApi.bulkDelete(chatbot.id, { ids: selectedIds });
      showToast(msg.deleteSuccess);
      setBulkDeleteOpen(false);
      setSelectedIds([]);
      void load();
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : MESSAGES.errors.generic);
      setBulkDeleteOpen(false);
    }
  }

  const allSelected = items.length > 0 && selectedIds.length === items.length;
  const errorResponseCount = counts.ERROR_RESPONSE ?? 0;

  return (
    <div>
      <div className="dialogue-toolbar">
        <fieldset className="status-filter">
          <legend className="sr-only">{msg.categoryFilterLabel}</legend>
          {CATEGORIES.map((c) => (
            <label key={c} className="status-filter-option">
              <input type="checkbox" checked={categoryFilter.includes(c)} onChange={() => toggleCategory(c)} />
              {MESSAGES.dialogue.faqs.categories[c]}({counts[c] ?? 0})
            </label>
          ))}
          <label className="status-filter-option">
            <input
              type="checkbox"
              checked={enabledOnly}
              onChange={(e) => {
                setEnabledOnly(e.target.checked);
                setPage(1);
              }}
            />
            {msg.enabledOnlyLabel}
          </label>
        </fieldset>
        {!isArchived && (
          <div className="dialogue-toolbar-actions">
            <a className="btn btn-secondary" href={faqsApi.exportUrl(chatbot.id)}>
              {msg.exportButton}
            </a>
            <button type="button" className="btn btn-secondary" onClick={() => setImportOpen(true)}>
              {msg.importButton}
            </button>
            <button type="button" className="btn btn-primary" onClick={() => openCreate()}>
              {msg.addButton}
            </button>
          </div>
        )}
      </div>

      <div className="dialogue-search-row" style={{ marginBottom: 16 }}>
        <label htmlFor="faq-search" className="sr-only">
          {msg.searchLabel}
        </label>
        <input
          id="faq-search"
          type="text"
          placeholder={msg.searchLabel}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
        />
      </div>

      {!loading && !error && errorResponseCount === 0 && (
        <div className="form-banner form-banner--info" role="status">
          {msg.errorResponseEmptyBanner}{' '}
          {!isArchived && (
            <button type="button" className="link-button" onClick={() => openCreate('ERROR_RESPONSE')}>
              {msg.errorResponseAddCta}
            </button>
          )}
        </div>
      )}

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
          action={
            !isArchived && (
              <>
                <button type="button" className="btn btn-primary" onClick={() => openCreate()}>
                  {msg.addButton}
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
                <th scope="col">{msg.columnCategory}</th>
                <th scope="col">{msg.columnQuestion}</th>
                <th scope="col">{msg.columnAnswer}</th>
                <th scope="col">{msg.columnAltQuestions}</th>
                <th scope="col">{msg.columnEnabled}</th>
                <th scope="col">{msg.columnUpdatedAt}</th>
                <th scope="col">{msg.columnActions}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`${item.question} 선택`}
                      checked={selectedIds.includes(item.id)}
                      onChange={(e) =>
                        setSelectedIds((prev) => (e.target.checked ? [...prev, item.id] : prev.filter((id) => id !== item.id)))
                      }
                    />
                  </td>
                  <td>
                    <FaqCategoryBadge category={item.category} />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => {
                        setEditingId(item.id);
                        setEditModalOpen(true);
                      }}
                    >
                      {item.question}
                    </button>
                  </td>
                  <td>{item.answer.length > 60 ? `${item.answer.slice(0, 60)}…` : item.answer}</td>
                  <td>{msg.altQuestionsCount(item.altQuestions.length)}</td>
                  <td>{item.enabled ? msg.enabledYes : msg.enabledNo}</td>
                  <td>{new Date(item.updatedAt).toLocaleDateString('ko-KR')}</td>
                  <td>
                    {!isArchived && (
                      <KebabMenu
                        label={`${item.question} 관리`}
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

      <FaqEditModal
        isOpen={editModalOpen}
        chatbotId={chatbot.id}
        faqId={editingId}
        prefillQuestion={prefillQuestion}
        onClose={closeEditModal}
        onSaved={load}
        readOnly={isArchived}
        isArchived={isArchived}
        onJumpToFaq={handleJumpToFaq}
      />
      <BulkImportModal resourceType="FAQ" chatbotId={chatbot.id} isOpen={importOpen} onClose={() => setImportOpen(false)} onCommitted={load} />

      <ConfirmDialog
        isOpen={Boolean(deleteTarget)}
        title={msg.deleteTitle}
        description={msg.deleteDesc}
        confirmLabel={MESSAGES.common.delete}
        danger
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
      <ConfirmDialog
        isOpen={bulkDeleteOpen}
        title={msg.bulkDeleteTitle}
        description={msg.bulkDeleteDesc(selectedIds.length)}
        confirmLabel={MESSAGES.common.delete}
        danger
        onConfirm={handleBulkDelete}
        onCancel={() => setBulkDeleteOpen(false)}
      />
    </div>
  );
}
