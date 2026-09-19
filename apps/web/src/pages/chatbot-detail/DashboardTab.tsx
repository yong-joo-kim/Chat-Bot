import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { DashboardSummary } from '@chat-bot/shared-types';
import { useChatbotDetailContext } from '../ChatbotDetailLayout';
import { statsApi } from '../../api/stats';
import { ApiError } from '../../api/client';
import { MESSAGES } from '../../constants/messages';
import { SkeletonCard, SkeletonRow } from '../../components/Skeleton';
import { ErrorState } from '../../components/ErrorState';
import { EmptyState } from '../../components/EmptyState';
import { addDaysToDateInputValue, formatDate, formatPercent, kstTodayDateInputValue } from '../../lib/date';
import { PeriodSelector, type PeriodPreset } from './PeriodSelector';
import { MetricCard } from './MetricCard';

function computeRange(preset: PeriodPreset, customFrom: string, customTo: string): { from: string; to: string } {
  const today = kstTodayDateInputValue();
  switch (preset) {
    case 'TODAY':
      return { from: today, to: today };
    case '7D':
      return { from: addDaysToDateInputValue(today, -6), to: today };
    case '30D':
      return { from: addDaysToDateInputValue(today, -29), to: today };
    case 'CUSTOM':
    default:
      return { from: customFrom || today, to: customTo || today };
  }
}

/** S2 대시보드 탭(FR-2-*, ui-spec §3.3). */
export function DashboardTab(): JSX.Element {
  const { chatbot } = useChatbotDetailContext();
  const [preset, setPreset] = useState<PeriodPreset>('7D');
  const [customFrom, setCustomFrom] = useState(addDaysToDateInputValue(kstTodayDateInputValue(), -6));
  const [customTo, setCustomTo] = useState(kstTodayDateInputValue());
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [periodError, setPeriodError] = useState<string | undefined>();
  const [fetchError, setFetchError] = useState(false);
  const inFlightRef = useRef(false);

  const fetchDashboard = useCallback(async () => {
    // AC-2-12: 연타 시 요청은 1회만 발생해야 한다.
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setLoading(true);
    const range = computeRange(preset, customFrom, customTo);
    try {
      const result = await statsApi.getDashboard({ chatbotId: chatbot.id, from: range.from, to: range.to, topN: 5 });
      setData(result);
      setPeriodError(undefined);
      setFetchError(false);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'INVALID_PERIOD') {
        // EX-2-4: 카드 영역은 직전 유효 조회 결과를 유지한다(화면을 비우지 않음).
        setPeriodError(e.message || MESSAGES.dashboard.periodInvalid);
      } else {
        setFetchError(true);
        setData(null);
      }
    } finally {
      setLoading(false);
      inFlightRef.current = false;
    }
  }, [chatbot.id, preset, customFrom, customTo]);

  useEffect(() => {
    fetchDashboard();
    // preset/기간 변경 시 재조회. fetchDashboard 자체는 값 변경마다 재생성되므로 의도적으로 생략.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatbot.id, preset, customFrom, customTo]);

  const isEmpty = !loading && data !== null && data.totalLogCount === 0;

  return (
    <div className="dashboard-tab">
      <div className="dashboard-toolbar">
        <PeriodSelector
          preset={preset}
          onPresetChange={setPreset}
          from={customFrom}
          to={customTo}
          onFromChange={setCustomFrom}
          onToChange={setCustomTo}
        />
        <button type="button" className="btn btn-secondary" onClick={fetchDashboard} disabled={loading}>
          {MESSAGES.dashboard.refresh}
        </button>
        {!loading && data && !fetchError && (
          <span className="dashboard-result-badge">
            {MESSAGES.dashboard.resultSummary(formatDate(data.periodStart), formatDate(data.periodEnd), data.totalLogCount)}
          </span>
        )}
      </div>

      {periodError && (
        <p className="field-error" role="alert">
          <span aria-hidden="true">⚠</span> {periodError}
        </p>
      )}

      {fetchError ? (
        <ErrorState title={MESSAGES.dashboard.errorTitle} onRetry={fetchDashboard} />
      ) : loading ? (
        <>
          <div className="dashboard-cards">
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </div>
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </>
      ) : data ? (
        <>
          <div className="dashboard-cards">
            <MetricCard
              label={MESSAGES.dashboard.visitCount}
              value={String(data.visitCount)}
              caption={data.visitCountBasis === 'SESSION' ? MESSAGES.dashboard.visitCaptionSession : MESSAGES.dashboard.visitCaptionLogCount}
            />
            <MetricCard label={MESSAGES.dashboard.responseRate} value={formatPercent(data.responseRate)} caption={MESSAGES.dashboard.responseCaption} />
            <MetricCard
              label={MESSAGES.dashboard.noResponseRate}
              value={formatPercent(data.noResponseRate)}
              caption={MESSAGES.dashboard.noResponseCaption}
            />
          </div>

          <section className="top-questions">
            <h2>{MESSAGES.dashboard.topQuestionsTitle(5)}</h2>
            {isEmpty ? (
              <EmptyState
                title={MESSAGES.dashboard.emptyTitle}
                description={MESSAGES.dashboard.emptyDesc}
                action={
                  <Link to={`/chatbots/${chatbot.id}/skin?section=embed`} className="btn btn-secondary">
                    {MESSAGES.dashboard.emptyCta}
                  </Link>
                }
              />
            ) : (
              <ol className="top-questions-list">
                {data.topQuestions.map((q, idx) => (
                  <li key={`${q.question}-${idx}`}>
                    {idx + 1}. {q.question} · {MESSAGES.dashboard.topQuestionCount(q.count)}
                  </li>
                ))}
              </ol>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
