import { MESSAGES } from '../../constants/messages';

export type PeriodPreset = 'TODAY' | '7D' | '30D' | 'CUSTOM';

export interface PeriodSelectorProps {
  preset: PeriodPreset;
  onPresetChange: (preset: PeriodPreset) => void;
  from: string;
  to: string;
  onFromChange: (value: string) => void;
  onToChange: (value: string) => void;
}

const PRESET_OPTIONS: { value: PeriodPreset; label: string }[] = [
  { value: 'TODAY', label: MESSAGES.dashboard.periodToday },
  { value: '7D', label: MESSAGES.dashboard.period7d },
  { value: '30D', label: MESSAGES.dashboard.period30d },
  { value: 'CUSTOM', label: MESSAGES.dashboard.periodCustom },
];

/** 기간 프리셋(FR-2-6). `CUSTOM` 선택 시 날짜 입력 2종이 각각 `<label>`과 연결되어 노출된다. */
export function PeriodSelector({
  preset,
  onPresetChange,
  from,
  to,
  onFromChange,
  onToChange,
}: PeriodSelectorProps): JSX.Element {
  return (
    <fieldset className="period-selector">
      <legend className="sr-only">조회 기간</legend>
      <div className="period-selector-options" role="radiogroup" aria-label="조회 기간 프리셋">
        {PRESET_OPTIONS.map((opt) => (
          <label key={opt.value} className="period-radio">
            <input
              type="radio"
              name="period-preset"
              value={opt.value}
              checked={preset === opt.value}
              onChange={() => onPresetChange(opt.value)}
            />
            {opt.label}
          </label>
        ))}
      </div>
      {preset === 'CUSTOM' && (
        <div className="period-custom-inputs">
          <label htmlFor="period-from">{MESSAGES.dashboard.fromLabel}</label>
          <input id="period-from" type="date" value={from} onChange={(e) => onFromChange(e.target.value)} />
          <label htmlFor="period-to">{MESSAGES.dashboard.toLabel}</label>
          <input id="period-to" type="date" value={to} onChange={(e) => onToChange(e.target.value)} />
        </div>
      )}
    </fieldset>
  );
}
