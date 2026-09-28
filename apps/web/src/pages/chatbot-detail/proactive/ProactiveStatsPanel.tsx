import { useEffect, useState } from 'react';
import type { ProactiveStatsResponse } from '@chat-bot/shared-types';
import { PROACTIVE_LIMITS } from '@chat-bot/shared-types';
import { proactiveApi } from '../../../api/proactive';
import { SkeletonRow } from '../../../components/Skeleton';
import { ErrorState } from '../../../components/ErrorState';
import { EmptyState } from '../../../components/EmptyState';
import { InlineFieldError } from '../../../components/InlineFieldError';
import { MESSAGES } from '../../../constants/messages';

function toDayBucket(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return toDayBucket(d);
}

function pct(rate: number | null): string {
  return rate === null ? '—' : `${(rate * 100).toFixed(1)}%`;
}

/** 그래프 막대 높이를 구간 내 최대값 기준으로 정규화한다(0으로 나누기 방지 — Medium #2). */
function barHeightPct(shown: number, maxShownInRange: number): number {
  return (shown / Math.max(1, maxShownInRange)) * 100;
}

/** [신규 No.35] PA-C6 — 선제 안내 통계(화면 설계서 §3.6). */
export function ProactiveStatsPanel({ chatbotId, onClose }: { chatbotId: string; onClose: () => void }): JSX.Element {
  const msg = MESSAGES.proactive.stats;
  const [range, setRange] = useState<'7' | '30' | 'custom'>('7');
  const [customFrom, setCustomFrom] = useState(daysAgo(7));
  const [customTo, setCustomTo] = useState(toDayBucket(new Date()));
  const [data, setData] = useState<ProactiveStatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [rangeError, setRangeError] = useState<string | undefined>(undefined);

  async function load(): Promise<void> {
    const from = range === '7' ? daysAgo(6) : range === '30' ? daysAgo(29) : customFrom;
    const to = range === 'custom' ? customTo : toDayBucket(new Date());
    const fromMs = new Date(from).getTime();
    const toMs = new Date(to).getTime();
    if (range === 'custom' && (toMs - fromMs) / 86_400_000 > PROACTIVE_LIMITS.statsRangeDaysMax) {
      setRangeError(msg.rangeTooLong);
      return;
    }
    setRangeError(undefined);
    setLoading(true);
    setError(false);
    try {
      const res = await proactiveApi.getStats(chatbotId, { from, to });
      setData(res);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatbotId, range]);

  return (
    <div className="proactive-stats-panel">
      <div className="proactive-stats-header">
        <h3>{msg.title}</h3>
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          {MESSAGES.common.close}
        </button>
      </div>

      <fieldset className="form-field">
        <legend className="sr-only">기간</legend>
        <label className="form-field--inline">
          <input type="radio" name="pa-stats-range" checked={range === '7'} onChange={() => setRange('7')} />
          {msg.rangeLast7}
        </label>
        <label className="form-field--inline">
          <input type="radio" name="pa-stats-range" checked={range === '30'} onChange={() => setRange('30')} />
          {msg.rangeLast30}
        </label>
        <label className="form-field--inline">
          <input type="radio" name="pa-stats-range" checked={range === 'custom'} onChange={() => setRange('custom')} />
          {msg.rangeCustom}
        </label>
        {range === 'custom' && (
          <>
            <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} aria-label="시작일" />
            <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} aria-label="종료일" />
            <button type="button" className="btn btn-secondary" onClick={() => void load()}>
              {MESSAGES.common.confirm}
            </button>
          </>
        )}
      </fieldset>
      <InlineFieldError id="pa-stats-range-error" message={rangeError} />

      {loading && (
        <>
          <SkeletonRow />
          <SkeletonRow />
        </>
      )}
      {!loading && error && <ErrorState title={msg.loadFailed} onRetry={() => void load()} />}
      {!loading && !error && data && data.totals.length === 0 && <EmptyState title={msg.emptyRange} />}
      {!loading && !error && data && data.totals.length > 0 && (
        <>
          <table className="dialogue-table">
            <thead>
              <tr>
                <th scope="col">{msg.columnRule}</th>
                <th scope="col">{msg.columnShown}</th>
                <th scope="col">{msg.columnClicked}</th>
                <th scope="col">{msg.columnDismissed}</th>
                <th scope="col">{msg.columnOptedOut}</th>
                <th scope="col">{msg.columnClickRate}</th>
                <th scope="col">{msg.columnDismissRate}</th>
                <th scope="col">{msg.columnOptOutRate}</th>
              </tr>
            </thead>
            <tbody>
              {data.totals.map((t) => (
                <tr key={t.ruleId}>
                  <td>
                    {t.name}
                    {t.deleted && <span className="channel-status-badge channel-status-badge--neutral">{msg.deletedBadge}</span>}
                    {t.frequentlyDismissed && <span className="field-hint">ⓘ자주닫힘</span>}
                  </td>
                  <td>{t.shown}</td>
                  <td>{t.clicked}</td>
                  <td>{t.dismissed}</td>
                  <td>{t.optedOut}</td>
                  <td>{pct(t.clickRate)}</td>
                  <td>{pct(t.dismissRate)}</td>
                  <td>{pct(t.optOutRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h4>{msg.dailyTableTitle}</h4>
          <table className="dialogue-table">
            <thead>
              <tr>
                <th scope="col">일자</th>
                <th scope="col">{msg.columnShown}</th>
                <th scope="col">{msg.columnClicked}</th>
                <th scope="col">{msg.columnDismissed}</th>
                <th scope="col">{msg.columnOptedOut}</th>
              </tr>
            </thead>
            <tbody>
              {data.daily.map((d, i) => (
                <tr key={`${d.day}-${d.ruleId}-${i}`}>
                  <td>{d.day}</td>
                  <td>{d.shown}</td>
                  <td>{d.clicked}</td>
                  <td>{d.dismissed}</td>
                  <td>{d.optedOut}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <h4>{msg.dailyChartTitle}</h4>
          <div className="proactive-stats-chart" aria-hidden="true">
            {(() => {
              const maxShownInRange = Math.max(0, ...data.daily.map((d) => d.shown));
              return data.daily.map((d, i) => (
                <span key={i} className="proactive-stats-bar" style={{ height: `${barHeightPct(d.shown, maxShownInRange)}%` }} />
              ));
            })()}
          </div>
        </>
      )}

      <p className="field-hint">
        <span aria-hidden="true">ⓘ</span> {msg.basisNotice}
      </p>
    </div>
  );
}
