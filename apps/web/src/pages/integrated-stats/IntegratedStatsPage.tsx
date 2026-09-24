import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type {
  IntegratedBreakdown,
  IntegratedBreakdownItem,
  IntegratedDistribution,
  IntegratedGroupOptions,
  IntegratedOverview,
  IntegratedQuestions,
  IntegratedSummary,
  StatsGranularity,
  StatsScope,
} from '@chat-bot/shared-types';
import { integratedStatsApi } from '../../api/integratedStats';
import { ApiError } from '../../api/client';
import { MESSAGES } from '../../constants/messages';
import { SkeletonCard, SkeletonRow } from '../../components/Skeleton';
import { ErrorState } from '../../components/ErrorState';
import { EmptyState } from '../../components/EmptyState';
import { GranularityPeriodControl } from '../stats/GranularityPeriodControl';
import { StatsTrendChart } from '../stats/StatsTrendChart';
import { ResponseSourceDistribution } from '../stats/ResponseSourceDistribution';
import { ChannelDistribution } from '../stats/ChannelDistribution';
import { HourWeekdayPanel } from '../stats/HourWeekdayPanel';
import { ScopeSelector } from './ScopeSelector';
import { BackfillPendingBanner } from './BackfillPendingBanner';
import { CumulativeKpiCards } from './CumulativeKpiCards';
import { SortableBreakdownTable } from './SortableBreakdownTable';
import { IntegratedQuestionsPanel } from './IntegratedQuestionsPanel';

interface AsyncSlice<T> {
  loading: boolean;
  error: boolean;
  errorTitle?: string;
  periodError?: string;
  data: T | null;
}

function initialSlice<T>(): AsyncSlice<T> {
  return { loading: true, error: false, data: null };
}

function errorTitleFor(e: unknown): string {
  if (e instanceof ApiError && e.code === 'AGGREGATION_TIMEOUT') return MESSAGES.stats.timeoutTitle;
  return MESSAGES.stats.errorTitle;
}

/**
 * G0 — 통합 통계(No.29, `integrated-stats-ui-spec.md` §3). 콘솔 홈(`/`)을 대체한다(P-8).
 * `groups` 1회 요청 + 5개(overview/summary/distribution/breakdown/questions) 독립 병렬 요청(§2.2).
 */
export function IntegratedStatsPage(): JSX.Element {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const rawScope = searchParams.get('scope');
  const scope: StatsScope = rawScope === 'GROUP' ? 'GROUP' : 'ALL';
  const groupId = scope === 'GROUP' ? (searchParams.get('groupId') ?? undefined) : undefined;
  const rawGranularity = searchParams.get('granularity');
  const granularity: StatsGranularity = rawGranularity === 'WEEK' || rawGranularity === 'MONTH' ? rawGranularity : 'DAY';
  const from = searchParams.get('from') ?? '';
  const to = searchParams.get('to') ?? '';
  const includeArchivedChatbots = searchParams.get('includeArchivedChatbots') !== 'false';

  const scopeReady = scope === 'ALL' || Boolean(groupId);

  function updateParams(patch: Record<string, string | undefined>): void {
    const next = new URLSearchParams(searchParams);
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || v === '') next.delete(k);
      else next.set(k, v);
    }
    setSearchParams(next);
  }

  const [groupsSlice, setGroupsSlice] = useState<AsyncSlice<IntegratedGroupOptions>>(initialSlice);
  const [overviewSlice, setOverviewSlice] = useState<AsyncSlice<IntegratedOverview>>(initialSlice);
  const [summarySlice, setSummarySlice] = useState<AsyncSlice<IntegratedSummary>>(initialSlice);
  const [distributionSlice, setDistributionSlice] = useState<AsyncSlice<IntegratedDistribution>>(initialSlice);
  const [breakdownSlice, setBreakdownSlice] = useState<AsyncSlice<IntegratedBreakdown>>(initialSlice);
  const [questionsSlice, setQuestionsSlice] = useState<AsyncSlice<IntegratedQuestions>>(initialSlice);
  const [scopeNotFound, setScopeNotFound] = useState(false);

  // 스코프를 빠르게 전환할 때 늦게 도착한 이전 요청이 최신 결과를 덮어쓰지 않도록 하는 순번 가드
  // (요청 시작 시 증가시키고, 응답 시점에 "그때의 번호"와 "지금의 번호"가 같을 때만 반영한다).
  const overviewReqRef = useRef(0);
  const summaryReqRef = useRef(0);
  const distributionReqRef = useRef(0);
  const breakdownReqRef = useRef(0);
  const questionsReqRef = useRef(0);

  const loadGroups = useCallback(async () => {
    setGroupsSlice((s) => ({ ...s, loading: true, error: false }));
    try {
      const data = await integratedStatsApi.getGroupOptions();
      setGroupsSlice({ loading: false, error: false, data });
    } catch {
      setGroupsSlice({ loading: false, error: true, data: null });
    }
  }, []);

  useEffect(() => {
    void loadGroups();
  }, [loadGroups]);

  const fetchOverview = useCallback(async () => {
    if (!scopeReady) return;
    const reqId = ++overviewReqRef.current;
    setOverviewSlice((s) => ({ ...s, loading: true, error: false }));
    setScopeNotFound(false);
    try {
      const data = await integratedStatsApi.getOverview({ scope, groupId });
      if (reqId !== overviewReqRef.current) return; // 늦게 도착한 응답 — 무시
      setOverviewSlice({ loading: false, error: false, data });
    } catch (e) {
      if (reqId !== overviewReqRef.current) return;
      if (e instanceof ApiError && (e.status === 404 || e.code === 'NOT_FOUND')) setScopeNotFound(true);
      setOverviewSlice({ loading: false, error: true, data: null, errorTitle: errorTitleFor(e) });
    }
  }, [scope, groupId, scopeReady]);

  const fetchSummary = useCallback(async () => {
    if (!scopeReady) return;
    const reqId = ++summaryReqRef.current;
    setSummarySlice((s) => ({ ...s, loading: true, error: false, periodError: undefined }));
    try {
      const data = await integratedStatsApi.getSummary({ scope, groupId, granularity, from: from || undefined, to: to || undefined });
      if (reqId !== summaryReqRef.current) return;
      setSummarySlice({ loading: false, error: false, data });
    } catch (e) {
      if (reqId !== summaryReqRef.current) return;
      if (e instanceof ApiError && e.code === 'STATS_RANGE_TOO_WIDE') {
        setSummarySlice((s) => ({ ...s, loading: false, periodError: e.message }));
      } else {
        setSummarySlice({ loading: false, error: true, data: null, errorTitle: errorTitleFor(e) });
      }
    }
  }, [scope, groupId, granularity, from, to, scopeReady]);

  const fetchDistribution = useCallback(async () => {
    if (!scopeReady) return;
    const reqId = ++distributionReqRef.current;
    setDistributionSlice((s) => ({ ...s, loading: true, error: false }));
    try {
      const data = await integratedStatsApi.getDistribution({ scope, groupId, from: from || undefined, to: to || undefined });
      if (reqId !== distributionReqRef.current) return;
      setDistributionSlice({ loading: false, error: false, data });
    } catch (e) {
      if (reqId !== distributionReqRef.current) return;
      setDistributionSlice({ loading: false, error: true, data: null, errorTitle: errorTitleFor(e) });
    }
  }, [scope, groupId, from, to, scopeReady]);

  const fetchBreakdown = useCallback(async () => {
    if (!scopeReady) return;
    const reqId = ++breakdownReqRef.current;
    setBreakdownSlice((s) => ({ ...s, loading: true, error: false }));
    try {
      // ⚠ `/stats/integrated/breakdown`은 `IntegratedBreakdownQuery`(scope/groupId/from/to만) 계약이다 —
      // granularity를 보내지 않는다(코드리뷰 L-2, 설계 변경분).
      const data = await integratedStatsApi.getBreakdown({ scope, groupId, from: from || undefined, to: to || undefined });
      if (reqId !== breakdownReqRef.current) return;
      setBreakdownSlice({ loading: false, error: false, data });
    } catch (e) {
      if (reqId !== breakdownReqRef.current) return;
      setBreakdownSlice({ loading: false, error: true, data: null, errorTitle: errorTitleFor(e) });
    }
  }, [scope, groupId, from, to, scopeReady]);

  const fetchQuestions = useCallback(async () => {
    if (!scopeReady) return;
    const reqId = ++questionsReqRef.current;
    setQuestionsSlice((s) => ({ ...s, loading: true, error: false }));
    try {
      const data = await integratedStatsApi.getQuestions({
        scope,
        groupId,
        from: from || undefined,
        to: to || undefined,
        topN: 10,
        includeArchivedChatbots,
      });
      if (reqId !== questionsReqRef.current) return;
      setQuestionsSlice({ loading: false, error: false, data });
    } catch (e) {
      if (reqId !== questionsReqRef.current) return;
      setQuestionsSlice({ loading: false, error: true, data: null, errorTitle: errorTitleFor(e) });
    }
  }, [scope, groupId, from, to, includeArchivedChatbots, scopeReady]);

  useEffect(() => {
    void fetchOverview();
  }, [fetchOverview]);
  useEffect(() => {
    void fetchSummary();
  }, [fetchSummary]);
  useEffect(() => {
    void fetchDistribution();
  }, [fetchDistribution]);
  useEffect(() => {
    void fetchBreakdown();
  }, [fetchBreakdown]);
  useEffect(() => {
    void fetchQuestions();
  }, [fetchQuestions]);

  function handleScopeChange(nextScope: StatsScope, nextGroupId?: string): void {
    if (nextScope === 'ALL') updateParams({ scope: undefined, groupId: undefined });
    else updateParams({ scope: 'GROUP', groupId: nextGroupId });
  }

  function handleBreakdownRowClick(item: IntegratedBreakdownItem): void {
    if (item.kind === 'CHATBOT') {
      navigate(`/chatbots/${item.id}/stats/overview`);
    } else if (item.kind === 'GROUP' && !item.missing) {
      updateParams({ scope: 'GROUP', groupId: item.id });
    }
  }

  const backfillPending = [overviewSlice.data, summarySlice.data, distributionSlice.data, breakdownSlice.data, questionsSlice.data].some(
    (d) => d?.backfillPending,
  );
  const isEmpty = Boolean(overviewSlice.data && overviewSlice.data.totals.turnCount === 0);
  const rangeDefaulted = from === '' && to === '';

  return (
    <div className="integrated-stats-page">
      <h1>{MESSAGES.integratedStats.pageTitle}</h1>

      <ScopeSelector
        scope={scope}
        groupId={groupId}
        groups={groupsSlice.data?.items ?? []}
        groupsLoading={groupsSlice.loading}
        groupsError={groupsSlice.error}
        truncated={groupsSlice.data?.truncated ?? false}
        onRetryGroups={loadGroups}
        onChange={handleScopeChange}
      />

      {backfillPending && <BackfillPendingBanner />}

      {!scopeReady ? (
        <EmptyState title={MESSAGES.integratedStats.scopeSelectPrompt} />
      ) : scopeNotFound ? (
        <div className="error-state" role="alert">
          <p className="error-state-title">
            <span aria-hidden="true">⚠</span> {MESSAGES.integratedStats.scopeNotFoundTitle}
          </p>
          <button type="button" className="btn btn-secondary" onClick={() => updateParams({ scope: undefined, groupId: undefined })}>
            {MESSAGES.integratedStats.scopeNotFoundAction}
          </button>
        </div>
      ) : (
        <>
          {/* axe heading-order — h1(페이지 제목) 다음 h3(재사용 `ChartFrame`)로 바로 건너뛰지 않도록 h2 1개를 둔다. */}
          <h2>{MESSAGES.integratedStats.kpiSectionTitle}</h2>
          {overviewSlice.loading ? (
            <div className="dashboard-cards integrated-kpi-cards">
              <SkeletonCard />
              <SkeletonCard />
              <SkeletonCard />
              <SkeletonCard />
            </div>
          ) : overviewSlice.error ? (
            <ErrorState title={overviewSlice.errorTitle ?? MESSAGES.stats.errorTitle} onRetry={fetchOverview} />
          ) : overviewSlice.data ? (
            <CumulativeKpiCards overview={overviewSlice.data} />
          ) : null}

          {isEmpty ? (
            <EmptyState title={MESSAGES.integratedStats.emptyScopeTitle} />
          ) : (
            <>
              <GranularityPeriodControl
                granularity={granularity}
                onGranularityChange={(g) => updateParams({ granularity: g === 'DAY' ? undefined : g })}
                from={from}
                to={to}
                onRangeChange={(f, t) => updateParams({ from: f || undefined, to: t || undefined })}
                periodStart={summarySlice.data?.periodStart}
                periodEnd={summarySlice.data?.periodEnd}
                rangeDefaulted={rangeDefaulted}
                errorMessage={summarySlice.periodError}
              />

              {summarySlice.loading ? (
                <SkeletonRow />
              ) : summarySlice.error ? (
                <ErrorState title={summarySlice.errorTitle ?? MESSAGES.stats.errorTitle} onRetry={fetchSummary} />
              ) : summarySlice.data ? (
                <StatsTrendChart buckets={summarySlice.data.buckets} granularity={granularity} />
              ) : null}

              <div className="stats-distribution-grid">
                {distributionSlice.loading ? (
                  <SkeletonRow />
                ) : distributionSlice.error ? (
                  <ErrorState title={distributionSlice.errorTitle ?? MESSAGES.stats.errorTitle} onRetry={fetchDistribution} />
                ) : distributionSlice.data ? (
                  <>
                    <ResponseSourceDistribution distribution={distributionSlice.data} />
                    <ChannelDistribution distribution={distributionSlice.data} />
                  </>
                ) : null}
              </div>

              {distributionSlice.data && !distributionSlice.loading && !distributionSlice.error && (
                <HourWeekdayPanel distribution={distributionSlice.data} />
              )}

              {breakdownSlice.loading ? (
                <SkeletonRow />
              ) : breakdownSlice.error ? (
                <ErrorState title={breakdownSlice.errorTitle ?? MESSAGES.stats.errorTitle} onRetry={fetchBreakdown} />
              ) : breakdownSlice.data ? (
                <SortableBreakdownTable
                  items={breakdownSlice.data.items}
                  othersRow={breakdownSlice.data.othersRow}
                  unassignedRow={breakdownSlice.data.unassignedRow}
                  kind={scope === 'ALL' ? 'GROUP' : 'CHATBOT'}
                  onRowClick={handleBreakdownRowClick}
                />
              ) : null}

              {questionsSlice.loading ? (
                <SkeletonRow />
              ) : questionsSlice.error ? (
                <ErrorState title={questionsSlice.errorTitle ?? MESSAGES.stats.errorTitle} onRetry={fetchQuestions} />
              ) : questionsSlice.data ? (
                <IntegratedQuestionsPanel
                  questions={questionsSlice.data}
                  includeArchivedChatbots={includeArchivedChatbots}
                  onIncludeArchivedChange={(v) => updateParams({ includeArchivedChatbots: v ? undefined : 'false' })}
                />
              ) : null}
            </>
          )}
        </>
      )}
    </div>
  );
}
