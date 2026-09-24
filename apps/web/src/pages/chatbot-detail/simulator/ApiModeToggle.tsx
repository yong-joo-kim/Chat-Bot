import { MESSAGES } from '../../../constants/messages';
import type { SimulateApiMode } from '@chat-bot/shared-types';

export interface ApiModeToggleProps {
  mode: SimulateApiMode;
  onChange: (mode: SimulateApiMode) => void;
  liveDisabled: boolean;
  liveDisabledReason?: string;
}

/**
 * SIM1-ext — 목/실제 호출 전환 라디오 2개(ui-spec §3.7). `LIVE` 비활성은 **사전 안내**일 뿐이며
 * 최종 판정은 항상 서버가 한다(조건 불충족 시 서버가 자동으로 `MOCK` 격하 + `downgradeReason` 반환).
 */
export function ApiModeToggle({ mode, onChange, liveDisabled, liveDisabledReason }: ApiModeToggleProps): JSX.Element {
  const msg = MESSAGES.simulator;
  return (
    <fieldset className="api-mode-toggle form-field" role="radiogroup" aria-label={msg.apiModeLabel}>
      <legend>{msg.apiModeLabel}</legend>
      <label className="form-field--inline">
        <input type="radio" name="api-mode" checked={mode === 'MOCK'} onChange={() => onChange('MOCK')} />
        {msg.apiModeMock}
      </label>
      <label className="form-field--inline">
        <input
          type="radio"
          name="api-mode"
          checked={mode === 'LIVE'}
          disabled={liveDisabled}
          onChange={() => onChange('LIVE')}
        />
        {msg.apiModeLive}
      </label>
      {liveDisabled && liveDisabledReason && <span className="field-hint">{liveDisabledReason}</span>}
    </fieldset>
  );
}
