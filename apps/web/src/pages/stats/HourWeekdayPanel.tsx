import type { StatsDistribution } from '@chat-bot/shared-types';
import { MESSAGES } from '../../constants/messages';
import { formatPercent } from '../../lib/date';
import { ChartFrame } from './ChartFrame';
import { BarChartSvg, type BarDatum } from './BarChartSvg';

/** S1 이용동향(FR-14-28/29/30) — 버킷 시계열과 다른 축(기간 합산)임을 섹션 타이틀로 명시한다. */
export function HourWeekdayPanel({ distribution }: { distribution: StatsDistribution }): JSX.Element {
  const { byHour, byWeekday } = distribution;

  const hourPeak = byHour.reduce((max, h) => (h.turnCount > max.turnCount ? h : max), byHour[0]);
  const hourSummary =
    hourPeak.turnCount > 0
      ? `이용이 가장 많은 시간대는 ${hourPeak.hour}시(${hourPeak.turnCount}건)입니다.`
      : '집계된 이용 데이터가 없습니다.';
  const hourBars: BarDatum[] = byHour.map((h) => ({
    key: String(h.hour),
    label: `${h.hour}시`,
    segments: [{ value: h.turnCount, className: 'bar-segment--single' }],
  }));
  const hourTable = (
    <table className="chart-frame-data-table">
      <caption className="sr-only">{MESSAGES.stats.hourTitle}</caption>
      <thead>
        <tr>
          <th scope="col">시</th>
          <th scope="col">턴 수</th>
        </tr>
      </thead>
      <tbody>
        {byHour.map((h) => (
          <tr key={h.hour}>
            <th scope="row">{h.hour}시</th>
            <td>{h.turnCount}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  const weekdayPeak = byWeekday.reduce((max, w) => (w.turnCount > max.turnCount ? w : max), byWeekday[0]);
  const weekdaySummary =
    weekdayPeak.turnCount > 0
      ? `이용이 가장 많은 요일은 ${MESSAGES.stats.weekdayLabels[weekdayPeak.weekday]}요일(${weekdayPeak.turnCount}건)입니다.`
      : '집계된 이용 데이터가 없습니다.';
  const weekdayBars: BarDatum[] = byWeekday.map((w) => ({
    key: String(w.weekday),
    label: MESSAGES.stats.weekdayLabels[w.weekday],
    segments: [{ value: w.turnCount, className: 'bar-segment--single' }],
  }));
  const weekdayTable = (
    <table className="chart-frame-data-table">
      <caption className="sr-only">{MESSAGES.stats.weekdayTitle}</caption>
      <thead>
        <tr>
          <th scope="col">요일</th>
          <th scope="col">턴 수</th>
          <th scope="col">응답률</th>
        </tr>
      </thead>
      <tbody>
        {byWeekday.map((w) => (
          <tr key={w.weekday}>
            <th scope="row">{MESSAGES.stats.weekdayLabels[w.weekday]}</th>
            <td>{w.turnCount}</td>
            <td>{formatPercent(w.responseRate)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <section className="hour-weekday-panel">
      <h2>{MESSAGES.stats.usageTitle}</h2>
      <div className="hour-weekday-grid">
        <ChartFrame title={MESSAGES.stats.hourTitle} summary={hourSummary} chart={<BarChartSvg data={hourBars} />} table={hourTable} />
        <ChartFrame
          title={MESSAGES.stats.weekdayTitle}
          summary={weekdaySummary}
          chart={<BarChartSvg data={weekdayBars} />}
          table={weekdayTable}
        />
      </div>
    </section>
  );
}
