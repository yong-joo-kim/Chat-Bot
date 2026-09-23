import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { TestCaseSet } from '@chat-bot/shared-types';
import { VALIDATION_LIMITS } from '@chat-bot/shared-types';
import { useChatbotDetailContext } from '../../../ChatbotDetailLayout';
import { useAuth } from '../../../../context/AuthContext';
import { useToast } from '../../../../components/Toast';
import { ApiError } from '../../../../api/client';
import { testSetsApi, testRunsApi } from '../../../../api/validation';
import { MESSAGES } from '../../../../constants/messages';
import { SkeletonCard } from '../../../../components/Skeleton';
import { ErrorState } from '../../../../components/ErrorState';
import { EmptyState } from '../../../../components/EmptyState';
import { KebabMenu } from '../../../../components/KebabMenu';
import { ConfirmDialog } from '../../../../components/Modal';
import { TestSetFormModal } from './TestSetFormModal';

/** V1 — TC 세트 목록(ui-spec §4.1). */
export function TestSetListPage(): JSX.Element {
  const { chatbot } = useChatbotDetailContext();
  const { can } = useAuth();
  const { showToast } = useToast();
  const msg = MESSAGES.validation.set;
  const canWrite = can('simulation:write') && chatbot.status !== 'ARCHIVED';

  const [sets, setSets] = useState<TestCaseSet[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<'create' | 'edit'>('create');
  const [editTarget, setEditTarget] = useState<TestCaseSet | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [nameError, setNameError] = useState<string | undefined>(undefined);

  const [deleteTarget, setDeleteTarget] = useState<TestCaseSet | null>(null);
  const [deleteRunCount, setDeleteRunCount] = useState(0);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await testSetsApi.list(chatbot.id, { pageSize: VALIDATION_LIMITS.maxSetsPerChatbot });
      setSets(res.items);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [chatbot.id]);

  useEffect(() => {
    void load();
  }, [load]);

  function openCreate(): void {
    setFormMode('create');
    setEditTarget(null);
    setNameError(undefined);
    setFormOpen(true);
  }

  function openEdit(set: TestCaseSet): void {
    setFormMode('edit');
    setEditTarget(set);
    setNameError(undefined);
    setFormOpen(true);
  }

  async function handleSubmit(values: { name: string; description: string }): Promise<void> {
    setSubmitting(true);
    setNameError(undefined);
    try {
      if (formMode === 'create') {
        await testSetsApi.create(chatbot.id, { name: values.name, description: values.description || undefined });
        showToast(msg.createSuccess);
      } else if (editTarget) {
        await testSetsApi.update(chatbot.id, editTarget.id, { name: values.name, description: values.description || null });
        showToast(msg.updateSuccess);
      }
      setFormOpen(false);
      await load();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setNameError(msg.nameDuplicateError);
      } else {
        showToast(e instanceof ApiError ? e.message : MESSAGES.errors.generic);
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function openDelete(set: TestCaseSet): Promise<void> {
    setDeleteTarget(set);
    try {
      const runs = await testRunsApi.list(chatbot.id, { setId: set.id, pageSize: 1 });
      setDeleteRunCount(runs.total);
    } catch {
      setDeleteRunCount(0);
    }
  }

  async function handleDeleteConfirm(): Promise<void> {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await testSetsApi.remove(chatbot.id, deleteTarget.id);
      showToast(msg.deleteSuccess);
      setDeleteTarget(null);
      await load();
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : MESSAGES.errors.generic);
    } finally {
      setDeleting(false);
    }
  }

  const atLimit = sets.length >= VALIDATION_LIMITS.maxSetsPerChatbot;

  return (
    <div className="test-set-list-page">
      <div className="dialogue-toolbar">
        <h2>{msg.title}</h2>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!canWrite || atLimit}
          aria-disabled={!canWrite || atLimit}
          title={atLimit ? msg.limitReachedReason : undefined}
          onClick={openCreate}
        >
          {msg.createButton}
        </button>
      </div>
      <p className="field-hint">{msg.countCaption(VALIDATION_LIMITS.maxSetsPerChatbot, sets.length)}</p>

      {loading ? (
        <div className="dashboard-cards">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : error ? (
        <ErrorState title={msg.notFoundInList} onRetry={load} />
      ) : sets.length === 0 ? (
        <EmptyState
          title={msg.emptyTitle}
          description={msg.emptyDesc}
          action={
            canWrite && (
              <button type="button" className="btn btn-primary" onClick={openCreate}>
                {msg.createButton}
              </button>
            )
          }
        />
      ) : (
        <ul className="test-set-card-list">
          {sets.map((set) => (
            <li key={set.id} className="test-set-card">
              <Link to={`/chatbots/${chatbot.id}/validation/sets/${set.id}`} className="test-set-card-link">
                <span className="test-set-card-name">{set.name}</span>
                {set.description && <span className="test-set-card-desc">{set.description}</span>}
                <span className="test-set-card-count">{msg.caseCountLabel(set.caseCount)}</span>
              </Link>
              <div className="test-set-card-actions">
                <Link to={`/chatbots/${chatbot.id}/validation/sets/${set.id}`} className="btn btn-secondary">
                  {msg.openButton}
                </Link>
                {canWrite && (
                  <KebabMenu
                    label={msg.kebabLabel(set.name)}
                    items={[
                      { label: msg.menuRename, onSelect: () => openEdit(set) },
                      { label: msg.menuDelete, onSelect: () => void openDelete(set) },
                    ]}
                  />
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <TestSetFormModal
        mode={formMode}
        isOpen={formOpen}
        initial={editTarget}
        submitting={submitting}
        nameError={nameError}
        onSubmit={handleSubmit}
        onClose={() => setFormOpen(false)}
      />

      <ConfirmDialog
        isOpen={deleteTarget !== null}
        title={msg.deleteTitle}
        description={deleteTarget ? msg.deleteDesc(deleteTarget.caseCount, deleteRunCount) : ''}
        confirmLabel={MESSAGES.common.delete}
        danger
        confirmDisabled={deleting}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
