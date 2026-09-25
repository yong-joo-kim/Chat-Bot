import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { FeedbackStats, FeedbackStatsTopTarget } from '@chat-bot/shared-types';
import { statsApi } from '../../api/stats';
import { ApiError } from '../../api/client';
import { MESSAGES } from '../../constants/messages';
import { SkeletonCard, SkeletonRow } from '../../components/Skeleton';
import { ErrorState } from '../../components/ErrorState';
import { EmptyState } from '../../components/EmptyState';
import { MetricCard } from '../chatbot-detail/MetricCard';
import { useLatestRequest } from '../../lib/useLatestRequest';
import { formatPercent } from '../../lib/date';
import { ChartFrame } from './ChartFrame';
import { BarChartSvg, type BarDatum } from './BarChartSvg';
import { buildTrendSummary } from './chartSummary';

function formatRate(rate: number | null): string {
  return rate === null ? '—' : formatPercent(rate);
}

/** [신규 No.44] 👎 상위 대상 이름 — 삭제됐으면 "삭제됨"(링크 없음, FR-FB8-4). */
function targetName(item: FeedbackStatsTopTarget): string {
  if (item.deleted || !item.name) return MESSAGES.learning.targetDeletedLabel;
  return item.name;
}

/**
 * [신규 No.44] FB-S1 — S1 4번째 독립 패널 "답변 만족도"(feedback-loop-ui-spec.md §3.4). 다른 3개
 * 패널(`summary`/`distribution`/`questions`)과 완전히 독립적으로 로딩·오류·완료된다(F-3 확장) — 이
 * 섹션이 느리거나 실패해도 다른 패널에 영향이 없고, 반대도 마찬가지다. 기간 컨트롤은 S1의 것을
 * 그대로 공유한다(신규 컨트롤 없음). 일별 추이는 다른 통계 패널·`UnansweredTable` 트렌드 패널과 같은
 * `ChartFrame`+`BarChartSvg` 조합을 재사용한다(표 보기 토글·`role="img"` 요약·SVG `aria-hidden`,
 * feedback-loop-ui-spec.md §3.4.2/§6.2).
 */
export function AnswerFeedbackSection({
  chatbotId,
  from,
  to,
  canWriteChannel,
}: {
  chatbotId: string;
  from: string;
  to: string;
  /** [신규 No.44] EDITOR/ADMIN(`channel:write`)만 빈 상태의 "채널 설정으로 이동" 링크를 본다 — 판정은
   * 상위(`StatsOverviewPage`)에서 내려받는다(`ChannelCard`의 `canScheduleWrite` prop 패턴과 동일). */
  canWriteChannel: boolean;
}): JSX.Element {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [periodError, setPeriodError] = useState<string | undefined>();
  const [timeout_, setTimeout_] = useState(false);
  const [data, setData] = useState<FeedbackStats | null>(null);
  const guard = useLatestRequest();

  const fetchFeedbackStats = useCallback(async () => {
    const reqId = guard.next();
    setLoading(true);
    setError(false);
    setPeriodError(undefined);
    setTimeout_(false);
    try {
      const res = await statsApi.getFeedbackStats({ chatbotId, from: from || undefined, to: to || undefined, topN: 10 });
      if (guard.isStale(reqId)) return;
      setData(res);
    } catch (e) {
      if (guard.isStale(reqId)) return;
      if (e instanceof ApiError && e.code === 'STATS_RANGE_TOO_WIDE') {
        setPeriodError(e.message);
      } else if (e instanceof ApiError && (e.code === 'AGGREGATION_TIMEOUT' || e.status === 503)) {
        setTimeout_(true);
      } else {
        setError(true);
      }
    } finally {
      if (!guard.isStale(reqId)) setLoading(false);
    }
  }, [chatbotId, from, to, guard]);

  useEffect(() => {
    void fetchFeedbackStats();
  }, [fetchFeedbackStats]);

  const noOffer = Boolean(data && data.totals.offeredCount === 0);
  const noRating = Boolean(data && data.totals.offeredCount > 0 && data.totals.ratedCount === 0);

  return (
    <section className="answer-feedback-section">
      <h2>{MESSAGES.stats.feedbackSectionTitle}</h2>

      {loading ? (
        <div className="dashboard-cards">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : error ? (
        <ErrorState title={MESSAGES.stats.feedbackErrorTitle} onRetry={fetchFeedbackStats} />
      ) : periodError ? (
        <ErrorState title={periodError} onRetry={fetchFeedbackStats} />
      ) : timeout_ ? (
        <ErrorState title={MESSAGES.stats.feedbackTimeoutTitle} onRetry={fetchFeedbackStats} />
      ) : noOffer ? (
        <EmptyState
          title={MESSAGES.stats.feedbackEmptyNoOfferTitle}
          description={MESSAGES.stats.feedbackEmptyNoOfferDesc}
          action={
            canWriteChannel ? (
              <Link to={`/chatbots/${chatbotId}/channels`} className="btn btn-secondary">
                {MESSAGES.stats.feedbackEmptyNoOfferAction}
              </Link>
            ) : undefined
          }
        />
      ) : data ? (
        <>
          <div className="dashboard-cards stats-metric-row">
            <MetricCard
              label={MESSAGES.stats.feedbackRatedCountLabel}
              value={String(data.totals.ratedCount)}
              caption={MESSAGES.stats.feedbackCountCaption(data.totals.upCount, data.totals.downCount)}
            />
            <MetricCard
              label={MESSAGES.stats.feedbackPositiveRateLabel}
              value={formatRate(data.totals.positiveRate)}
              caption={
                data.totals.lowSample
                  ? `${MESSAGES.stats.feedbackSampleCaption(data.totals.ratedCount)} · ${MESSAGES.stats.feedbackLowSampleCaption}`
                  : MESSAGES.stats.feedbackSampleCaption(data.totals.ratedCount)
              }
            />
            <MetricCard
              label={MESSAGES.stats.feedbackParticipationRateLabel}
              value={formatRate(data.totals.participationRate)}
              caption={MESSAGES.stats.feedbackOfferedCaption(data.totals.offeredCount)}
            />
          </div>
          <p className="field-hint">
            <span aria-hidden="true">ⓘ</span> {MESSAGES.stats.feedbackParticipationHelp}
          </p>

          {noRating ? (
            <EmptyState title={MESSAGES.stats.feedbackEmptyNoRatingTitle} />
          ) : (
            <>
              <ChartFrame
                title={MESSAGES.stats.feedbackTrendTitle}
                summary={buildTrendSummary(
                  data.buckets.filter((b) => b.positiveRate !== null).map((b) => b.positiveRate as number),
                  MESSAGES.stats.feedbackPositiveRateLabel,
                  formatPercent,
                )}
                chart={
                  <div>
                    <BarChartSvg
                      data={data.buckets.map(
                        (b): BarDatum => ({
                          key: b.dayBucket,
                          label: b.dayBucket,
                          segments: [
                            { value: b.upCount, className: 'bar-segment--answered' },
                            { value: b.downCount, className: 'bar-segment--unanswered', pattern: 'hatch' },
                          ],
                        }),
                      )}
                      height={80}
                    />
                    <p className="chart-legend">
                      <span className="chart-legend-item">
                        <span className="chart-legend-swatch chart-legend-swatch--answered" aria-hidden="true" /> {MESSAGES.stats.feedbackLegendUp}
                      </span>
                      <span className="chart-legend-item">
                        <span className="chart-legend-swatch chart-legend-swatch--unanswered" aria-hidden="true" /> {MESSAGES.stats.feedbackLegendDown}
                      </span>
                    </p>
                  </div>
                }
                table={
                  <table className="chart-frame-data-table">
                    <caption className="sr-only">{MESSAGES.stats.feedbackTrendTitle}</caption>
                    <thead>
                      <tr>
                        <th scope="col">{MESSAGES.stats.tableColumnLabel}</th>
                        <th scope="col">👍</th>
                        <th scope="col">👎</th>
                        <th scope="col">{MESSAGES.stats.feedbackPositiveRateLabel}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.buckets.map((b) => (
                        <tr key={b.dayBucket}>
                          <th scope="row">{b.dayBucket}</th>
                          <td>{b.upCount}</td>
                          <td>{b.downCount}</td>
                          <td>{formatRate(b.positiveRate)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                }
              />

              <h3>{MESSAGES.stats.feedbackTopNegativeTitle}</h3>
              {data.topNegativeTargets.length === 0 ? (
                <p className="field-hint">{MESSAGES.stats.noDataShort}</p>
              ) : (
                <table className="chatbot-table">
                  <caption className="sr-only">{MESSAGES.stats.feedbackTopNegativeTitle}</caption>
                  <thead>
                    <tr>
                      <th scope="col">{MESSAGES.stats.feedbackTopNegativeColumnKind}</th>
                      <th scope="col">{MESSAGES.stats.feedbackTopNegativeColumnName}</th>
                      <th scope="col">{MESSAGES.stats.feedbackTopNegativeColumnDown}</th>
                      <th scope="col">{MESSAGES.stats.feedbackTopNegativeColumnUp}</th>
                      <th scope="col">
                        <span className="sr-only">{MESSAGES.stats.feedbackTopNegativeQueueLink}</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.topNegativeTargets.map((item, idx) => (
                      <tr key={`${item.kind}-${item.targetId ?? idx}`}>
                        <th scope="row">{MESSAGES.stats.feedbackTargetKind[item.kind] ?? item.kind}</th>
                        <td>{targetName(item)}</td>
                        <td>{item.downCount}</td>
                        <td>{item.upCount}</td>
                        <td>
                          <Link to={`/chatbots/${chatbotId}/stats/learning?source=NEGATIVE_FEEDBACK`}>
                            {MESSAGES.stats.feedbackTopNegativeQueueLink}
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}
        </>
      ) : (
        <SkeletonRow />
      )}
    </section>
  );
}
