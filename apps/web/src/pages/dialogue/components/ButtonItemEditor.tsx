import type { ButtonItem } from '@chat-bot/shared-types';
import { InlineFieldError } from '../../../components/InlineFieldError';
import { ResourcePickerField } from '../../../components/ResourcePickerField';
import { MESSAGES } from '../../../constants/messages';

export interface ButtonItemEditorProps {
  value: ButtonItem;
  onChange: (value: ButtonItem) => void;
  chatbotId: string;
  idPrefix: string;
  labelError?: string;
  valueError?: string;
}

/** 버튼 아이템 공용 서브컴포넌트(ui-spec §4.2.1 표 하단) — `action`에 따라 `value` 입력 UI가 바뀐다. */
export function ButtonItemEditor({ value, onChange, chatbotId, idPrefix, labelError, valueError }: ButtonItemEditorProps): JSX.Element {
  const msg = MESSAGES.dialogue.outputFields;

  function handleActionChange(action: ButtonItem['action']): void {
    onChange({ ...value, action, value: '' });
  }

  return (
    <div className="button-item-editor">
      <div className="form-field">
        <label htmlFor={`${idPrefix}-label`}>{msg.buttonLabel}</label>
        <input
          id={`${idPrefix}-label`}
          type="text"
          maxLength={40}
          value={value.label}
          onChange={(e) => onChange({ ...value, label: e.target.value })}
          aria-invalid={Boolean(labelError)}
        />
        <InlineFieldError id={`${idPrefix}-label-error`} message={labelError} />
      </div>
      <div className="form-field">
        <label htmlFor={`${idPrefix}-action`}>{msg.buttonAction}</label>
        <select id={`${idPrefix}-action`} value={value.action} onChange={(e) => handleActionChange(e.target.value as ButtonItem['action'])}>
          <option value="MESSAGE">{msg.buttonActionMessage}</option>
          <option value="LINK">{msg.buttonActionLink}</option>
          <option value="NODE">{msg.buttonActionNode}</option>
        </select>
      </div>
      {value.action === 'MESSAGE' && (
        <div className="form-field">
          <label htmlFor={`${idPrefix}-value`}>{msg.buttonValueMessage}</label>
          <input
            id={`${idPrefix}-value`}
            type="text"
            maxLength={200}
            value={value.value}
            onChange={(e) => onChange({ ...value, value: e.target.value })}
            aria-invalid={Boolean(valueError)}
          />
          <InlineFieldError id={`${idPrefix}-value-error`} message={valueError} />
        </div>
      )}
      {value.action === 'LINK' && (
        <div className="form-field">
          <label htmlFor={`${idPrefix}-value`}>{msg.url}</label>
          <input
            id={`${idPrefix}-value`}
            type="text"
            value={value.value}
            onChange={(e) => onChange({ ...value, value: e.target.value })}
            aria-invalid={Boolean(valueError)}
          />
          <InlineFieldError id={`${idPrefix}-value-error`} message={valueError} />
        </div>
      )}
      {value.action === 'NODE' && (
        <ResourcePickerField
          id={`${idPrefix}-value`}
          label={msg.targetNode}
          resourceType="node"
          chatbotId={chatbotId}
          multiple={false}
          value={value.value || null}
          onChange={(v) => onChange({ ...value, value: (v as string) ?? '' })}
          errorMessage={valueError}
        />
      )}
    </div>
  );
}
