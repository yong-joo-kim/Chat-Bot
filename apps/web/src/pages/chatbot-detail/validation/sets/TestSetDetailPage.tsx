import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import type { TestCase, TestCaseSet, TestRun } from '@chat-bot/shared-types';
import { VALIDATION_LIMITS } from '@chat-bot/shared-types';
import { useChatbotDetailContext } from '../../../ChatbotDetailLayout';
import { useAuth } from '../../../../context/AuthContext';
import { useToast } from '../../../../components/Toast';
import { ApiError } from '../../../../api/client';
import { testSetsApi, testCasesApi, testRunsApi } from '../../../../api/validation';
import { MESSAGES } from '../../../../constants/messages';
import { SkeletonRow } from '../../../../components/Skeleton';
import { ErrorState } from '../../../../components/ErrorState';
import { EmptyState } from '../../../../components/EmptyState';
import { ConfirmDialog } from '../../../../components/Modal';
import { TestCaseTable } from './TestCaseTable';
import { TestCaseFormModal, type TestCaseFormValues } from './TestCaseFormModal';
import { TestCaseImportModal } from './TestCaseImportModal';
import { RecentRunsPreview } from './RecentRunsPreview';
import { RunTriggerButton } from '../runs/RunTriggerButton';

const PAGE_SIZE = 50;

/** V2 — TC 세트 상세(TC 표 + 대량 업로드 + 실행 시작, ui-spec §4.2). */
export function TestSetDetailPage(): JSX.Element {
  const { setId } = useParams<{ setId: string }>();
  const { chatbot } = useChatbotDetailContext();
  const { can } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const msg = MESSAGES.validation.case;
  const canWrite = can('simulation:write') && chatbot.status !== 'ARCHIVED';

  const [set, setSet] = useState<TestCaseSet | null>(null);
  const [chatbotTotalCases, setChatbotTotalCases] = useState(0);
  const [setLoading, setSetLoading] = useState(true);
  const [setNotFound, setSetNotFound] = useState(false);

  const [cases, setCases] = useState<TestCase[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [casesLoading, setCasesLoading] = useState(true);
  const [casesError, setCasesError] = useState(false);
  const [enabledFilter, setEnabledFilter] = useState<'ALL' | 'true' | 'false'>('ALL');
  const [search, setSearch] = useState('');

  const [recentRuns, setRecentRuns] = useState<TestRun[]>([]);

  const [formOpen, setFormOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<TestCase | null>(null);
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | undefined>(undefined);
  const [deleteTarget, setDeleteTarget] = useState<TestCase | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const loadSet = useCallback(async () => {
    if (!setId) return;
    setSetLoading(true);
    setSetNotFound(false);
    try {
      const res = await testSetsApi.list(chatbot.id, { pageSize: VALIDATION_LIMITS.maxSetsPerChatbot });
      const found = res.items.find((s) => s.id === setId);
      if (!found) {
        setSetNotFound(true);
      } else {
        setSet(found);
        setChatbotTotalCases(res.items.reduce((sum, s) => sum + s.caseCount, 0));
      }
    } catch {
      setSetNotFound(true);
    } finally {
      setSetLoading(false);
    }
  }, [chatbot.id, setId]);

  const loadCases = useCallback(async () => {
    if (!setId) return;
    setCasesLoading(true);
    setCasesError(false);
    try {
      const res = await testCasesApi.list(chatbot.id, setId, {
        page,
        pageSize: PAGE_SIZE,
        enabled: enabledFilter === 'ALL' ? undefined : enabledFilter === 'true',
        q: search || undefined,
      });
      setCases(res.items);
      setTotal(res.total);
    } catch {
      setCasesError(true);
    } finally {
      setCasesLoading(false);
    }
  }, [chatbot.id, setId, page, enabledFilter, search]);

  const loadRecentRuns = useCallback(async () => {
    if (!setId) return;
    try {
      const res = await testRunsApi.list(chatbot.id, { setId, pageSize: 5 });
      setRecentRuns(res.items);
    } catch {
      setRecentRuns([]);
    }
  }, [chatbot.id, setId]);

  useEffect(() => {
    void loadSet();
  }, [loadSet]);
  useEffect(() => {
    void loadCases();
  }, [loadCases]);
  useEffect(() => {
    void loadRecentRuns();
  }, [loadRecentRuns]);

  function openCreate(): void {
    setEditTarget(null);
    setFormError(undefined);
    setFormOpen(true);
  }
  function openEdit(tc: TestCase): void {
    setEditTarget(tc);
    setFormError(undefined);
    setFormOpen(true);
  }

  async function handleFormSubmit(values: TestCaseFormValues): Promise<void> {
    if (!setId) return;
    setFormSubmitting(true);
    setFormError(undefined);
    try {
      if (editTarget) {
        await testCasesApi.update(chatbot.id, setId, editTarget.id, {
          messages: values.messages,
          expectedKind: values.expectedKind,
          expectedTargetId: values.expectedTargetId,
          expectedAnswerNote: values.expectedAnswerNote || null,
          enabled: values.enabled,
        });
        showToast(msg.updateSuccess);
      } else {
        await testCasesApi.create(chatbot.id, setId, {
          messages: values.messages,
          expectedKind: values.expectedKind,
          expectedTargetId: values.expectedTargetId ?? undefined,
          expectedAnswerNote: values.expectedAnswerNote || undefined,
          enabled: values.enabled,
        });
        showToast(msg.createSuccess);
      }
      setFormOpen(false);
      await Promise.all([loadCases(), loadSet()]);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'TEST_CASE_LIMIT_EXCEEDED') {
        setFormError(msg.limitExceededError);
      } else if (e instanceof ApiError && e.code === 'DUPLICATE_NAME') {
        setFormError(msg.duplicateError);
      } else {
        showToast(e instanceof ApiError ? e.message : MESSAGES.errors.generic);
      }
    } finally {
      setFormSubmitting(false);
    }
  }

  async function handleDeleteConfirm(): Promise<void> {
    if (!deleteTarget || !setId) return;
    try {
      await testCasesApi.remove(chatbot.id, setId, deleteTarget.id);
      showToast(msg.deleteSuccess);
      setDeleteTarget(null);
      await Promise.all([loadCases(), loadSet()]);
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : MESSAGES.errors.generic);
    }
  }

  if (setLoading) return <SkeletonRow />;
  if (setNotFound || !set) {
    return <ErrorState title={MESSAGES.validation.set.notFoundInList} onRetry={loadSet} />;
  }

  const hasInProgressRun = recentRuns.some((r) => r.status === 'QUEUED' || r.status === 'RUNNING');

  return (
    <div className="test-set-detail-page">
      <div className="dialogue-toolbar">
        <div>
          <h2>{set.name}</h2>
          {set.description && <p className="field-hint">{set.description}</p>}
        </div>
        <Link to={`/chatbots/${chatbot.id}/validation/runs?setId=${set.id}`} className="btn btn-secondary">
          {msg.viewAllRuns}
        </Link>
      </div>

      <p className="field-hint">
        {msg.limitBadge(set.caseCount, VALIDATION_LIMITS.maxCasesPerSet, chatbotTotalCases, VALIDATION_LIMITS.maxCasesPerChatbot)}
      </p>

      {hasInProgressRun && (
        <div className="form-banner form-banner--info" role="status" aria-live="polite">
          {msg.runningBannerText(
            recentRuns.find((r) => r.status === 'RUNNING')?.processedCount ?? 0,
            recentRuns.find((r) => r.status === 'RUNNING')?.totalCount ?? 0,
          )}
        </div>
      )}

      <div className="dialogue-toolbar-actions">
        {canWrite && (
          <button type="button" className="btn btn-secondary" onClick={openCreate} disabled={set.caseCount >= VALIDATION_LIMITS.maxCasesPerSet}>
            {msg.addButton}
          </button>
        )}
        {canWrite && (
          <button type="button" className="btn btn-secondary" onClick={() => setImportOpen(true)}>
            {msg.importButton}
          </button>
        )}
        <a className="btn btn-secondary" href={testCasesApi.exportUrl(chatbot.id, set.id)}>
          {msg.exportButton}
        </a>
        <a className="btn btn-secondary" href={`${testSetsApi.templateUrl(chatbot.id, 'csv')}`}>
          {msg.templateButton}
        </a>
        {canWrite && (
          <RunTriggerButton
            chatbotId={chatbot.id}
            sets={[{ id: set.id, name: set.name, caseCount: set.caseCount }]}
            defaultSetId={set.id}
            disabled={set.caseCount === 0 || hasInProgressRun}
            disabledReason={set.caseCount === 0 ? msg.runDisabledEmptyReason : hasInProgressRun ? msg.runDisabledInProgressReason : undefined}
            onStarted={(runId) => navigate(`/chatbots/${chatbot.id}/validation/runs/${runId}`)}
          />
        )}
      </div>

      <div className="dialogue-toolbar">
        <label className="form-field--inline">
          {msg.enabledFilterLabel}
          <select
            value={enabledFilter}
            onChange={(e) => {
              setPage(1);
              setEnabledFilter(e.target.value as 'ALL' | 'true' | 'false');
            }}
          >
            <option value="ALL">{msg.filterAllLabel}</option>
            <option value="true">{msg.filterEnabledOnlyLabel}</option>
            <option value="false">{msg.filterDisabledOnlyLabel}</option>
          </select>
        </label>
        <label className="form-field--inline">
          {msg.searchLabel}
          <input
            type="search"
            placeholder={msg.searchPlaceholder}
            value={search}
            onChange={(e) => {
              setPage(1);
              setSearch(e.target.value);
            }}
          />
        </label>
      </div>

      {casesLoading ? (
        <SkeletonRow />
      ) : casesError ? (
        <ErrorState title={MESSAGES.validation.common.loadFailed} onRetry={loadCases} />
      ) : cases.length === 0 && total === 0 ? (
        <EmptyState
          title={msg.emptyTitle}
          description={msg.emptyDesc}
          action={
            canWrite && (
              <div className="dialogue-toolbar-actions">
                <button type="button" className="btn btn-primary" onClick={openCreate}>
                  {msg.addButton}
                </button>
                <button type="button" className="btn btn-secondary" onClick={() => setImportOpen(true)}>
                  {msg.importButton}
                </button>
              </div>
            )
          }
        />
      ) : (
        <TestCaseTable
          items={cases}
          total={total}
          page={page}
          pageSize={PAGE_SIZE}
          canWrite={canWrite}
          onPageChange={setPage}
          onEdit={openEdit}
          onDelete={setDeleteTarget}
        />
      )}

      <RecentRunsPreview chatbotId={chatbot.id} runs={recentRuns} />

      <TestCaseFormModal
        chatbotId={chatbot.id}
        isOpen={formOpen}
        initial={editTarget}
        submitting={formSubmitting}
        errorMessage={formError}
        onSubmit={handleFormSubmit}
        onClose={() => setFormOpen(false)}
      />

      <TestCaseImportModal
        chatbotId={chatbot.id}
        setId={set.id}
        isOpen={importOpen}
        onClose={() => setImportOpen(false)}
        onCommitted={() => {
          setImportOpen(false);
          void Promise.all([loadCases(), loadSet()]);
        }}
      />

      <ConfirmDialog
        isOpen={deleteTarget !== null}
        title={msg.deleteConfirmTitle}
        description={msg.deleteConfirmDesc}
        confirmLabel={MESSAGES.common.delete}
        danger
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
