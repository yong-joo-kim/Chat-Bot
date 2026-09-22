import { useState } from 'react';
import type { StatsBucket, StatsGranularity } from '@chat-bot/shared-types';
import { MESSAGES } from '../../constants/messages';
import { formatPercent } from '../../lib/date';
import { ChartFrame } from './ChartFrame';
import { BarChartSvg, type BarDatum } from './BarChartSvg';
import { buildTrendSummary } from './chartSummary';

type Metric = 'total' | 'answered' | 'unanswered' | 'blocked' | 'responseRate';

const METRIC_LABELS: Record<Metric, string> = {
  total: MESSAGES.stats.trendMetricTotal,
  answered: MESSAGES.stats.trendMetricAnswered,
  unanswered: MESSAGES.stats.trendMetricUnanswered,
  blocked: MESSAGES.stats.trendMetricBlocked,
  responseRate: MESSAGES.stats.trendMetricResponseRate,
};

const GRANULARITY_LABEL: Record<StatsGranularity, string> = {
  DAY: MESSAGES.stats.granularityDay,
  WEEK: MESSAGES.stats.granularityWeek,
  MONTH: MESSAGES.stats.granularityMonth,
};

function metricValue(bucket: StatsBucket, metric: Metric): number {
  switch (metric) {
    case 'total':
      return bucket.turnCount;
    case 'answered':
      return bucket.answeredCount;
    case 'unanswered':
      return bucket.unansweredCount;
    case 'blocked':
      return bucket.blockedCount;
    case 'responseRate':
      return bucket.responseRate;
  }
}

function formatMetric(metric: Metric, value: number): string {
  return metric === 'responseRate' ? formatPercent(value) : `${value}건`;
}

/** S1 대화 추이 시계열 — 기본은 응답/미응답 누적 막대, 탭 전환은 추가 API 호출 없이 같은 버킷 배열을 재사용한다(F-1). */
export function StatsTrendChart({ buckets, granularity }: { buckets: StatsBucket[]; granularity: StatsGranularity }): JSX.Element {
  const [metric, setMetric] = useState<Metric>('total');

  const values = buckets.map((b) => metricValue(b, metric));
  const summary = buildTrendSummary(values, METRIC_LABELS[metric], (v) => formatMetric(metric, v));

  const barData: BarDatum[] = buckets.map((b) => ({
    key: b.key,
    label: b.label,
    segments:
      metric === 'total'
        ? [
            { value: b.answeredCount, className: 'bar-segment--answered' },
            { value: b.unansweredCount, className: 'bar-segment--unanswered', pattern: 'hatch' },
          ]
        : [{ value: metricValue(b, metric), className: 'bar-segment--single' }],
  }));

  const chart = (
    <div>
      <BarChartSvg data={barData} />
      {metric === 'total' && (
        <p className="chart-legend">
          <span className="chart-legend-item">
            <span className="chart-legend-swatch chart-legend-swatch--answered" aria-hidden="true" /> {MESSAGES.stats.trendLegendAnswered}
          </span>
          <span className="chart-legend-item">
            <span className="chart-legend-swatch chart-legend-swatch--unanswered" aria-hidden="true" /> {MESSAGES.stats.trendLegendUnanswered}
          </span>
        </p>
      )}
    </div>
  );

  const table = (
    <table className="chart-frame-data-table">
      <caption className="sr-only">{MESSAGES.stats.trendTitle(GRANULARITY_LABEL[granularity])}</caption>
      <thead>
        <tr>
          <th scope="col">{MESSAGES.stats.tableColumnLabel}</th>
          <th scope="col">{MESSAGES.stats.trendMetricTotal}</th>
          <th scope="col">{MESSAGES.stats.trendMetricAnswered}</th>
          <th scope="col">{MESSAGES.stats.trendMetricUnanswered}</th>
          <th scope="col">{MESSAGES.stats.trendMetricBlocked}</th>
          <th scope="col">{MESSAGES.stats.trendMetricResponseRate}</th>
        </tr>
      </thead>
      <tbody>
        {buckets.map((b) => (
          <tr key={b.key}>
            <th scope="row">{b.label}</th>
            <td>{b.turnCount}</td>
            <td>{b.answeredCount}</td>
            <td>{b.unansweredCount}</td>
            <td>{b.blockedCount}</td>
            <td>{formatPercent(b.responseRate)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <div className="stats-trend-chart">
      <div className="chart-metric-tabs" role="group" aria-label={MESSAGES.stats.trendTitle(GRANULARITY_LABEL[granularity])}>
        {(Object.keys(METRIC_LABELS) as Metric[]).map((m) => (
          <button
            key={m}
            type="button"
            className="btn btn-secondary chart-metric-tab"
            aria-pressed={metric === m}
            onClick={() => setMetric(m)}
          >
            {METRIC_LABELS[m]}
          </button>
        ))}
      </div>
      <ChartFrame title={MESSAGES.stats.trendTitle(GRANULARITY_LABEL[granularity])} summary={summary} chart={chart} table={table} />
    </div>
  );
}
