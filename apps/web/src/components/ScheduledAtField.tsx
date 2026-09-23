import { MESSAGES } from '../constants/messages';

export interface ScheduledAtFieldProps {
  idPrefix: string;
  timezoneLabel: string;
  date: string;
  hour: string;
  minute: string;
  onDateChange: (v: string) => void;
  onHourChange: (v: string) => void;
  onMinuteChange: (v: string) => void;
  relativeText?: string;
  error?: string;
  disabled?: boolean;
}

/**
 * 날짜·시·분 텍스트 입력(FR-D7-3, NFR-DA1, `scheduled-deploy-ui-spec.md` §4.3.2). 달력은 없다
 * (보조 입력 수단을 만들지 않고 텍스트 입력만으로 완결 가능하게 한다 — 마우스 단독 입력 금지).
 * 레이블에 시간대를 항상 포함한다.
 */
export function ScheduledAtField({
  idPrefix,
  timezoneLabel: tzLabel,
  date,
  hour,
  minute,
  onDateChange,
  onHourChange,
  onMinuteChange,
  relativeText,
  error,
  disabled,
}: ScheduledAtFieldProps): JSX.Element {
  const msg = MESSAGES.deploySchedules.dialog;
  const errorId = `${idPrefix}-error`;

  return (
    <div className="form-field scheduled-at-field" role="group" aria-label={msg.scheduledAtAriaLabel(tzLabel)}>
      <span className="field-label-static">
        {msg.scheduledAtLabel} ({tzLabel}) <span className="required-mark" aria-hidden="true">*</span>
      </span>
      <div className="scheduled-at-field-inputs">
        <label htmlFor={`${idPrefix}-date`}>{msg.dateLabel}</label>
        <input
          id={`${idPrefix}-date`}
          type="text"
          inputMode="numeric"
          placeholder="YYYY-MM-DD"
          value={date}
          disabled={disabled}
          aria-describedby={error ? errorId : undefined}
          aria-invalid={Boolean(error)}
          onChange={(e) => onDateChange(e.target.value)}
        />
        <label htmlFor={`${idPrefix}-hour`}>{msg.hourLabel}</label>
        <input
          id={`${idPrefix}-hour`}
          type="text"
          inputMode="numeric"
          placeholder="HH"
          maxLength={2}
          value={hour}
          disabled={disabled}
          onChange={(e) => onHourChange(e.target.value)}
        />
        <label htmlFor={`${idPrefix}-minute`}>{msg.minuteLabel}</label>
        <input
          id={`${idPrefix}-minute`}
          type="text"
          inputMode="numeric"
          placeholder="mm"
          maxLength={2}
          value={minute}
          disabled={disabled}
          onChange={(e) => onMinuteChange(e.target.value)}
        />
      </div>
      {relativeText && !error && (
        <p className="field-hint" role="status" aria-live="polite">
          {msg.scheduledAtRelative(relativeText)}
        </p>
      )}
      {error && (
        <p id={errorId} className="field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
