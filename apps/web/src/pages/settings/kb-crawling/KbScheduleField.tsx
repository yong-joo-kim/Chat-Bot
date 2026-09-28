import type { KbSchedule } from '@chat-bot/shared-types';
import { MESSAGES } from '../../../constants/messages';

export interface KbScheduleFieldProps {
  value: KbSchedule;
  onChange: (value: KbSchedule) => void;
  disabled?: boolean;
}

const WEEKDAYS = MESSAGES.kbSources.scheduleWeekdayLabel;

/**
 * [신규 No.43] 주기 선택(`kb-crawling-ui-spec.md` §2.2 `KbScheduleField`) — 안 함(수동)/매일/매주
 * 라디오 3종, 첫 선택이 "수동"이 아니면 시각 입력이 나타난다(UIUX §6 조건부 표시 규칙).
 */
export function KbScheduleField({ value, onChange, disabled }: KbScheduleFieldProps): JSX.Element {
  const msg = MESSAGES.kbSources;
  return (
    <fieldset className="form-field">
      <legend>{msg.formScheduleLabel}</legend>
      <label className="form-field--inline">
        <input
          type="radio"
          name="kb-schedule-kind"
          checked={value.kind === 'MANUAL'}
          disabled={disabled}
          onChange={() => onChange({ kind: 'MANUAL' })}
        />
        {msg.scheduleLabel.MANUAL}
      </label>
      <label className="form-field--inline">
        <input
          type="radio"
          name="kb-schedule-kind"
          checked={value.kind === 'DAILY'}
          disabled={disabled}
          onChange={() => onChange({ kind: 'DAILY', time: value.kind === 'DAILY' ? value.time : '03:00' })}
        />
        {msg.scheduleLabel.DAILY}
      </label>
      {value.kind === 'DAILY' && (
        <label className="form-field--inline">
          <span className="sr-only">{msg.scheduleLabel.DAILY} 시각</span>
          <input
            type="time"
            value={value.time}
            disabled={disabled}
            onChange={(e) => onChange({ kind: 'DAILY', time: e.target.value })}
          />
        </label>
      )}
      <label className="form-field--inline">
        <input
          type="radio"
          name="kb-schedule-kind"
          checked={value.kind === 'WEEKLY'}
          disabled={disabled}
          onChange={() => onChange({ kind: 'WEEKLY', weekday: value.kind === 'WEEKLY' ? value.weekday : 1, time: value.kind === 'WEEKLY' ? value.time : '02:00' })}
        />
        {msg.scheduleLabel.WEEKLY}
      </label>
      {value.kind === 'WEEKLY' && (
        <>
          <label className="form-field--inline">
            <span className="sr-only">{msg.scheduleLabel.WEEKLY} 요일</span>
            <select
              value={value.weekday}
              disabled={disabled}
              onChange={(e) => onChange({ kind: 'WEEKLY', weekday: Number(e.target.value), time: value.time })}
            >
              {WEEKDAYS.map((label, i) => (
                <option key={i} value={i}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="form-field--inline">
            <span className="sr-only">{msg.scheduleLabel.WEEKLY} 시각</span>
            <input type="time" value={value.time} disabled={disabled} onChange={(e) => onChange({ kind: 'WEEKLY', weekday: value.weekday, time: e.target.value })} />
          </label>
        </>
      )}
    </fieldset>
  );
}
