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
  /**
   * [신규 No.46] 특정 동작을 선택할 수 없게 하고 이유를 병기한다(D-3, `<option disabled>` +
   * 옆에 이유 텍스트 — 색상만으로 "왜 안 되는지" 전달하지 않는다, UIUX §4). 바로연결에서 LINK를
   * 막을 때 쓴다. 컴포넌트 자체는 그 밖의 동작을 바꾸지 않는다(기존 소비자는 무수정).
   */
  disabledAction?: { action: ButtonItem['action']; reason: string };
  /**
   * [신규 No.35] 라벨 상한을 바꿀 수 있는 선택 prop(기본 40 — 기존 소비자는 무변경). 선제 안내
   * 버튼 라벨 상한(20자, FR-PA1-5)에 맞추기 위해 이 그룹만 `20`을 전달한다
   * (`proactive-messaging-ui-spec.md` §0).
   */
  labelMaxLength?: number;
}

/** 버튼 아이템 공용 서브컴포넌트(ui-spec §4.2.1 표 하단) — `action`에 따라 `value` 입력 UI가 바뀐다. */
export function ButtonItemEditor({
  value,
  onChange,
  chatbotId,
  idPrefix,
  labelError,
  valueError,
  disabledAction,
  labelMaxLength = 40,
}: ButtonItemEditorProps): JSX.Element {
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
          maxLength={labelMaxLength}
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
          <option value="LINK" disabled={disabledAction?.action === 'LINK'}>
            {msg.buttonActionLink}
          </option>
          <option value="NODE">{msg.buttonActionNode}</option>
        </select>
        {disabledAction && (
          <p className="field-hint">
            <span aria-hidden="true">ⓘ</span> {disabledAction.reason}
          </p>
        )}
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
