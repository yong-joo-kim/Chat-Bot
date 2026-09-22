import type { StatsGranularity } from '@chat-bot/shared-types';
import { STATS_LIMITS } from '@chat-bot/shared-types';
import { MESSAGES } from '../../constants/messages';
import { DateRangeField } from '../../components/DateRangeField';
import { formatDate } from '../../lib/date';

export interface GranularityPeriodControlProps {
  granularity: StatsGranularity;
  onGranularityChange: (g: StatsGranularity) => void;
  from: string;
  to: string;
  onRangeChange: (from: string, to: string) => void;
  periodStart?: Date;
  periodEnd?: Date;
  rangeDefaulted: boolean;
  errorMessage?: string;
}

const GRANULARITY_OPTIONS: { value: StatsGranularity; label: string }[] = [
  { value: 'DAY', label: MESSAGES.stats.granularityDay },
  { value: 'WEEK', label: MESSAGES.stats.granularityWeek },
  { value: 'MONTH', label: MESSAGES.stats.granularityMonth },
];

const MAX_RANGE_DAYS: Record<StatsGranularity, number> = {
  DAY: STATS_LIMITS.maxRangeDays,
  WEEK: STATS_LIMITS.maxRangeWeeks * 7,
  MONTH: STATS_LIMITS.maxRangeMonths * 31,
};

/**
 * 단위(일/주/월) + 커스텀 기간 컨트롤(§2.4). 기존 `PeriodSelector`(대시보드 전용)와는 별개다 —
 * 단위 축과 기간 축이 서로 독립적으로 움직인다(F-4).
 */
export function GranularityPeriodControl({
  granularity,
  onGranularityChange,
  from,
  to,
  onRangeChange,
  periodStart,
  periodEnd,
  rangeDefaulted,
  errorMessage,
}: GranularityPeriodControlProps): JSX.Element {
  return (
    <div className="granularity-period-control">
      <fieldset className="period-selector">
        <legend>{MESSAGES.stats.granularityLegend}</legend>
        <div className="period-selector-options" role="radiogroup" aria-label={MESSAGES.stats.granularityLegend}>
          {GRANULARITY_OPTIONS.map((opt) => (
            <label key={opt.value} className="period-radio">
              <input
                type="radio"
                name="stats-granularity"
                value={opt.value}
                checked={granularity === opt.value}
                onChange={() => onGranularityChange(opt.value)}
              />
              {opt.label}
            </label>
          ))}
        </div>
      </fieldset>
      <DateRangeField
        from={from}
        to={to}
        onChange={onRangeChange}
        maxRangeDays={MAX_RANGE_DAYS[granularity]}
        defaultedNotice={
          rangeDefaulted && periodStart && periodEnd
            ? MESSAGES.stats.rangeDefaultedNotice(formatDate(periodStart), formatDate(periodEnd))
            : undefined
        }
        errorMessage={errorMessage}
      />
      {periodStart && periodEnd && !rangeDefaulted && (
        <span className="stats-result-badge">{MESSAGES.stats.resultSummary(formatDate(periodStart), formatDate(periodEnd))}</span>
      )}
    </div>
  );
}
