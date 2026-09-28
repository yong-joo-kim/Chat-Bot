import { MESSAGES } from '../../../constants/messages';

export interface KbSourceFilterBarProps {
  q: string;
  onQChange: (q: string) => void;
  enabled: boolean[];
  onEnabledChange: (enabled: boolean[]) => void;
}

/** KB2 — 검색 + 사용 여부 필터(`ApiConnectionFilterBar`와 동형). */
export function KbSourceFilterBar({ q, onQChange, enabled, onEnabledChange }: KbSourceFilterBarProps): JSX.Element {
  const msg = MESSAGES.kbSources;
  function toggle(v: boolean): void {
    onEnabledChange(enabled.includes(v) ? enabled.filter((x) => x !== v) : [...enabled, v]);
  }
  return (
    <div className="dialogue-filter-bar">
      <div className="form-field">
        <label htmlFor="kb-source-search">{msg.searchLabel}</label>
        <input id="kb-source-search" type="text" value={q} onChange={(e) => onQChange(e.target.value)} />
      </div>
      <fieldset className="form-field">
        <legend>{msg.filterEnabledLabel}</legend>
        <label className="form-field--inline">
          <input type="checkbox" checked={enabled.includes(true)} onChange={() => toggle(true)} />
          {msg.filterEnabledOn}
        </label>
        <label className="form-field--inline">
          <input type="checkbox" checked={enabled.includes(false)} onChange={() => toggle(false)} />
          {msg.filterEnabledOff}
        </label>
      </fieldset>
    </div>
  );
}
