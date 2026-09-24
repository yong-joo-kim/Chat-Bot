import type { AlertLevel } from '@chat-bot/shared-types';
import { MESSAGES } from '../../constants/messages';

const ALERT_OPTIONS: AlertLevel[] = ['WARNING', 'CAUTION'];

/** HC1 필터바(hybrid-cs-ui-spec.md §3.2 `LiveSessionFilterBar`). */
export function LiveSessionFilterBar({
  alert,
  onAlertChange,
  handoff,
  onHandoffChange,
}: {
  alert: AlertLevel[];
  onAlertChange: (v: AlertLevel[]) => void;
  handoff: 'NONE' | 'ACTIVE' | 'ENDED' | '';
  onHandoffChange: (v: 'NONE' | 'ACTIVE' | 'ENDED' | '') => void;
}): JSX.Element {
  const msg = MESSAGES.handoffConsole;

  function toggleAlert(v: AlertLevel): void {
    if (alert.includes(v)) onAlertChange(alert.filter((a) => a !== v));
    else onAlertChange([...alert, v]);
  }

  return (
    <div className="chatbot-filter-bar">
      <fieldset className="status-filter">
        <legend>{msg.filterAlertLabel}</legend>
        <label className="status-filter-option">
          <input type="checkbox" checked={alert.length === 0} onChange={() => onAlertChange([])} />
          {msg.filterAllLabel}
        </label>
        {ALERT_OPTIONS.map((v) => (
          <label key={v} className="status-filter-option">
            <input type="checkbox" checked={alert.includes(v)} onChange={() => toggleAlert(v)} />
            {v === 'WARNING' ? msg.alertWarning : msg.alertCaution}
          </label>
        ))}
      </fieldset>
      <label className="form-field--inline">
        {msg.filterHandoffLabel}
        <select value={handoff} onChange={(e) => onHandoffChange(e.target.value as 'NONE' | 'ACTIVE' | 'ENDED' | '')}>
          <option value="">{msg.filterAllLabel}</option>
          <option value="ACTIVE">{msg.summaryConnected}</option>
          <option value="NONE">{msg.handoffNone}</option>
        </select>
      </label>
    </div>
  );
}
