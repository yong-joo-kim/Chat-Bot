import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type {
  BulkResult,
  DecomposedResolveResult,
  ResolveResult,
  UnansweredQuestionDetail,
  UnansweredQuestionListItem,
  UnansweredQuestionStatus,
} from '@chat-bot/shared-types';
import { UNANSWERED_STATUS_LABELS } from '@chat-bot/shared-types';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../components/Toast';
import { learningApi } from '../../api/learning';
import { intentsApi } from '../../api/dialogue';
import { ApiError } from '../../api/client';
import { MESSAGES } from '../../constants/messages';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { SkeletonRow } from '../../components/Skeleton';
import { Pagination } from '../../components/Pagination';
import { ConfirmDialog } from '../../components/Modal';
import { useStatsShellContext } from '../stats/StatsShell';
import { UnansweredFilterBar, type UnansweredSort } from './UnansweredFilterBar';
import { BulkActionBar } from './BulkActionBar';
import { UnansweredTable } from './UnansweredTable';
import { ResolveModal, type IntentOption } from './ResolveModal';
import { BulkResolveModal } from './BulkResolveModal';
import { BulkResultPanel } from './BulkResultPanel';
import { PendingLimitBanner } from './PendingLimitBanner';
import { LearningLinkWarningBanner, type LinkWarningEntry } from './LearningLinkWarningBanner';
import { ClassifierStatusPanel } from './ClassifierStatusPanel';

const PAGE_SIZE = 20;
type EmptyKind = 'none-ever' | 'all-processed' | null;

/** L1 — 학습현황 화면(FR-15-*, ui-spec §4). VIEWER는 쓰기 액션을 렌더하지 않는다(F-7, FR-C-6). */
export function LearningQueuePage(): JSX.Element {
  const { chatbot, learningSummary, refreshLearningSummary } = useStatsShellContext();
  const { can } = useAuth();
  const { showToast } = useToast();
  const canWrite = can('dialogue:write');
  const [searchParams] = useSearchParams();
  const highlightId = searchParams.get('highlightId') ?? undefined;

  const [q, setQ] = useState('');
  const [status, setStatus] = useState<UnansweredQuestionStatus[]>(['PENDING']);
  const [recurredOnly, setRecurredOnly] = useState(false);
  const [sort, setSort] = useState<UnansweredSort>('occurredCount');
  const [page, setPage] = useState(1);

  const [items, setItems] = useState<UnansweredQuestionListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [emptyKind, setEmptyKind] = useState<EmptyKind>(null);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detailById, setDetailById] = useState<Map<string, UnansweredQuestionDetail>>(new Map());
  const [detailLoadingId, setDetailLoadingId] = useState<string | null>(null);

  const [intentOptions, setIntentOptions] = useState<IntentOption[]>([]);
  const [resolveTarget, setResolveTarget] = useState<{ question: UnansweredQuestionListItem; initialIntentName?: string } | null>(null);
  const [bulkResolveOpen, setBulkResolveOpen] = useState(false);
  const [bulkIgnoreConfirmOpen, setBulkIgnoreConfirmOpen] = useState(false);
  const [bulkResult, setBulkResult] = useState<BulkResult | null>(null);
  const [linkWarningEntries, setLinkWarningEntries] = useState<LinkWarningEntry[]>([]);

  const [highlightDetail, setHighlightDetail] = useState<UnansweredQuestionDetail | null>(null);

  useEffect(() => {
    intentsApi
      .list(chatbot.id, { pageSize: 100 })
      .then((res) => setIntentOptions(res.items.map((i) => ({ id: i.id, name: i.name }))))
      .catch(() => {
        // 의도 목록 로드 실패는 반영 모달 진입 시 다시 시도할 수 있다 — 목록 화면 자체를 막지 않는다.
      });
  }, [chatbot.id]);

  useEffect(() => {
    if (!highlightId) return;
    learningApi
      .findOne(chatbot.id, highlightId)
      .then(setHighlightDetail)
      .catch(() => setHighlightDetail(null));
  }, [chatbot.id, highlightId]);

  /** 하이라이트 카드에서 반영/무시/되돌리기를 수행한 뒤 카드 상태(상태/뱃지)를 최신화한다(M-1). */
  function refreshHighlightIfMatch(id: string): void {
    if (!highlightId || id !== highlightId) return;
    learningApi
      .findOne(chatbot.id, highlightId)
      .then(setHighlightDetail)
      .catch(() => {
        // 재조회 실패는 카드 갱신만 막을 뿐 — 목록/토스트는 각 액션 핸들러가 이미 처리했다.
      });
  }

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await learningApi.list(chatbot.id, {
        q: q || undefined,
        status,
        recurredOnly,
        sort,
        order: 'desc',
        page,
        pageSize: PAGE_SIZE,
      });
      setItems(res.items);
      setTotal(res.total);
      setSelected(new Set());

      const isDefaultFilter = status.length === 1 && status[0] === 'PENDING' && q === '' && !recurredOnly;
      if (res.total === 0 && isDefaultFilter) {
        const all = await learningApi.list(chatbot.id, { status: ['PENDING', 'RESOLVED', 'IGNORED'], page: 1, pageSize: 1 });
        setEmptyKind(all.total === 0 ? 'none-ever' : 'all-processed');
      } else {
        setEmptyKind(null);
      }
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [chatbot.id, q, status, recurredOnly, sort, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const questionTextById = useMemo(() => new Map(items.map((i) => [i.id, i.questionText])), [items]);

  function resetFilters(): void {
    setQ('');
    setStatus(['PENDING']);
    setRecurredOnly(false);
    setPage(1);
  }

  function showProcessed(): void {
    setStatus(['RESOLVED', 'IGNORED']);
    setPage(1);
  }

  async function loadDetail(id: string): Promise<void> {
    setDetailLoadingId(id);
    try {
      const detail = await learningApi.findOne(chatbot.id, id);
      setDetailById((m) => new Map(m).set(id, detail));
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : MESSAGES.errors.generic);
    } finally {
      setDetailLoadingId(null);
    }
  }

  function toggleExpand(item: UnansweredQuestionListItem): void {
    if (expandedId === item.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(item.id);
    if (!detailById.has(item.id)) void loadDetail(item.id);
  }

  function toggleSelect(id: string): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function openResolve(question: UnansweredQuestionListItem, initialIntentName?: string): void {
    setResolveTarget({ question, initialIntentName });
  }

  function handleResolved(result: ResolveResult | DecomposedResolveResult, resolveDecomposedKeywordNames?: string[]): void {
    const question = resolveTarget?.question;
    setResolveTarget(null);
    if (result.conflicts.length > 0) {
      showToast(MESSAGES.learning.conflictWarning(result.conflicts.map((c) => c.intentName).join(', ')));
    }
    showToast(result.appliedImmediately ? MESSAGES.learning.resolveSuccessImmediate : MESSAGES.learning.resolveSuccessQueued);
    if (question) {
      const newEntries: LinkWarningEntry[] = [];
      if (result.linkedNodeCount === 0) {
        newEntries.push({ id: `${result.questionId}-intent-${Date.now()}`, type: 'INTENT_UNLINKED', questionText: question.questionText, targetName: result.intentName });
      }
      // `resolve-decomposed` 결과에만 있는 필드(§11.2) — 요소분해 통합 반영 경로에서만 등장한다.
      if ('keywordLinkedNodeCount' in result && result.keywordLinkedNodeCount === 0 && result.keywordCount > 0) {
        newEntries.push({
          id: `${result.questionId}-keyword-${Date.now()}`,
          type: 'KEYWORD_UNLINKED',
          questionText: question.questionText,
          targetName: (resolveDecomposedKeywordNames ?? []).join(', ') || result.intentName,
        });
      }
      if (newEntries.length > 0) setLinkWarningEntries((prev) => [...prev, ...newEntries]);
    }
    if (question) refreshHighlightIfMatch(question.id);
    void load();
    refreshLearningSummary();
  }

  function handleAlreadyResolved(): void {
    const question = resolveTarget?.question;
    setResolveTarget(null);
    showToast(MESSAGES.learning.alreadyResolvedNotice);
    if (question) refreshHighlightIfMatch(question.id);
    void load();
  }

  async function handleIgnore(item: UnansweredQuestionListItem): Promise<void> {
    try {
      await learningApi.ignore(chatbot.id, item.id);
      showToast(MESSAGES.learning.ignoreSuccess);
      refreshHighlightIfMatch(item.id);
      void load();
      refreshLearningSummary();
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : MESSAGES.errors.generic);
    }
  }

  async function handleReopen(item: UnansweredQuestionListItem): Promise<void> {
    try {
      await learningApi.reopen(chatbot.id, item.id);
      showToast(MESSAGES.learning.reopenSuccess);
      refreshHighlightIfMatch(item.id);
      void load();
      refreshLearningSummary();
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : MESSAGES.errors.generic);
    }
  }

  function handleBulkResolveResult(result: BulkResult): void {
    setBulkResolveOpen(false);
    setBulkResult(result);
    const newEntries: LinkWarningEntry[] = result.results
      .filter((r) => r.linkedNodeCount === 0)
      .map((r) => ({
        id: `${r.questionId}-intent-${Date.now()}`,
        type: 'INTENT_UNLINKED',
        questionText: questionTextById.get(r.questionId) ?? r.questionId,
        targetName: r.intentName,
      }));
    if (newEntries.length > 0) setLinkWarningEntries((prev) => [...prev, ...newEntries]);
    void load();
    refreshLearningSummary();
  }

  async function handleBulkIgnoreConfirm(): Promise<void> {
    try {
      const result = await learningApi.bulkIgnore(chatbot.id, { ids: Array.from(selected) });
      setBulkIgnoreConfirmOpen(false);
      setBulkResult(result);
      void load();
      refreshLearningSummary();
    } catch (e) {
      setBulkIgnoreConfirmOpen(false);
      showToast(e instanceof ApiError ? e.message : MESSAGES.errors.generic);
    }
  }

  const selectedQuestions = items.filter((i) => selected.has(i.id));

  return (
    <div className="learning-queue-page">
      <h1>{MESSAGES.learning.pageTitle}</h1>

      <LearningLinkWarningBanner
        chatbotId={chatbot.id}
        entries={linkWarningEntries}
        onCloseOne={(id) => setLinkWarningEntries((prev) => prev.filter((e) => e.id !== id))}
        onCloseAll={() => setLinkWarningEntries([])}
      />

      <ClassifierStatusPanel chatbotId={chatbot.id} canWrite={canWrite} />

      {learningSummary?.limitReached && <PendingLimitBanner />}

      {highlightId && highlightDetail && !items.some((i) => i.id === highlightId) && (
        <div className="learning-highlight-card" role="status">
          <p>{MESSAGES.learning.highlightNotice}</p>
          <p>
            <strong>{highlightDetail.questionText}</strong> · {MESSAGES.learning.columnOccurred} {highlightDetail.occurredCount} ·{' '}
            {UNANSWERED_STATUS_LABELS[highlightDetail.status]}
          </p>
          {canWrite && highlightDetail.status === 'PENDING' && (
            <div className="learning-highlight-card-actions">
              <button type="button" className="btn btn-primary" onClick={() => openResolve(highlightDetail)}>
                {MESSAGES.learning.resolveAction}
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => void handleIgnore(highlightDetail)}>
                {MESSAGES.learning.ignoreAction}
              </button>
            </div>
          )}
          {canWrite && highlightDetail.status !== 'PENDING' && (
            <div className="learning-highlight-card-actions">
              <button type="button" className="btn btn-secondary" onClick={() => void handleReopen(highlightDetail)}>
                {MESSAGES.learning.reopenAction}
              </button>
            </div>
          )}
        </div>
      )}

      <UnansweredFilterBar
        q={q}
        onQChange={(v) => {
          setQ(v);
          setPage(1);
        }}
        status={status}
        onStatusChange={(v) => {
          setStatus(v.length > 0 ? v : ['PENDING']);
          setPage(1);
        }}
        recurredOnly={recurredOnly}
        onRecurredOnlyChange={(v) => {
          setRecurredOnly(v);
          setPage(1);
        }}
        sort={sort}
        onSortChange={setSort}
      />

      {canWrite && (
        <BulkActionBar
          selectedCount={selected.size}
          onBulkResolve={() => setBulkResolveOpen(true)}
          onBulkIgnore={() => setBulkIgnoreConfirmOpen(true)}
          onClearSelection={() => setSelected(new Set())}
        />
      )}

      {loading ? (
        <>
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </>
      ) : error ? (
        <ErrorState title={MESSAGES.learning.loadFailed} onRetry={load} />
      ) : items.length === 0 ? (
        emptyKind === 'none-ever' ? (
          <EmptyState title={MESSAGES.learning.emptyNoneEverTitle} description={MESSAGES.learning.emptyNoneEverDesc} />
        ) : emptyKind === 'all-processed' ? (
          <EmptyState
            title={MESSAGES.learning.emptyAllProcessedTitle}
            action={
              <button type="button" className="btn btn-secondary" onClick={showProcessed}>
                {MESSAGES.learning.emptyAllProcessedAction}
              </button>
            }
          />
        ) : (
          <EmptyState
            title={MESSAGES.learning.emptyFilteredTitle}
            action={
              <button type="button" className="btn btn-secondary" onClick={resetFilters}>
                {MESSAGES.learning.resetFilter}
              </button>
            }
          />
        )
      ) : (
        <>
          <p role="status" aria-live="polite" className="sr-only">
            {MESSAGES.learning.totalCount(total)}
          </p>
          <UnansweredTable
            items={items}
            selected={selected}
            onToggleSelect={toggleSelect}
            canWrite={canWrite}
            expandedId={expandedId}
            onToggleExpand={toggleExpand}
            detailById={detailById}
            detailLoadingId={detailLoadingId}
            onResolveClick={openResolve}
            onIgnoreClick={(item) => void handleIgnore(item)}
            onReopenClick={(item) => void handleReopen(item)}
            highlightId={highlightId}
          />
          <p>{MESSAGES.learning.totalCount(total)}</p>
          <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />
        </>
      )}

      <ResolveModal
        isOpen={Boolean(resolveTarget)}
        chatbotId={chatbot.id}
        question={resolveTarget?.question ?? null}
        intentOptions={intentOptions}
        initialIntentName={resolveTarget?.initialIntentName}
        onClose={() => setResolveTarget(null)}
        onResolved={handleResolved}
        onAlreadyResolved={handleAlreadyResolved}
        onIgnoreRequested={resolveTarget ? () => void handleIgnore(resolveTarget.question) : undefined}
        canWrite={canWrite}
      />

      <BulkResolveModal
        isOpen={bulkResolveOpen}
        chatbotId={chatbot.id}
        questions={selectedQuestions}
        intentOptions={intentOptions}
        onClose={() => setBulkResolveOpen(false)}
        onResult={handleBulkResolveResult}
      />

      <ConfirmDialog
        isOpen={bulkIgnoreConfirmOpen}
        title={MESSAGES.learning.bulkIgnoreConfirmTitle}
        description={MESSAGES.learning.bulkIgnoreConfirmDesc(selected.size)}
        confirmLabel={MESSAGES.learning.bulkIgnoreButton}
        onConfirm={() => void handleBulkIgnoreConfirm()}
        onCancel={() => setBulkIgnoreConfirmOpen(false)}
      />

      {bulkResult && (
        <BulkResultPanel result={bulkResult} chatbotId={chatbot.id} questionTextById={questionTextById} onClose={() => setBulkResult(null)} />
      )}
    </div>
  );
}
