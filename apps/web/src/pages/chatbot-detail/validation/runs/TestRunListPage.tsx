import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import type { TestCaseSet, TestRun } from '@chat-bot/shared-types';
import { useChatbotDetailContext } from '../../../ChatbotDetailLayout';
import { useAuth } from '../../../../context/AuthContext';
import { useToast } from '../../../../components/Toast';
import { ApiError } from '../../../../api/client';
import { testSetsApi, testRunsApi } from '../../../../api/validation';
import { MESSAGES } from '../../../../constants/messages';
import { SkeletonRow } from '../../../../components/Skeleton';
import { ErrorState } from '../../../../components/ErrorState';
import { EmptyState } from '../../../../components/EmptyState';
import { RunTriggerButton } from './RunTriggerButton';
import { TestRunProgressBar } from './TestRunProgressBar';

const PAGE_SIZE = 20;
const POLL_INTERVAL_MS = 3000;

function formatElapsed(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—';
  const totalSec = Math.round(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return min > 0 ? `${min}분${sec}초` : `${sec}초`;
}

/** V3 — 실행 목록(ui-spec §4.3). 세트 필터 · 실행 진행 폴링 · 비교 대상 2건 선택. */
export function TestRunListPage(): JSX.Element {
  const { chatbot } = useChatbotDetailContext();
  const { can } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const msg = MESSAGES.validation.run;
  const canWrite = can('simulation:write') && chatbot.status !== 'ARCHIVED';

  const setIdFilter = searchParams.get('setId') ?? '';
  const [sets, setSets] = useState<TestCaseSet[]>([]);
  const [runs, setRuns] = useState<TestRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);

  const loadSets = useCallback(async () => {
    try {
      const res = await testSetsApi.list(chatbot.id, { pageSize: 20 });
      setSets(res.items);
    } catch {
      setSets([]);
    }
  }, [chatbot.id]);

  const loadRuns = useCallback(async () => {
    setError(false);
    try {
      const res = await testRunsApi.list(chatbot.id, { setId: setIdFilter || undefined, pageSize: PAGE_SIZE });
      setRuns(res.items);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [chatbot.id, setIdFilter]);

  useEffect(() => {
    void loadSets();
  }, [loadSets]);

  useEffect(() => {
    setLoading(true);
    void loadRuns();
  }, [loadRuns]);

  useEffect(() => {
    const hasActive = runs.some((r) => r.status === 'QUEUED' || r.status === 'RUNNING');
    if (!hasActive) return undefined;
    const timer = setInterval(() => void loadRuns(), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [runs, loadRuns]);

  function toggleSelect(runId: string): void {
    setSelected((prev) => {
      if (prev.includes(runId)) return prev.filter((id) => id !== runId);
      if (prev.length >= 2) return [prev[1], runId];
      return [...prev, runId];
    });
  }

  async function handlePinToggle(run: TestRun): Promise<void> {
    try {
      const updated = await testRunsApi.pin(chatbot.id, run.id, { pinned: !run.pinned });
      setRuns((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : MESSAGES.errors.generic);
    }
  }

  async function handleCancel(run: TestRun): Promise<void> {
    try {
      await testRunsApi.cancel(chatbot.id, run.id);
      await loadRuns();
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : MESSAGES.errors.generic);
    }
  }

  function handleCompare(): void {
    if (selected.length !== 2) return;
    navigate(`/chatbots/${chatbot.id}/validation/compare?baseRunId=${selected[0]}&targetRunId=${selected[1]}`);
  }

  const triggerSets = sets.map((s) => ({ id: s.id, name: s.name, caseCount: s.caseCount }));

  return (
    <div className="test-run-list-page">
      <div className="dialogue-toolbar">
        <h2>{msg.title}</h2>
        {canWrite && triggerSets.length > 0 && (
          <RunTriggerButton
            chatbotId={chatbot.id}
            sets={triggerSets}
            defaultSetId={setIdFilter || undefined}
            label={msg.newRunButton}
            onStarted={(runId) => navigate(`/chatbots/${chatbot.id}/validation/runs/${runId}`)}
          />
        )}
      </div>

      <label className="form-field--inline">
        {msg.setFilterLabel}
        <select
          value={setIdFilter}
          onChange={(e) => {
            const v = e.target.value;
            setSelected([]);
            if (v) setSearchParams({ setId: v });
            else setSearchParams({});
          }}
        >
          <option value="">{msg.setFilterAll}</option>
          {sets.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>

      {loading ? (
        <SkeletonRow />
      ) : error ? (
        <ErrorState title={MESSAGES.validation.common.loadFailed} onRetry={loadRuns} />
      ) : runs.length === 0 ? (
        <EmptyState
          title={msg.emptyTitle}
          action={
            setIdFilter && (
              <Link className="btn btn-secondary" to={`/chatbots/${chatbot.id}/validation/sets/${setIdFilter}`}>
                {msg.emptyCta}
              </Link>
            )
          }
        />
      ) : (
        <div className="import-report-table-wrap">
          <table className="import-report-table">
            <thead>
              <tr>
                <th scope="col" aria-label="선택" />
                <th scope="col">{msg.columnDate}</th>
                <th scope="col">{msg.columnMode}</th>
                <th scope="col">{msg.columnStatus}</th>
                <th scope="col">{msg.columnSummary}</th>
                <th scope="col">{msg.columnDuration}</th>
                <th scope="col">{msg.columnActions}</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => {
                const notComparable = run.status === 'CANCELLED';
                return (
                  <tr key={run.id}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={msg.selectedCount(1)}
                        disabled={notComparable}
                        title={notComparable ? msg.cancelledCheckboxTooltip : undefined}
                        checked={selected.includes(run.id)}
                        onChange={() => toggleSelect(run.id)}
                      />
                    </td>
                    <td>
                      <Link to={`/chatbots/${chatbot.id}/validation/runs/${run.id}`}>{new Date(run.createdAt).toLocaleString('ko-KR')}</Link>
                    </td>
                    <td>{msg.modeLabel[run.mode]}</td>
                    <td>
                      {msg.statusLabel[run.status]}
                      {run.status === 'CANCELLED' && ` · ${msg.cancelledProcessedLabel(run.processedCount, run.totalCount)}`}
                    </td>
                    <td>
                      {run.summary
                        ? MESSAGES.validation.set.summaryLine(run.summary.a.pass, run.summary.a.fail, run.summary.a.unresolved)
                        : (run.status === 'RUNNING' || run.status === 'QUEUED') && (
                            <TestRunProgressBar processed={run.processedCount} total={run.totalCount} progress={run.progress} />
                          )}
                    </td>
                    <td>{formatElapsed(run.elapsedMs)}</td>
                    <td>
                      {canWrite && (
                        <>
                          <button type="button" className="btn btn-secondary" onClick={() => void handlePinToggle(run)}>
                            {run.pinned ? msg.unpinAction : msg.pinAction}
                          </button>{' '}
                          {(run.status === 'QUEUED' || run.status === 'RUNNING') && (
                            <button type="button" className="btn btn-secondary" onClick={() => void handleCancel(run)}>
                              {msg.cancelAction}
                            </button>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {selected.length > 0 && (
        <div className="bulk-action-bar" role="group" aria-label={msg.selectedCount(selected.length)}>
          <span>{msg.selectedCount(selected.length)}</span>
          <button type="button" className="btn btn-primary" disabled={selected.length !== 2} aria-disabled={selected.length !== 2} onClick={handleCompare}>
            {msg.compareButton}
          </button>
          {selected.length < 2 && <span className="field-hint">{msg.compareSelectOneHint}</span>}
        </div>
      )}
    </div>
  );
}
