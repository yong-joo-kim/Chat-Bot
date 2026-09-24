import { useCallback, useEffect, useState } from 'react';
import type { StatsDistribution, StatsGranularity, StatsQuestions, StatsSummary } from '@chat-bot/shared-types';
import { useChatbotDetailContext } from '../ChatbotDetailLayout';
import { statsApi } from '../../api/stats';
import { ApiError } from '../../api/client';
import { MESSAGES } from '../../constants/messages';
import { SkeletonCard, SkeletonRow } from '../../components/Skeleton';
import { ErrorState } from '../../components/ErrorState';
import { EmptyState } from '../../components/EmptyState';
import { MetricCard } from '../chatbot-detail/MetricCard';
import { formatPercent } from '../../lib/date';
import { GranularityPeriodControl } from './GranularityPeriodControl';
import { StatsTrendChart } from './StatsTrendChart';
import { ResponseSourceDistribution } from './ResponseSourceDistribution';
import { ChannelDistribution } from './ChannelDistribution';
import { HourWeekdayPanel } from './HourWeekdayPanel';
import { TopQuestionsPanel } from './TopQuestionsPanel';
import { IntentMatchSection } from './IntentMatchSection';
import { useLatestRequest } from '../../lib/useLatestRequest';

interface AsyncSlice<T> {
  loading: boolean;
  error: boolean;
  periodError?: string;
  data: T | null;
}

function initialSlice<T>(): AsyncSlice<T> {
  return { loading: true, error: false, data: null };
}

/** S1 — 기본 통계 화면(FR-14-*, stats-learning-ui-spec.md §3). 3개 API는 독립 호출·부분 렌더된다(F-3). */
export function StatsOverviewPage(): JSX.Element {
  const { chatbot } = useChatbotDetailContext();
  const [granularity, setGranularity] = useState<StatsGranularity>('DAY');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const [summarySlice, setSummarySlice] = useState<AsyncSlice<StatsSummary>>(initialSlice);
  const [distributionSlice, setDistributionSlice] = useState<AsyncSlice<StatsDistribution>>(initialSlice);
  const [questionsSlice, setQuestionsSlice] = useState<AsyncSlice<StatsQuestions>>(initialSlice);
  const [announce, setAnnounce] = useState('');

  // 기간/세분화를 빠르게 전환할 때 늦게 도착한 이전 요청이 최신 결과를 덮어쓰지 않도록 하는 순번 가드
  // (요청 시작 시 발급받고, 응답 시점에 "그때의 번호"가 여전히 최신일 때만 반영한다). 재시도 버튼도 같은 함수를 거친다.
  const summaryGuard = useLatestRequest();
  const distributionGuard = useLatestRequest();
  const questionsGuard = useLatestRequest();

  const fetchSummary = useCallback(async () => {
    const reqId = summaryGuard.next();
    setSummarySlice((s) => ({ ...s, loading: true }));
    try {
      const data = await statsApi.getSummary({ chatbotId: chatbot.id, granularity, from: from || undefined, to: to || undefined });
      if (summaryGuard.isStale(reqId)) return;
      setSummarySlice({ loading: false, error: false, data });
      setAnnounce(MESSAGES.stats.resultAnnounce(data.totals.turnCount));
    } catch (e) {
      if (summaryGuard.isStale(reqId)) return;
      if (e instanceof ApiError && e.code === 'STATS_RANGE_TOO_WIDE') {
        setSummarySlice((s) => ({ ...s, loading: false, periodError: e.message }));
      } else {
        setSummarySlice({ loading: false, error: true, data: null });
      }
    }
  }, [chatbot.id, granularity, from, to, summaryGuard]);

  const fetchDistribution = useCallback(async () => {
    const reqId = distributionGuard.next();
    setDistributionSlice((s) => ({ ...s, loading: true }));
    try {
      const data = await statsApi.getDistribution({ chatbotId: chatbot.id, from: from || undefined, to: to || undefined });
      if (distributionGuard.isStale(reqId)) return;
      setDistributionSlice({ loading: false, error: false, data });
    } catch {
      if (distributionGuard.isStale(reqId)) return;
      setDistributionSlice({ loading: false, error: true, data: null });
    }
  }, [chatbot.id, from, to, distributionGuard]);

  const fetchQuestions = useCallback(async () => {
    const reqId = questionsGuard.next();
    setQuestionsSlice((s) => ({ ...s, loading: true }));
    try {
      const data = await statsApi.getQuestions({ chatbotId: chatbot.id, from: from || undefined, to: to || undefined, topN: 10 });
      if (questionsGuard.isStale(reqId)) return;
      setQuestionsSlice({ loading: false, error: false, data });
    } catch {
      if (questionsGuard.isStale(reqId)) return;
      setQuestionsSlice({ loading: false, error: true, data: null });
    }
  }, [chatbot.id, from, to, questionsGuard]);

  useEffect(() => {
    void fetchSummary();
  }, [fetchSummary]);
  useEffect(() => {
    void fetchDistribution();
  }, [fetchDistribution]);
  useEffect(() => {
    void fetchQuestions();
  }, [fetchQuestions]);

  function resetToDefault(): void {
    setGranularity('DAY');
    setFrom('');
    setTo('');
  }

  const summary = summarySlice.data;
  const rangeDefaulted = from === '' && to === '';
  const isEmpty = Boolean(summary && summary.totals.turnCount === 0);

  return (
    <div className="stats-overview-page">
      <GranularityPeriodControl
        granularity={granularity}
        onGranularityChange={setGranularity}
        from={from}
        to={to}
        onRangeChange={(f, t) => {
          setFrom(f);
          setTo(t);
        }}
        periodStart={summary?.periodStart}
        periodEnd={summary?.periodEnd}
        rangeDefaulted={rangeDefaulted}
        errorMessage={summarySlice.periodError}
      />
      <p className="sr-only" role="status" aria-live="polite">
        {announce}
      </p>

      {summarySlice.loading ? (
        <div className="dashboard-cards">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : summarySlice.error ? (
        <ErrorState title={MESSAGES.stats.errorTitle} onRetry={fetchSummary} />
      ) : summary ? (
        <div className="dashboard-cards stats-metric-row">
          <MetricCard label={MESSAGES.stats.metricSessionLabel} value={String(summary.totals.sessionCount)} caption={MESSAGES.stats.metricSessionCaption} />
          <MetricCard
            label={MESSAGES.stats.metricTurnLabel}
            value={String(summary.totals.turnCount)}
            caption={MESSAGES.stats.metricTurnCaption(summary.totals.turnsPerSession)}
          />
          <MetricCard
            label={MESSAGES.stats.metricResponseRateLabel}
            value={formatPercent(summary.totals.responseRate)}
            caption={MESSAGES.stats.metricResponseRateCaption}
          />
          <MetricCard
            label={MESSAGES.stats.metricUnansweredLabel}
            value={String(summary.totals.unansweredCount)}
            caption={MESSAGES.stats.metricUnansweredCaption(summary.totals.blockedCount)}
          />
          <MetricCard
            label={MESSAGES.stats.metricBlockedLabel}
            value={String(summary.totals.blockedCount)}
            caption={MESSAGES.stats.metricBlockedCaption}
          />
        </div>
      ) : null}

      {isEmpty ? (
        <EmptyState
          title={MESSAGES.stats.emptyTitle}
          description={MESSAGES.stats.emptyDesc}
          action={
            <button type="button" className="btn btn-secondary" onClick={resetToDefault}>
              {MESSAGES.stats.emptyCta}
            </button>
          }
        />
      ) : (
        <>
          {summarySlice.loading ? (
            <SkeletonRow />
          ) : summary ? (
            <StatsTrendChart buckets={summary.buckets} granularity={granularity} />
          ) : null}

          <div className="stats-distribution-grid">
            {distributionSlice.loading ? (
              <SkeletonRow />
            ) : distributionSlice.error ? (
              <ErrorState title={MESSAGES.stats.errorTitle} onRetry={fetchDistribution} />
            ) : distributionSlice.data ? (
              <>
                <ResponseSourceDistribution chatbotId={chatbot.id} distribution={distributionSlice.data} />
                <ChannelDistribution distribution={distributionSlice.data} />
              </>
            ) : null}
          </div>

          {distributionSlice.data && !distributionSlice.loading && !distributionSlice.error && (
            <HourWeekdayPanel distribution={distributionSlice.data} />
          )}

          {questionsSlice.loading ? (
            <SkeletonRow />
          ) : questionsSlice.error ? (
            <ErrorState title={MESSAGES.stats.errorTitle} onRetry={fetchQuestions} />
          ) : questionsSlice.data ? (
            <TopQuestionsPanel chatbotId={chatbot.id} questions={questionsSlice.data} />
          ) : null}
        </>
      )}

      {/* No.29(J-13) — 기존 섹션과 무관하게 항상 렌더되는 독립 섹션(FR-0-90, FR-I8-5). */}
      <IntentMatchSection chatbotId={chatbot.id} from={from} to={to} />
    </div>
  );
}
