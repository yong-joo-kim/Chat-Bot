import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { IntentStats } from '@chat-bot/shared-types';
import { statsApi } from '../../api/stats';
import { ApiError } from '../../api/client';
import { MESSAGES } from '../../constants/messages';
import { SkeletonRow } from '../../components/Skeleton';
import { ErrorState } from '../../components/ErrorState';
import { EmptyState } from '../../components/EmptyState';
import { formatPercent } from '../../lib/date';

type Denominator = 'matched' | 'all';

/**
 * S1 하단 "의도별 매칭" 섹션(No.29, J-13, `integrated-stats-ui-spec.md` §4). 기존 3개 API(요약/분포/질문)와
 * 독립적인 4번째 요청(`GET /stats/intents`)이며, S1 상위의 `from`/`to` 상태만 구독하고 별도 기간 컨트롤을
 * 만들지 않는다(§4.4).
 */
export function IntentMatchSection({ chatbotId, from, to }: { chatbotId: string; from: string; to: string }): JSX.Element {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [periodError, setPeriodError] = useState<string | undefined>();
  const [data, setData] = useState<IntentStats | null>(null);
  const [denominator, setDenominator] = useState<Denominator>('matched');

  const fetchIntents = useCallback(async () => {
    setLoading(true);
    setError(false);
    setPeriodError(undefined);
    try {
      const res = await statsApi.getIntentStats({ chatbotId, from: from || undefined, to: to || undefined, topN: 10 });
      setData(res);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'STATS_RANGE_TOO_WIDE') {
        setPeriodError(e.message);
      } else {
        setError(true);
      }
    } finally {
      setLoading(false);
    }
  }, [chatbotId, from, to]);

  useEffect(() => {
    void fetchIntents();
  }, [fetchIntents]);

  return (
    <section className="intent-match-section">
      <div className="intent-match-header">
        <h2>{MESSAGES.stats.intentSectionTitle}</h2>
        {data && data.matchedTurnCount > 0 && (
          <fieldset className="intent-denominator-toggle">
            <legend>{MESSAGES.stats.intentDenominatorLegend}</legend>
            <div className="period-selector-options" role="radiogroup" aria-label={MESSAGES.stats.intentDenominatorLegend}>
              <label className="period-radio">
                <input
                  type="radio"
                  name="intent-denominator"
                  checked={denominator === 'matched'}
                  onChange={() => setDenominator('matched')}
                />
                {MESSAGES.stats.intentDenominatorMatched}
              </label>
              <label className="period-radio">
                <input type="radio" name="intent-denominator" checked={denominator === 'all'} onChange={() => setDenominator('all')} />
                {MESSAGES.stats.intentDenominatorAll}
              </label>
            </div>
          </fieldset>
        )}
      </div>

      {loading ? (
        <SkeletonRow />
      ) : error ? (
        <ErrorState title={MESSAGES.stats.intentErrorTitle} onRetry={fetchIntents} />
      ) : periodError ? (
        <ErrorState title={periodError} onRetry={fetchIntents} />
      ) : data && data.matchedTurnCount === 0 ? (
        <EmptyState title={MESSAGES.stats.intentEmptyTitle} />
      ) : data ? (
        <>
          <p className="intent-summary-line">
            {MESSAGES.stats.intentSummary(data.totalTurnCount, data.matchedTurnCount, data.unmatchedTurnCount, data.distinctIntentCount)}
          </p>
          <table className="chatbot-table intent-table">
            <caption className="sr-only">{MESSAGES.stats.intentSectionTitle}</caption>
            <thead>
              <tr>
                <th scope="col">{MESSAGES.stats.intentColumnName}</th>
                <th scope="col">{MESSAGES.stats.intentColumnTurn}</th>
                <th scope="col">{MESSAGES.stats.intentColumnShare}</th>
                <th scope="col">{MESSAGES.stats.intentColumnResponseRate}</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((item) => (
                <tr key={item.intentId}>
                  <th scope="row">
                    {item.deleted ? (
                      <span title={MESSAGES.stats.intentDeletedTitle}>{MESSAGES.stats.intentDeletedLabel(item.intentId.slice(0, 8))}</span>
                    ) : (
                      <Link to={`/chatbots/${chatbotId}/dialogue/intents?resource=intent&edit=${item.intentId}`}>
                        {item.name} <span aria-hidden="true">({MESSAGES.stats.intentEditLink})</span>
                      </Link>
                    )}
                  </th>
                  <td>{item.turnCount}</td>
                  <td>{formatPercent(denominator === 'matched' ? item.shareOfIntentMatched : item.shareOfAll)}</td>
                  <td>{formatPercent(item.responseRate)}</td>
                </tr>
              ))}
              {data.othersTurnCount > 0 && (
                <tr>
                  <th scope="row">{MESSAGES.stats.intentOthersRow}</th>
                  <td>{data.othersTurnCount}</td>
                  <td>{formatPercent(data.totalTurnCount > 0 ? data.othersTurnCount / (denominator === 'matched' ? data.matchedTurnCount || 1 : data.totalTurnCount) : 0)}</td>
                  <td>{MESSAGES.integratedStats.breakdownNoStatusValue}</td>
                </tr>
              )}
              {denominator === 'all' && data.unmatchedTurnCount > 0 && (
                <tr>
                  <th scope="row">{MESSAGES.stats.intentUnmatchedRow}</th>
                  <td>{data.unmatchedTurnCount}</td>
                  <td>{formatPercent(data.totalTurnCount > 0 ? data.unmatchedTurnCount / data.totalTurnCount : 0)}</td>
                  <td>{MESSAGES.integratedStats.breakdownNoStatusValue}</td>
                </tr>
              )}
            </tbody>
          </table>
        </>
      ) : null}
    </section>
  );
}
