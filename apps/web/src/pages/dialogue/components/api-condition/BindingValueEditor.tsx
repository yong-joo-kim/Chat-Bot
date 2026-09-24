import type { ApiBinding } from '@chat-bot/shared-types';
import { MESSAGES } from '../../../../constants/messages';

export interface SlotOption {
  contextVariableId: string;
  slotName: string;
  label: string;
}

export interface BindingValueEditorProps {
  idPrefix: string;
  label: string;
  value: ApiBinding;
  onChange: (value: ApiBinding) => void;
  slotOptions: SlotOption[];
  maxLength?: number;
}

/**
 * `ApiBinding`(상수/폼 슬롯) 공용 에디터(ui-spec §2.2). 라디오 2개(UIUX §6 단일선택)로 종류를 고르고,
 * "폼 슬롯"은 이 노드의 인풋 조건에 걸린 컨텍스트의 슬롯 목록만 후보로 제공한다.
 */
export function BindingValueEditor({ idPrefix, label, value, onChange, slotOptions, maxLength = 500 }: BindingValueEditorProps): JSX.Element {
  const msg = MESSAGES.dialogue.outputFields;
  return (
    <div className="form-field">
      <span className="field-label-static">{label}</span>
      <div className="form-field--inline">
        <label className="form-field--inline">
          <input type="radio" name={`${idPrefix}-kind`} checked={value.kind === 'CONST'} onChange={() => onChange({ kind: 'CONST', value: '' })} />
          {msg.apiBindingKindConst}
        </label>
        <label className="form-field--inline">
          <input
            type="radio"
            name={`${idPrefix}-kind`}
            checked={value.kind === 'SLOT'}
            disabled={slotOptions.length === 0}
            onChange={() =>
              onChange({ kind: 'SLOT', contextVariableId: slotOptions[0]?.contextVariableId ?? '', slotName: slotOptions[0]?.slotName ?? '' })
            }
          />
          {msg.apiBindingKindSlot}
        </label>
      </div>
      {value.kind === 'CONST' && (
        <input
          id={`${idPrefix}-const`}
          type="text"
          maxLength={maxLength}
          value={value.value}
          onChange={(e) => onChange({ kind: 'CONST', value: e.target.value })}
          aria-label={label}
        />
      )}
      {value.kind === 'SLOT' &&
        (slotOptions.length === 0 ? (
          <p className="field-hint">{msg.apiBindingSlotEmptyHint}</p>
        ) : (
          <select
            id={`${idPrefix}-slot`}
            aria-label={label}
            value={value.slotName}
            onChange={(e) => {
              const opt = slotOptions.find((o) => o.slotName === e.target.value);
              if (opt) onChange({ kind: 'SLOT', contextVariableId: opt.contextVariableId, slotName: opt.slotName });
            }}
          >
            {slotOptions.map((o) => (
              <option key={o.slotName} value={o.slotName}>
                {o.label}
              </option>
            ))}
          </select>
        ))}
    </div>
  );
}
