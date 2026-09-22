import { MESSAGES } from '../../../constants/messages';

/**
 * 시뮬레이터의 `useRag` 체크박스(FR-N2-3, ui-spec §4.2.1). 기본 꺼짐 — 비용이 드는 옵션을
 * 임의로 사전 선택하지 않는다(UIUX §6). 캡션은 체크 여부와 무관하게 상시 노출한다.
 */
export function RagUsageToggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }): JSX.Element {
  const msg = MESSAGES.simulator.ragToggle;
  return (
    <div className="rag-usage-toggle">
      <label className="form-field--inline">
        <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
        {msg.label}
      </label>
      <p className="field-hint">{msg.caption}</p>
    </div>
  );
}
