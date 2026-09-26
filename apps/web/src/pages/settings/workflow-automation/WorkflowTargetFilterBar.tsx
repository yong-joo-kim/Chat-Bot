import { MESSAGES } from '../../../constants/messages';

export interface WorkflowTargetFilterBarProps {
  q: string;
  onQChange: (q: string) => void;
  enabled: boolean[];
  onEnabledChange: (enabled: boolean[]) => void;
  includePaused: boolean;
  onIncludePausedChange: (v: boolean) => void;
}

/** WF1 — 검색 + 사용 여부/정지 포함 필터(ui-spec §3.1 레이아웃, `ApiConnectionFilterBar` 선례). */
export function WorkflowTargetFilterBar({
  q,
  onQChange,
  enabled,
  onEnabledChange,
  includePaused,
  onIncludePausedChange,
}: WorkflowTargetFilterBarProps): JSX.Element {
  const msg = MESSAGES.workflowTargets;
  function toggle(v: boolean): void {
    onEnabledChange(enabled.includes(v) ? enabled.filter((x) => x !== v) : [...enabled, v]);
  }
  return (
    <div className="dialogue-filter-bar">
      <div className="form-field">
        <label htmlFor="workflow-target-search">{msg.searchLabel}</label>
        <input id="workflow-target-search" type="text" value={q} onChange={(e) => onQChange(e.target.value)} />
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
      <label className="form-field--inline">
        <input type="checkbox" checked={includePaused} onChange={(e) => onIncludePausedChange(e.target.checked)} />
        {msg.filterIncludePaused}
      </label>
    </div>
  );
}
