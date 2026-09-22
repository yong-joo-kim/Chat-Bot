import { MESSAGES } from '../constants/messages';
import { InlineFieldError } from './InlineFieldError';

export interface DateRangeFieldProps {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
  maxRangeDays?: number;
  defaultedNotice?: string;
  errorMessage?: string;
}

/** `<input type="date">` 2개 + 상한 안내(security-audit-ui-spec.md §2.3, FR-13-17). */
export function DateRangeField({ from, to, onChange, maxRangeDays, defaultedNotice, errorMessage }: DateRangeFieldProps): JSX.Element {
  return (
    <div className="form-field form-field--inline date-range-field">
      <label htmlFor="date-range-from">{MESSAGES.auditLogs.fromLabel}</label>
      <input id="date-range-from" type="date" value={from} onChange={(e) => onChange(e.target.value, to)} />
      <span aria-hidden="true">~</span>
      <label htmlFor="date-range-to">{MESSAGES.auditLogs.toLabel}</label>
      <input id="date-range-to" type="date" value={to} onChange={(e) => onChange(from, e.target.value)} />
      {maxRangeDays !== undefined && <span className="field-hint">{MESSAGES.auditLogs.maxRangeHint(maxRangeDays)}</span>}
      {defaultedNotice && <span className="field-hint">{defaultedNotice}</span>}
      <InlineFieldError id="date-range-error" message={errorMessage} />
    </div>
  );
}
