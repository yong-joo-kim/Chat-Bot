import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { TestRunComparison, TestRunComparisonRow } from '@chat-bot/shared-types';
import { useChatbotDetailContext } from '../../../ChatbotDetailLayout';
import { ApiError } from '../../../../api/client';
import { testRunsApi } from '../../../../api/validation';
import { MESSAGES } from '../../../../constants/messages';
import { SkeletonRow } from '../../../../components/Skeleton';
import { ErrorState } from '../../../../components/ErrorState';
import { JudgmentBadge } from '../../../../components/JudgmentBadge';
import { Pagination } from '../../../../components/Pagination';
import { ResultCsvExportButton } from '../ResultCsvExportButton';
import { ClassificationBadge } from './ClassificationBadge';
import { OnlyInOneSection } from './OnlyInOneSection';
import { EnvFingerprintDiffBanner } from './EnvFingerprintDiffBanner';

const PAGE_SIZE = 50;
const CHANGED_FILTER = 'REGRESSED,IMPROVED,CHANGED';

function CompareRow({ row, baseDate, targetDate }: { row: TestRunComparisonRow; baseDate: string; targetDate: string }): JSX.Element {
  const msg = MESSAGES.validation.compare;
  return (
    <div className="compare-turn-row">
      <div className="compare-turn-header">
        <span>{row.questionText ?? row.caseId}</span>
        <ClassificationBadge value={row.classification} />
      </div>
      <div className="compare-turn-columns">
        <div className="compare-turn-column">
          <p className="compare-turn-column-label">{msg.columnA(baseDate)}</p>
          {row.base ? <JudgmentBadge value={row.base.result} /> : '—'}
        </div>
        <div className="compare-turn-column">
          <p className="compare-turn-column-label">{msg.columnB(targetDate)}</p>
          {row.target ? <JudgmentBadge value={row.target.result} /> : '—'}
        </div>
      </div>
    </div>
  );
}

/** V5 — 실행 간 비교(No.20 M1, ui-spec §4.5). REGRESSED 우선 정렬은 서버가 보장한다. */
export function TestRunComparePage(): JSX.Element {
  const { chatbot } = useChatbotDetailContext();
  const [searchParams, setSearchParams] = useSearchParams();
  const msg = MESSAGES.validation.compare;

  const baseRunId = searchParams.get('baseRunId') ?? '';
  const targetRunId = searchParams.get('targetRunId') ?? '';

  const [page, setPage] = useState(1);
  const [showAll, setShowAll] = useState(false);
  const [data, setData] = useState<TestRunComparison | null>(null);
  const [onlyInOne, setOnlyInOne] = useState<TestRunComparisonRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);

  const load = useCallback(async () => {
    if (!baseRunId || !targetRunId) return;
    setLoading(true);
    setErrorMessage(undefined);
    try {
      const [main, only] = await Promise.all([
        testRunsApi.compare(chatbot.id, { baseRunId, targetRunId, page, pageSize: PAGE_SIZE, filter: showAll ? undefined : CHANGED_FILTER }),
        testRunsApi.compare(chatbot.id, { baseRunId, targetRunId, page: 1, pageSize: 100, filter: 'ONLY_IN_ONE' }),
      ]);
      setData(main);
      setOnlyInOne(only.items);
    } catch (e) {
      if (e instanceof ApiError && (e.code === 'TEST_RUN_NOT_COMPARABLE' || e.status === 400)) {
        setErrorMessage(e.message || msg.notComparableTitle);
      } else {
        setErrorMessage(MESSAGES.errors.generic);
      }
    } finally {
      setLoading(false);
    }
  }, [chatbot.id, baseRunId, targetRunId, page, showAll, msg.notComparableTitle]);

  useEffect(() => {
    void load();
  }, [load]);

  function handleSwap(): void {
    setSearchParams({ baseRunId: targetRunId, targetRunId: baseRunId });
    setPage(1);
  }

  if (!baseRunId || !targetRunId || (errorMessage && !data)) {
    return (
      <div className="test-run-compare-page">
        <ErrorState title={errorMessage ?? msg.notComparableTitle} onRetry={load} />
      </div>
    );
  }

  if (loading && !data) return <SkeletonRow />;
  if (!data) return <SkeletonRow />;

  const baseDate = new Date(data.base.createdAt).toLocaleString('ko-KR');
  const targetDate = new Date(data.target.createdAt).toLocaleString('ko-KR');
  const basePass = data.base.summary?.a.pass ?? 0;
  const targetPass = data.target.summary?.a.pass ?? 0;

  return (
    <div className="test-run-compare-page">
      <div className="dialogue-toolbar">
        <h2>{msg.title}</h2>
        <ResultCsvExportButton href={testRunsApi.exportUrl(chatbot.id, data.target.id)} />
      </div>
      <p>
        {msg.labelA(baseDate)} · {msg.labelB(targetDate)}{' '}
        <button type="button" className="btn btn-secondary" onClick={handleSwap}>
          {MESSAGES.validation.run.swapButton}
        </button>
      </p>

      <EnvFingerprintDiffBanner diffs={data.fingerprintDiff} />

      <p className="test-run-summary-bar">{msg.summaryDelta(basePass, targetPass, targetPass - basePass)}</p>
      <p className="field-hint">
        {msg.countsLine(data.counts.REGRESSED, data.counts.IMPROVED, data.counts.CHANGED, data.counts.UNCHANGED, data.counts.ONLY_IN_ONE)}
      </p>

      <div className="dialogue-toolbar">
        <label className="form-field--inline">
          <input type="checkbox" checked={showAll} onChange={(e) => { setShowAll(e.target.checked); setPage(1); }} />
          {msg.filterAll}
        </label>
        <span className="field-hint">{msg.sortFixedNotice}</span>
      </div>

      <div className="compare-turn-list">
        {data.items.map((row) => (
          <CompareRow key={row.caseId} row={row} baseDate={baseDate} targetDate={targetDate} />
        ))}
      </div>
      <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPageChange={setPage} />

      <OnlyInOneSection items={onlyInOne} />
    </div>
  );
}
