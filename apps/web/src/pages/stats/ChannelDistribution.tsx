import type { StatsDistribution } from '@chat-bot/shared-types';
import { MESSAGES } from '../../constants/messages';
import { formatPercent } from '../../lib/date';
import { ChartFrame } from './ChartFrame';

/** S1 채널 분포(FR-14-15, EX-14-11). 채널이 1종뿐이어도 캡션으로 그 사실을 알린다. */
export function ChannelDistribution({ distribution }: { distribution: StatsDistribution }): JSX.Element {
  const { byChannel } = distribution;
  const summary = byChannel.map((c) => `${c.channelType} ${formatPercent(c.ratio)}(${c.sessionCount}건)`).join(', ');

  const chart = (
    <>
      <ul className="dist-bar-list">
        {byChannel.map((c) => (
          <li key={c.channelType} className="dist-bar-row">
            <span className="dist-bar-label">{c.channelType}</span>
            <span className="dist-bar-track">
              <span className="dist-bar-fill dist-bar-fill--channel" style={{ width: `${Math.max(c.ratio * 100, 2)}%` }} />
            </span>
            <span className="dist-bar-value">
              {formatPercent(c.ratio)}({c.sessionCount}건)
            </span>
          </li>
        ))}
      </ul>
      {byChannel.length <= 1 && <p className="field-hint">{MESSAGES.stats.channelSingleCaption}</p>}
    </>
  );

  const table = (
    <table className="chart-frame-data-table">
      <caption className="sr-only">{MESSAGES.stats.channelTitle}</caption>
      <thead>
        <tr>
          <th scope="col">{MESSAGES.stats.channelTitle}</th>
          <th scope="col">세션 수</th>
          <th scope="col">비율</th>
        </tr>
      </thead>
      <tbody>
        {byChannel.map((c) => (
          <tr key={c.channelType}>
            <th scope="row">{c.channelType}</th>
            <td>{c.sessionCount}</td>
            <td>{formatPercent(c.ratio)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  return <ChartFrame title={MESSAGES.stats.channelTitle} summary={summary} chart={chart} table={table} />;
}
