import { MESSAGES } from '../../../constants/messages';

export interface ApiConnectionFilterBarProps {
  q: string;
  onQChange: (q: string) => void;
  enabled: boolean[];
  onEnabledChange: (enabled: boolean[]) => void;
}

/** AC1 — 검색 + 사용 여부 필터(ui-spec §3.1 레이아웃). 기본은 사용중/사용중지 둘 다 체크(D1 노드 목록과 동일 철학). */
export function ApiConnectionFilterBar({ q, onQChange, enabled, onEnabledChange }: ApiConnectionFilterBarProps): JSX.Element {
  const msg = MESSAGES.apiConnections;
  function toggle(v: boolean): void {
    onEnabledChange(enabled.includes(v) ? enabled.filter((x) => x !== v) : [...enabled, v]);
  }
  return (
    <div className="dialogue-filter-bar">
      <div className="form-field">
        <label htmlFor="api-conn-search">{msg.searchLabel}</label>
        <input id="api-conn-search" type="text" value={q} onChange={(e) => onQChange(e.target.value)} />
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
