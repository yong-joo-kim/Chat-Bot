import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  SURVEY_LIMITS,
  type ChannelType,
  type SurveyExportKind,
  type SurveyQuestionStats,
  type SurveyResponseListItem,
  type SurveyStatsGranularity,
  type SurveyStatsSummary,
  type SurveyTextAnswerItem,
} from '@chat-bot/shared-types';
import { useChatbotDetailContext } from '../ChatbotDetailLayout';
import { surveyResultsApi, surveysApi } from '../../api/surveys';
import { ApiError } from '../../api/client';
import { useToast } from '../../components/Toast';
import { ErrorState } from '../../components/ErrorState';
import { EmptyState } from '../../components/EmptyState';
import { SkeletonCard, SkeletonRow } from '../../components/Skeleton';
import { Pagination } from '../../components/Pagination';
import { DateRangeField } from '../../components/DateRangeField';
import { MESSAGES } from '../../constants/messages';
import { formatDate, formatDateTime, addDaysToDateInputValue, kstTodayDateInputValue } from '../../lib/date';
import { useLatestRequest } from '../../lib/useLatestRequest';
import { activeFromIsoToDisplayDateInput, activeToIsoToDisplayDateInput } from '../../lib/surveyDisplay';
import { SurveyTabs } from './components/survey/SurveyTabs';
import { SurveyDuplicateBadge, SurveyLowSampleBadge } from './components/survey/badges';

const RESPONSE_PAGE_SIZE = 20;
const GRANULARITY_OPTIONS: { value: SurveyStatsGranularity; label: string }[] = [
  { value: 'day', label: MESSAGES.stats.granularityDay },
  { value: 'week', label: MESSAGES.stats.granularityWeek },
  { value: 'month', label: MESSAGES.stats.granularityMonth },
];

function ratioCaption(numerator: number, denominator: number, ratio: number | null): string {
  if (ratio === null) return MESSAGES.surveyResults.metricNoData;
  return `${(ratio * 100).toFixed(1)}% (${numerator}/${denominator})`;
}

/** 두 YYYY-MM-DD(포함 경계) 사이의 일수(당일 포함). 서버 `assertSurveyPeriod`와 같은 계산 방식. */
function rangeDaysInclusive(from: string, to: string): number {
  const fromMs = Date.parse(`${from}T00:00:00Z`);
  const toMs = Date.parse(`${to}T00:00:00Z`);
  return Math.round((toMs - fromMs) / 86_400_000) + 1;
}

/** SV3 — 설문 결과(`/chatbots/:chatbotId/dialogue/surveys/:surveyId/results`, ui-spec §3.5). */
export function SurveyResultsPage(): JSX.Element {
  const { chatbot } = useChatbotDetailContext();
  const { surveyId } = useParams<{ surveyId: string }>();
  const { showToast } = useToast();
  const msg = MESSAGES.surveyResults;
  const summaryGuard = useLatestRequest();
  const questionsGuard = useLatestRequest();
  const responsesGuard = useLatestRequest();

  const [surveyName, setSurveyName] = useState('');
  const [surveyPeriod, setSurveyPeriod] = useState<{ from?: Date; to?: Date }>({});
  const [questionDefs, setQuestionDefs] = useState<{ key: string; prompt: string }[]>([]);

  const [from, setFrom] = useState(addDaysToDateInputValue(kstTodayDateInputValue(), -29));
  const [to, setTo] = useState(kstTodayDateInputValue());
  const [granularity, setGranularity] = useState<SurveyStatsGranularity>('day');
  const [channel, setChannel] = useState<ChannelType | ''>('');
  const [includeDuplicates, setIncludeDuplicates] = useState(false);

  // [No.27 코드 리뷰 1회차 H2] 설문 결과는 단위(일/주/월)와 무관하게 기간이 366일을 넘으면 서버가
  // 400 STATS_RANGE_TOO_WIDE로 거부한다(`survey-period.ts` `assertSurveyPeriod` — 일/주/월 개별
  // 상한이 아니라 전체 기간 고정 상한이다). 요청 전에 미리 걸러 무의미한 실패 호출을 막는다.
  const periodRangeError =
    from && to && rangeDaysInclusive(from, to) > SURVEY_LIMITS.periodMaxDays ? msg.periodTooWideError(SURVEY_LIMITS.periodMaxDays) : undefined;

  const [summary, setSummary] = useState<SurveyStatsSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryError, setSummaryError] = useState<'ERROR' | 'TIMEOUT' | null>(null);

  const [questionStats, setQuestionStats] = useState<SurveyQuestionStats | null>(null);
  const [questionsLoading, setQuestionsLoading] = useState(true);
  const [questionsError, setQuestionsError] = useState(false);

  const [responseStatus, setResponseStatus] = useState<Set<'COMPLETED' | 'IN_PROGRESS' | 'ABANDONED'>>(
    new Set(['COMPLETED', 'IN_PROGRESS', 'ABANDONED']),
  );
  const [responses, setResponses] = useState<SurveyResponseListItem[]>([]);
  const [responsesTotal, setResponsesTotal] = useState(0);
  const [responsesPage, setResponsesPage] = useState(1);
  const [responsesLoading, setResponsesLoading] = useState(true);
  const [responsesError, setResponsesError] = useState(false);

  const [textAnswerQuestionKey, setTextAnswerQuestionKey] = useState<string | null>(null);
  const [textAnswers, setTextAnswers] = useState<SurveyTextAnswerItem[]>([]);
  const [textAnswersTotal, setTextAnswersTotal] = useState(0);

  useEffect(() => {
    if (!surveyId) return;
    surveysApi
      .findOne(chatbot.id, surveyId)
      .then((s) => {
        setSurveyName(s.name);
        setSurveyPeriod({ from: s.activeFrom, to: s.activeTo });
        setQuestionDefs(s.questions.map((q) => ({ key: q.key, prompt: q.prompt })));
      })
      .catch(() => undefined);
  }, [chatbot.id, surveyId]);

  const loadSummary = useCallback(async () => {
    if (!surveyId || periodRangeError) return;
    const reqId = summaryGuard.next();
    setSummaryLoading(true);
    setSummaryError(null);
    try {
      const res = await surveyResultsApi.summary(chatbot.id, surveyId, { from, to, granularity, channel: channel || undefined, includeDuplicates });
      if (summaryGuard.isStale(reqId)) return;
      setSummary(res);
    } catch (e) {
      if (summaryGuard.isStale(reqId)) return;
      // ui-spec §3.5: 요약 조회가 실패해도 직전에 성공한 카드 값은 화면에 그대로 남겨 둔다
      // (아래 렌더에서 `summary`를 지우지 않고 오류 배너만 함께 띄운다).
      setSummaryError(e instanceof ApiError && e.status === 503 ? 'TIMEOUT' : 'ERROR');
    } finally {
      if (!summaryGuard.isStale(reqId)) setSummaryLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatbot.id, surveyId, from, to, granularity, channel, includeDuplicates, periodRangeError]);

  const loadQuestions = useCallback(async () => {
    if (!surveyId || periodRangeError) return;
    const reqId = questionsGuard.next();
    setQuestionsLoading(true);
    setQuestionsError(false);
    try {
      const res = await surveyResultsApi.questions(chatbot.id, surveyId, { from, to, granularity, channel: channel || undefined, includeDuplicates });
      if (questionsGuard.isStale(reqId)) return;
      setQuestionStats(res);
    } catch {
      if (questionsGuard.isStale(reqId)) return;
      setQuestionsError(true);
    } finally {
      if (!questionsGuard.isStale(reqId)) setQuestionsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatbot.id, surveyId, from, to, granularity, channel, includeDuplicates, periodRangeError]);

  const loadResponses = useCallback(async () => {
    if (!surveyId || periodRangeError) return;
    const reqId = responsesGuard.next();
    setResponsesLoading(true);
    setResponsesError(false);
    try {
      const status = responseStatus.size === 3 ? undefined : [...responseStatus];
      const res = await surveyResultsApi.responses(chatbot.id, surveyId, {
        from,
        to,
        channel: channel || undefined,
        status,
        page: responsesPage,
        pageSize: RESPONSE_PAGE_SIZE,
      });
      if (responsesGuard.isStale(reqId)) return;
      setResponses(res.items);
      setResponsesTotal(res.total);
    } catch {
      if (responsesGuard.isStale(reqId)) return;
      setResponsesError(true);
    } finally {
      if (!responsesGuard.isStale(reqId)) setResponsesLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatbot.id, surveyId, from, to, channel, responseStatus, responsesPage, periodRangeError]);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);
  useEffect(() => {
    void loadQuestions();
  }, [loadQuestions]);
  useEffect(() => {
    void loadResponses();
  }, [loadResponses]);

  useEffect(() => {
    if (!textAnswerQuestionKey || !surveyId) return;
    surveyResultsApi
      .textAnswers(chatbot.id, surveyId, { questionKey: textAnswerQuestionKey, from, to, channel: channel || undefined, page: 1, pageSize: 50 })
      .then((res) => {
        setTextAnswers(res.items);
        setTextAnswersTotal(res.total);
      })
      .catch(() => {
        setTextAnswers([]);
        setTextAnswersTotal(0);
      });
  }, [chatbot.id, surveyId, textAnswerQuestionKey, from, to, channel]);

  async function handleExport(kind: SurveyExportKind): Promise<void> {
    if (!surveyId || !from || !to || periodRangeError) return;
    try {
      const { blob, filename, truncated } = await surveyResultsApi.exportCsv(chatbot.id, surveyId, kind, { from, to, channel: channel || undefined, includeDuplicates });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      if (truncated) showToast(msg.csvTruncatedNotice);
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : MESSAGES.errors.generic);
    }
  }

  function toggleResponseStatus(s: 'COMPLETED' | 'IN_PROGRESS' | 'ABANDONED'): void {
    setResponsesPage(1);
    setResponseStatus((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  }

  if (!surveyId) return <ErrorState title={MESSAGES.surveys.notFound} />;

  const totals = summary?.totals;
  const exportDisabled = !from || !to || Boolean(periodRangeError);

  return (
    <div>
      <Link to={`/chatbots/${chatbot.id}/dialogue/surveys`} className="detail-back-link">
        {MESSAGES.common.backToList}
      </Link>
      <div className="node-form-header">
        <h2>{MESSAGES.surveys.titleEdit(surveyName)}</h2>
      </div>
      <SurveyTabs chatbotId={chatbot.id} surveyId={surveyId} active="results" />

      <div className="dialogue-toolbar">
        <fieldset className="form-field form-field--inline" role="radiogroup" aria-label={MESSAGES.stats.granularityLegend}>
          <legend>{MESSAGES.stats.granularityLegend}</legend>
          {GRANULARITY_OPTIONS.map((opt) => (
            <label key={opt.value} className="form-field--inline">
              <input type="radio" name="survey-results-granularity" checked={granularity === opt.value} onChange={() => setGranularity(opt.value)} />
              {opt.label}
            </label>
          ))}
        </fieldset>
        <DateRangeField from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} maxRangeDays={SURVEY_LIMITS.periodMaxDays} errorMessage={periodRangeError} />
        <div className="form-field form-field--inline">
          <label htmlFor="survey-results-channel">{msg.filterChannelLabel}</label>
          <select id="survey-results-channel" value={channel} onChange={(e) => setChannel(e.target.value as ChannelType | '')}>
            <option value="">{msg.filterChannelAll}</option>
            {Object.entries(MESSAGES.channels.typeLabel).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <label className="form-field--inline">
            <input type="checkbox" checked={includeDuplicates} onChange={(e) => setIncludeDuplicates(e.target.checked)} />
            {msg.includeDuplicatesLabel}
          </label>
        </div>
      </div>

      {/* 요약 카드 — 독립 로딩(stats-learning-ui-spec.md §2.4 F-3와 같은 패턴). 실패해도 직전 값 유지. */}
      {summaryLoading && !summary && (
        <div className="metric-card-row">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      )}
      {summaryError && <ErrorState title={summaryError === 'TIMEOUT' ? msg.aggregationTimeout : msg.loadFailed} onRetry={loadSummary} />}
      {totals && (
        <>
          {totals.exposed === 0 && surveyPeriod.from && new Date(to) < surveyPeriod.from ? (
            <EmptyState
              title={msg.emptyBeforeOpen(
                surveyPeriod.from ? formatDate(activeFromIsoToDisplayDateInput(surveyPeriod.from)) : '—',
                surveyPeriod.to ? formatDate(activeToIsoToDisplayDateInput(surveyPeriod.to)) : '—',
              )}
            />
          ) : (
            <div className="metric-card-row">
              <div className="metric-card">
                <p className="metric-card-label">{msg.metric.exposed}</p>
                <p className="metric-card-value">{totals.exposed}</p>
              </div>
              <div className="metric-card">
                <p className="metric-card-label">{msg.metric.started}</p>
                <p className="metric-card-value">{totals.started}</p>
                <p className="metric-card-caption">
                  {msg.metricRatio.participationRate}: {ratioCaption(totals.started, totals.exposed, totals.participationRate)}
                </p>
              </div>
              <div className="metric-card">
                <p className="metric-card-label">{msg.metric.completed}</p>
                <p className="metric-card-value">{totals.completed}</p>
                <p className="metric-card-caption">
                  {msg.metricRatio.completionRate}: {ratioCaption(totals.completed, totals.exposed - totals.inProgress, totals.completionRate)}
                </p>
              </div>
              <div className="metric-card">
                <p className="metric-card-label">{msg.metric.droppedAfterStart}</p>
                <p className="metric-card-value">{totals.droppedAfterStart}</p>
                <p className="metric-card-caption">
                  {msg.metricRatio.dropoutRate}: {ratioCaption(totals.droppedAfterStart, totals.started - totals.inProgressStarted, totals.dropoutRate)}
                </p>
              </div>
              <div className="metric-card">
                <p className="metric-card-label">{msg.metric.droppedBeforeStart}</p>
                <p className="metric-card-value">{totals.droppedBeforeStart}</p>
              </div>
              <div className="metric-card">
                <p className="metric-card-label">{msg.metric.inProgress}</p>
                <p className="metric-card-value">{totals.inProgress}</p>
              </div>
            </div>
          )}
          {totals.duplicates > 0 && <p className="field-hint">{msg.duplicateCaption(totals.duplicates)}</p>}
          {summary?.lowSample && <SurveyLowSampleBadge />}

          <section className="chart-frame">
            <h3>{msg.trendChartTitle}</h3>
            <p className="field-hint">{msg.trendSummary}</p>
            <table className="dialogue-table">
              <thead>
                <tr>
                  <th scope="col">{summary?.period.granularity}</th>
                  <th scope="col">{msg.metric.exposed}</th>
                  <th scope="col">{msg.metric.started}</th>
                  <th scope="col">{msg.metric.completed}</th>
                </tr>
              </thead>
              <tbody>
                {summary?.buckets.map((b) => (
                  <tr key={b.key}>
                    <td>{b.label}</td>
                    <td>{b.exposed}</td>
                    <td>{b.started}</td>
                    <td>{b.completed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}

      {/* 문항별 — 독립 로딩 */}
      <h3>{msg.questionsTitle}</h3>
      {questionsLoading && <SkeletonRow />}
      {!questionsLoading && questionsError && <ErrorState title={msg.loadFailed} onRetry={loadQuestions} />}
      {!questionsLoading && !questionsError && questionStats && questionStats.questions.length === 0 && <EmptyState title={msg.emptyNoExposure} />}
      {!questionsLoading &&
        !questionsError &&
        questionStats?.questions.map((q) => (
          <div key={q.questionKey} className="survey-question-stat-card">
            <p className="field-label-static">{q.prompt}</p>
            <p className="field-hint">
              {msg.reached} {q.reached} · {msg.answered} {q.answered} · {msg.skipped} {q.skipped}
              {q.average !== null && q.average !== undefined && ` · ${msg.average} ${q.average}`}
              {q.nps !== null && q.nps !== undefined && ` · ${msg.nps} ${q.nps}`}
            </p>
            {q.lowSample && <SurveyLowSampleBadge />}
            {q.kind === 'CHOICE' && q.choiceDistribution && (
              <ul>
                {q.choiceDistribution.map((c) => (
                  <li key={c.choiceKey}>
                    {c.label}: {c.count}건{c.ratio !== null ? ` (${(c.ratio * 100).toFixed(0)}%)` : ''}
                  </li>
                ))}
                {q.multiSelectCaption && <li className="field-hint">{msg.multiSelectCaption}</li>}
              </ul>
            )}
            {q.kind === 'SCALE' && q.scaleDistribution && (
              <ul>
                {q.scaleDistribution.map((d) => (
                  <li key={d.value}>
                    {d.value}점: {d.count}건
                  </li>
                ))}
              </ul>
            )}
            {q.kind === 'TEXT' && (
              <button type="button" className="link-button" onClick={() => setTextAnswerQuestionKey(q.questionKey)}>
                {msg.textAnswersLink}
              </button>
            )}
            {q.kind === 'TEXT' && textAnswerQuestionKey === q.questionKey && (
              <div className="survey-text-answers-panel">
                <p className="field-hint">{MESSAGES.surveys.piiNotice}</p>
                <p className="field-hint">{MESSAGES.common.totalCount(textAnswersTotal)}</p>
                <ul>
                  {textAnswers.map((a, i) => (
                    <li key={i}>
                      {formatDateTime(a.answeredAt)} · {a.text}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ))}

      {/* 응답 목록 */}
      <div className="dialogue-toolbar">
        <h3>{msg.responseListTitle}</h3>
        <div>
          <button type="button" className="btn btn-secondary" aria-disabled={exportDisabled} title={exportDisabled ? msg.csvNeedsPeriod : undefined} onClick={() => !exportDisabled && void handleExport('RESPONSES')}>
            {msg.csvResponses}
          </button>{' '}
          <button type="button" className="btn btn-secondary" aria-disabled={exportDisabled} title={exportDisabled ? msg.csvNeedsPeriod : undefined} onClick={() => !exportDisabled && void handleExport('SUMMARY')}>
            {msg.csvSummary}
          </button>
        </div>
      </div>
      <fieldset className="form-field form-field--inline">
        <legend>{msg.filterStatusLabel}</legend>
        {(['COMPLETED', 'IN_PROGRESS', 'ABANDONED'] as const).map((s) => (
          <label key={s} className="form-field--inline">
            <input type="checkbox" checked={responseStatus.has(s)} onChange={() => toggleResponseStatus(s)} />
            {msg.responseStatus[s]}
          </label>
        ))}
      </fieldset>

      {responsesLoading && <SkeletonRow />}
      {!responsesLoading && responsesError && <ErrorState title={msg.loadFailed} onRetry={loadResponses} />}
      {!responsesLoading && !responsesError && responses.length === 0 && <EmptyState title={msg.emptyNoExposure} />}
      {!responsesLoading && !responsesError && responses.length > 0 && (
        <div className="dialogue-table-wrap">
          <table className="dialogue-table">
            <thead>
              <tr>
                <th scope="col">{msg.columnResponseNo}</th>
                <th scope="col">{msg.columnExposedAt}</th>
                <th scope="col">{msg.columnStatus}</th>
                <th scope="col">{msg.columnChannel}</th>
                <th scope="col">{msg.columnCompletedAt}</th>
                {questionDefs.map((qd) => (
                  <th key={qd.key} scope="col">
                    {qd.prompt}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {responses.map((r) => (
                <tr key={r.responseNo}>
                  <td>{r.responseNo}</td>
                  <td>{formatDateTime(r.exposedAt)}</td>
                  <td>
                    {msg.responseStatus[r.displayStatus]} {r.duplicate && <SurveyDuplicateBadge />}
                  </td>
                  <td>{r.channelType}</td>
                  <td>{r.completedAt ? formatDateTime(r.completedAt) : msg.noAnswer}</td>
                  {questionDefs.map((qd) => {
                    const answer = r.answers.find((a) => a.questionKey === qd.key);
                    return (
                      <td key={qd.key}>{!answer ? msg.noAnswer : answer.kind === 'SKIPPED' ? msg.skippedAnswer : answer.display}</td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination page={responsesPage} pageSize={RESPONSE_PAGE_SIZE} total={responsesTotal} onPageChange={setResponsesPage} />
        </div>
      )}
    </div>
  );
}
