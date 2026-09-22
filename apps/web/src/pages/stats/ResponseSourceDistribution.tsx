import { Link } from 'react-router-dom';
import type { StatsDistribution } from '@chat-bot/shared-types';
import { RESPONSE_SOURCE_LABELS } from '@chat-bot/shared-types';
import { MESSAGES } from '../../constants/messages';
import { formatPercent } from '../../lib/date';
import { ChartFrame } from './ChartFrame';

/** S1 응답 출처 분포(FR-14-20/21). `폴백` 조각은 학습현황으로 이동하는 딥링크를 갖는다(S-2, AC-UI-8). */
export function ResponseSourceDistribution({
  chatbotId,
  distribution,
}: {
  chatbotId: string;
  distribution: StatsDistribution;
}): JSX.Element {
  const { bySource } = distribution;
  const summary = bySource.map((s) => `${RESPONSE_SOURCE_LABELS[s.source]} ${formatPercent(s.ratio)}(${s.count}건)`).join(', ');

  // ⚠ role="img"로 감싸는 ChartFrame 내부에는 포커스 가능한 링크를 두지 않는다(axe nested-interactive).
  // 딥링크(FR-14-21)는 ChartFrame 바깥의 별도 문단에서, 차트/표 보기와 무관하게 항상 제공한다.
  const chart = (
    <ul className="dist-bar-list">
      {bySource.map((s) => (
        <li key={s.source} className="dist-bar-row">
          <span className="dist-bar-label">{RESPONSE_SOURCE_LABELS[s.source]}</span>
          <span className="dist-bar-track">
            <span
              className={`dist-bar-fill dist-bar-fill--${s.source.toLowerCase()}${s.source === 'FALLBACK' ? ' dist-bar-fill--hatch' : ''}`}
              style={{ width: `${Math.max(s.ratio * 100, s.count > 0 ? 2 : 0)}%` }}
            />
          </span>
          <span className="dist-bar-value">
            {formatPercent(s.ratio)}({s.count}건)
          </span>
        </li>
      ))}
    </ul>
  );

  const table = (
    <table className="chart-frame-data-table">
      <caption className="sr-only">{MESSAGES.stats.sourceTitle}</caption>
      <thead>
        <tr>
          <th scope="col">{MESSAGES.stats.sourceTitle}</th>
          <th scope="col">건수</th>
          <th scope="col">비율</th>
        </tr>
      </thead>
      <tbody>
        {bySource.map((s) => (
          <tr key={s.source}>
            <th scope="row">{RESPONSE_SOURCE_LABELS[s.source]}</th>
            <td>{s.count}</td>
            <td>{formatPercent(s.ratio)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  const fallback = bySource.find((s) => s.source === 'FALLBACK');

  return (
    <div>
      <ChartFrame title={MESSAGES.stats.sourceTitle} summary={summary} chart={chart} table={table} />
      {fallback && (
        <p className="dist-fallback-link">
          {RESPONSE_SOURCE_LABELS.FALLBACK} {formatPercent(fallback.ratio)}({fallback.count}건){' '}
          <Link to={`/chatbots/${chatbotId}/stats/learning?status=PENDING`}>{MESSAGES.stats.fallbackLinkLabel}</Link>
        </p>
      )}
    </div>
  );
}
