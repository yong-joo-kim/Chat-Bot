import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { TestCaseResultKind, TestRun, TestRunComparisonKind, TestRunResult } from '@chat-bot/shared-types';
import { VALIDATION_LIMITS } from '@chat-bot/shared-types';
import { useChatbotDetailContext } from '../../../ChatbotDetailLayout';
import { useAuth } from '../../../../context/AuthContext';
import { useToast } from '../../../../components/Toast';
import { ApiError } from '../../../../api/client';
import { testRunsApi } from '../../../../api/validation';
import { useTestRunPolling } from '../../../../lib/useTestRunPolling';
import { MESSAGES } from '../../../../constants/messages';
import { SkeletonRow } from '../../../../components/Skeleton';
import { ErrorState } from '../../../../components/ErrorState';
import { JudgmentBadge } from '../../../../components/JudgmentBadge';
import { Pagination } from '../../../../components/Pagination';
import { ResultCsvExportButton } from '../ResultCsvExportButton';
import { ClassificationBadge } from '../compare/ClassificationBadge';
import { TestRunProgressBar } from './TestRunProgressBar';
import { TestRunSummaryBar } from './TestRunSummaryBar';
import { EnvFingerprintBadgeGroup } from './EnvFingerprintBadgeGroup';
import { TestRunResultTable } from './TestRunResultTable';
import { UnresolvedGroupPanel } from './UnresolvedGroupPanel';

const RESULT_PAGE_SIZE = 50;

function formatDuration(ms: number | null | undefined): string {
  if (!ms) return '—';
  const totalSec = Math.round(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return min > 0 ? `${min}분${sec}초` : `${sec}초`;
}

/** M2에서 A/B 각각의 판정으로부터 파생한 4분류(ONLY_IN_ONE 없음, ui-spec §4.4.2 표). */
function deriveOverlayClassification(resultA: TestCaseResultKind, resultB: TestCaseResultKind | null | undefined, diffStatus: string | null | undefined): TestRunComparisonKind {
  if (!resultB) return 'UNCHANGED';
  if (resultA === 'PASS' && resultB !== 'PASS') return 'REGRESSED';
  if (resultA !== 'PASS' && resultB === 'PASS') return 'IMPROVED';
  if (resultA !== resultB || diffStatus === 'DIFFERENT') return 'CHANGED';
  return 'UNCHANGED';
}

/** V4 — 실행 결과 상세(No.19) / M2 오버레이 비교(No.20)(ui-spec §4.4). `run.mode`로 레이아웃 분기. */
export function TestRunDetailPage(): JSX.Element {
  const { runId } = useParams<{ runId: string }>();
  const { chatbot } = useChatbotDetailContext();
  const { can } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const canWrite = can('simulation:write') && chatbot.status !== 'ARCHIVED';

  const [notFound, setNotFound] = useState(false);
  const [activeRunId, setActiveRunId] = useState<string | null>(runId ?? null);

  const fetchRun = useCallback(
    async (id: string): Promise<TestRun> => {
      try {
        return await testRunsApi.getOne(chatbot.id, id);
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) {
          setNotFound(true);
          setActiveRunId(null);
        }
        throw e;
      }
    },
    [chatbot.id],
  );

  const pollState = useTestRunPolling(activeRunId, fetchRun, { initialDelayMs: 0, intervalMs: 1500, maxWaitMs: 30 * 60 * 1000 });
  const run: TestRun | null = pollState.phase === 'idle' ? null : pollState.run;

  const [results, setResults] = useState<TestRunResult[]>([]);
  const [resultsTotal, setResultsTotal] = useState(0);
  const [resultsPage, setResultsPage] = useState(1);
  const [resultsLoading, setResultsLoading] = useState(false);
  const [failOnly, setFailOnly] = useState(true);
  const [unresolvedItems, setUnresolvedItems] = useState<TestRunResult[]>([]);
  const [regressedOnly, setRegressedOnly] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const isTerminal = run ? run.status === 'SUCCEEDED' || run.status === 'FAILED' || run.status === 'CANCELLED' : false;

  const loadResults = useCallback(async () => {
    if (!run || !runId || !isTerminal) return;
    setResultsLoading(true);
    try {
      const res = await testRunsApi.listResults(chatbot.id, runId, {
        page: resultsPage,
        pageSize: RESULT_PAGE_SIZE,
        resultA: run.mode === 'SINGLE' && failOnly ? 'FAIL' : undefined,
      });
      setResults(res.items);
      setResultsTotal(res.total);
    } catch {
      showToast(MESSAGES.errors.generic);
    } finally {
      setResultsLoading(false);
    }
  }, [chatbot.id, runId, resultsPage, failOnly, isTerminal, run, showToast]);

  useEffect(() => {
    void loadResults();
  }, [loadResults]);

  const loadUnresolved = useCallback(async () => {
    if (!run || !runId || !isTerminal || run.mode !== 'SINGLE' || (run.summary?.a.unresolved ?? 0) === 0) {
      setUnresolvedItems([]);
      return;
    }
    try {
      const res = await testRunsApi.listResults(chatbot.id, runId, { page: 1, pageSize: VALIDATION_LIMITS.maxBulkDisable, resultA: 'UNRESOLVED' });
      setUnresolvedItems(res.items);
    } catch {
      setUnresolvedItems([]);
    }
  }, [chatbot.id, runId, isTerminal, run]);

  useEffect(() => {
    void loadUnresolved();
  }, [loadUnresolved]);

  async function handleCancel(): Promise<void> {
    if (!runId) return;
    setCancelling(true);
    try {
      await testRunsApi.cancel(chatbot.id, runId);
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : MESSAGES.errors.generic);
    } finally {
      setCancelling(false);
    }
  }

  async function handleRetry(): Promise<void> {
    if (!run) return;
    try {
      const res = await testRunsApi.start(chatbot.id, run.setId, { overlaySource: 'NONE', useRag: run.useRag });
      navigate(`/chatbots/${chatbot.id}/validation/runs/${res.runId}`);
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : MESSAGES.errors.generic);
    }
  }

  function handleReturnToAugmentation(): void {
    const raw = window.sessionStorage.getItem('validationReturnTo');
    window.sessionStorage.removeItem('validationReturnTo');
    navigate(raw ?? `/chatbots/${chatbot.id}/dialogue/intents`);
  }

  if (notFound) {
    return (
      <div className="test-run-detail-page">
        <ErrorState title={MESSAGES.validation.run.notFoundTitle} />
        <p className="field-hint">{MESSAGES.validation.run.notFoundDesc}</p>
        <Link to={`/chatbots/${chatbot.id}/validation/runs`} className="btn btn-secondary">
          {MESSAGES.validation.common.backToList}
        </Link>
      </div>
    );
  }

  if (!run) return <SkeletonRow />;

  const isProgress = run.status === 'QUEUED' || run.status === 'RUNNING';
  const hasReturnTarget = Boolean(window.sessionStorage.getItem('validationReturnTo'));

  return (
    <div className="test-run-detail-page">
      <div className="dialogue-toolbar">
        <h2>{run.mode === 'SINGLE' ? MESSAGES.validation.result.title : MESSAGES.validation.overlayCompare.title}</h2>
        {isTerminal && <ResultCsvExportButton href={testRunsApi.exportUrl(chatbot.id, run.id)} />}
      </div>

      {isProgress && (
        <div className="dialogue-toolbar">
          <TestRunProgressBar processed={run.processedCount} total={run.totalCount} progress={run.progress} />
          {canWrite && (
            <button type="button" className="btn btn-secondary" onClick={() => void handleCancel()} disabled={cancelling}>
              {MESSAGES.validation.case.cancelButton}
            </button>
          )}
        </div>
      )}

      {run.status === 'FAILED' && (
        <div className="form-banner form-banner--error" role="alert">
          {MESSAGES.validation.result.failedBanner(run.failureReason ?? '')}
          {canWrite && (
            <button type="button" className="btn btn-secondary" onClick={() => void handleRetry()}>
              {MESSAGES.validation.result.retryButton}
            </button>
          )}
        </div>
      )}

      {run.status === 'CANCELLED' && (
        <div className="form-banner form-banner--error" role="status">
          {MESSAGES.validation.result.cancelledBanner(run.processedCount, run.totalCount)}
        </div>
      )}

      {isTerminal && run.status !== 'FAILED' && (
        <>
          <p className="field-hint">
            {MESSAGES.validation.result.completedCaption(
              formatDuration(run.elapsedMs),
              run.envFingerprint
                ? MESSAGES.validation.result.fingerprintLabel(
                    run.envFingerprint.assetCounts.intents,
                    run.envFingerprint.assetCounts.keywords,
                    run.envFingerprint.assetCounts.nodes,
                    run.envFingerprint.assetCounts.faqs,
                  )
                : '',
            )}
          </p>
          <EnvFingerprintBadgeGroup fingerprint={run.envFingerprint} />

          {run.mode === 'SINGLE' && run.summary && (
            <>
              <TestRunSummaryBar summary={run.summary.a} />
              <label className="form-field--inline">
                <input type="checkbox" checked={!failOnly} onChange={(e) => setFailOnly(!e.target.checked)} />
                {MESSAGES.validation.result.showAllToggle}
              </label>
              <TestRunResultTable
                chatbotId={chatbot.id}
                items={results}
                total={resultsTotal}
                page={resultsPage}
                pageSize={RESULT_PAGE_SIZE}
                onPageChange={setResultsPage}
              />
              {!resultsLoading && (
                <UnresolvedGroupPanel
                  chatbotId={chatbot.id}
                  setId={run.setId}
                  items={unresolvedItems}
                  canWrite={canWrite}
                  onDisabled={() => void loadUnresolved()}
                />
              )}
            </>
          )}

          {run.mode === 'OVERLAY_COMPARE' && run.summary?.b && (
            <>
              <p className="form-banner form-banner--info" role="status">
                <span aria-hidden="true">ℹ</span> {MESSAGES.validation.overlayCompare.safetyNotice}
              </p>
              {(run.summary.excludedSuggestions ?? 0) > 0 && (
                <p className="form-banner form-banner--info" role="status">
                  {MESSAGES.validation.overlayCompare.excludedNotice(run.summary.excludedSuggestions ?? 0)}
                </p>
              )}
              {run.degradedMode && (
                <p className="form-banner form-banner--error" role="alert">
                  {MESSAGES.validation.overlayCompare.degradedNotice}
                </p>
              )}
              <p className="test-run-summary-bar">
                {MESSAGES.validation.overlayCompare.summaryDelta(run.summary.a.pass, run.summary.b.pass, run.summary.b.pass - run.summary.a.pass)}
                {' · '}
                {MESSAGES.validation.overlayCompare.regressedCount(run.summary.regressed ?? 0)}
                {' · '}
                {MESSAGES.validation.overlayCompare.improvedCount(run.summary.improved ?? 0)}
              </p>
              <label className="form-field--inline">
                <input type="checkbox" checked={regressedOnly} onChange={(e) => setRegressedOnly(e.target.checked)} />
                {MESSAGES.validation.overlayCompare.filterRegressedOnly}
              </label>
              <p className="field-hint">{MESSAGES.validation.overlayCompare.filterRegressedOnlyHint}</p>
              <div className="compare-turn-list">
                {results
                  .map((r) => ({ r, classification: deriveOverlayClassification(r.resultA, r.resultB, r.diffStatus) }))
                  .filter(({ classification }) => !regressedOnly || classification === 'REGRESSED')
                  .map(({ r, classification }) => (
                    <div key={r.id} className="compare-turn-row">
                      <div className="compare-turn-header">
                        <span>{r.questionText}</span>
                        <ClassificationBadge value={classification} />
                      </div>
                      <div className="compare-turn-columns">
                        <div className="compare-turn-column">
                          <p className="compare-turn-column-label">{MESSAGES.validation.overlayCompare.columnA}</p>
                          <JudgmentBadge value={r.resultA} /> {r.matchedNameA ?? '—'}
                        </div>
                        <div className="compare-turn-column">
                          <p className="compare-turn-column-label">{MESSAGES.validation.overlayCompare.columnB}</p>
                          {r.resultB ? (
                            <>
                              <JudgmentBadge value={r.resultB} /> {r.matchedNameB ?? '—'}
                            </>
                          ) : (
                            '—'
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
              </div>
              <Pagination page={resultsPage} pageSize={RESULT_PAGE_SIZE} total={resultsTotal} onPageChange={setResultsPage} />
              {hasReturnTarget && (
                <button type="button" className="btn btn-secondary" onClick={handleReturnToAugmentation}>
                  {MESSAGES.validation.overlayCompare.returnToAugmentation}
                </button>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
