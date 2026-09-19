import { useRef } from 'react';
import type { ContextSlot, ContextSlotType } from '@chat-bot/shared-types';
import { InlineFieldError } from '../../../components/InlineFieldError';
import { ChipListEditor } from '../../../components/ChipListEditor';
import { ResourcePickerField } from '../../../components/ResourcePickerField';
import { MESSAGES } from '../../../constants/messages';

const SLOT_TYPES: ContextSlotType[] = ['TEXT', 'NUMBER', 'DATE', 'PHONE', 'EMAIL', 'CHOICE', 'KEYWORD'];

export interface ContextSlotEditorProps {
  slot: ContextSlot;
  onChange: (patch: Partial<ContextSlot>) => void;
  chatbotId: string;
  idPrefix: string;
  nameError?: string;
  choicesError?: string;
}

/** 슬롯 편집기(ui-spec §4.6.1). `type` 변경 시 조건부로 나타난 첫 입력 필드로 포커스를 이동한다. */
export function ContextSlotEditor({ slot, onChange, chatbotId, idPrefix, nameError, choicesError }: ContextSlotEditorProps): JSX.Element {
  const msg = MESSAGES.dialogue.slot;
  const choicesFocusRef = useRef<HTMLInputElement>(null);
  const keywordFocusRef = useRef<HTMLInputElement>(null);
  const numberFocusRef = useRef<HTMLInputElement>(null);

  function handleTypeChange(type: ContextSlotType): void {
    onChange({ type });
    requestAnimationFrame(() => {
      if (type === 'CHOICE') choicesFocusRef.current?.focus();
      else if (type === 'KEYWORD') keywordFocusRef.current?.focus();
      else if (type === 'NUMBER') numberFocusRef.current?.focus();
    });
  }

  return (
    <div className="context-slot-editor">
      <div className="key-value-row">
        <div className="form-field">
          <label htmlFor={`${idPrefix}-name`}>
            {msg.nameLabel} <span className="required-mark" aria-hidden="true">*</span>
          </label>
          <input
            id={`${idPrefix}-name`}
            type="text"
            value={slot.name}
            onChange={(e) => onChange({ name: e.target.value })}
            aria-describedby={nameError ? `${idPrefix}-name-error` : `${idPrefix}-name-help`}
            aria-invalid={Boolean(nameError)}
          />
          {!nameError && (
            <p id={`${idPrefix}-name-help`} className="field-hint">
              {msg.nameHelp}
            </p>
          )}
          <InlineFieldError id={`${idPrefix}-name-error`} message={nameError} />
        </div>
        <div className="form-field">
          <label htmlFor={`${idPrefix}-label`}>
            {msg.labelLabel} <span className="required-mark" aria-hidden="true">*</span>
          </label>
          <input id={`${idPrefix}-label`} type="text" value={slot.label} maxLength={50} onChange={(e) => onChange({ label: e.target.value })} />
        </div>
      </div>

      <div className="form-field">
        <label htmlFor={`${idPrefix}-prompt`}>
          {msg.promptLabel} <span className="required-mark" aria-hidden="true">*</span>
        </label>
        <input id={`${idPrefix}-prompt`} type="text" value={slot.prompt} maxLength={200} onChange={(e) => onChange({ prompt: e.target.value })} />
      </div>

      <div className="key-value-row">
        <div className="form-field">
          <label htmlFor={`${idPrefix}-type`}>{msg.typeLabel}</label>
          <select id={`${idPrefix}-type`} value={slot.type} onChange={(e) => handleTypeChange(e.target.value as ContextSlotType)}>
            {SLOT_TYPES.map((t) => (
              <option key={t} value={t}>
                {msg.types[t]}
              </option>
            ))}
          </select>
        </div>
        <div className="form-field form-field--inline">
          <input
            id={`${idPrefix}-required`}
            type="checkbox"
            checked={slot.required}
            onChange={(e) => onChange({ required: e.target.checked })}
          />
          <label htmlFor={`${idPrefix}-required`}>{msg.requiredLabel}</label>
        </div>
      </div>
      {!slot.required && <p className="field-hint">{msg.requiredHelp}</p>}

      {slot.type === 'CHOICE' && (
        <div>
          <ChipListEditor
            ref={choicesFocusRef}
            id={`${idPrefix}-choices`}
            label={msg.choicesLabel}
            values={slot.choices ?? []}
            onChange={(choices) => onChange({ choices })}
            placeholder={msg.choicesAddPlaceholder}
            maxItems={20}
          />
          <InlineFieldError id={`${idPrefix}-choices-error`} message={choicesError} />
        </div>
      )}

      {slot.type === 'KEYWORD' && (
        <ResourcePickerField
          ref={keywordFocusRef}
          id={`${idPrefix}-keyword`}
          label={msg.keywordLabel}
          resourceType="keyword"
          chatbotId={chatbotId}
          multiple={false}
          value={slot.keywordId ?? null}
          onChange={(v) => onChange({ keywordId: (v as string) || undefined })}
          required
        />
      )}

      {slot.type === 'NUMBER' && (
        <div className="key-value-row">
          <div className="form-field">
            <label htmlFor={`${idPrefix}-min`}>{msg.minLabel}</label>
            <input
              id={`${idPrefix}-min`}
              ref={numberFocusRef}
              type="number"
              value={slot.validation?.min ?? ''}
              onChange={(e) => onChange({ validation: { ...slot.validation, min: e.target.value === '' ? undefined : Number(e.target.value) } })}
            />
          </div>
          <div className="form-field">
            <label htmlFor={`${idPrefix}-max`}>{msg.maxLabel}</label>
            <input
              id={`${idPrefix}-max`}
              type="number"
              value={slot.validation?.max ?? ''}
              onChange={(e) => onChange({ validation: { ...slot.validation, max: e.target.value === '' ? undefined : Number(e.target.value) } })}
            />
          </div>
        </div>
      )}

      {slot.type === 'TEXT' && (
        <div className="key-value-row">
          <div className="form-field">
            <label htmlFor={`${idPrefix}-maxlength`}>{msg.maxLengthLabel}</label>
            <input
              id={`${idPrefix}-maxlength`}
              type="number"
              value={slot.validation?.maxLength ?? ''}
              onChange={(e) =>
                onChange({ validation: { ...slot.validation, maxLength: e.target.value === '' ? undefined : Number(e.target.value) } })
              }
            />
          </div>
          <div className="form-field">
            <label htmlFor={`${idPrefix}-pattern`}>{msg.patternLabel}</label>
            <input
              id={`${idPrefix}-pattern`}
              type="text"
              maxLength={200}
              value={slot.validation?.pattern ?? ''}
              onChange={(e) => onChange({ validation: { ...slot.validation, pattern: e.target.value || undefined } })}
            />
            <p className="field-hint">{msg.patternHelp}</p>
          </div>
        </div>
      )}

      {slot.type === 'DATE' && (
        <div className="form-field">
          <label htmlFor={`${idPrefix}-dateformat`}>{msg.dateFormatLabel}</label>
          <select
            id={`${idPrefix}-dateformat`}
            value={slot.validation?.dateFormat ?? 'YYYY-MM-DD'}
            onChange={(e) => onChange({ validation: { ...slot.validation, dateFormat: e.target.value as 'YYYY-MM-DD' | 'YYYY.MM.DD' | 'YYYYMMDD' } })}
          >
            <option value="YYYY-MM-DD">YYYY-MM-DD</option>
            <option value="YYYY.MM.DD">YYYY.MM.DD</option>
            <option value="YYYYMMDD">YYYYMMDD</option>
          </select>
        </div>
      )}

      <div className="key-value-row">
        <div className="form-field">
          <label htmlFor={`${idPrefix}-error-prompt`}>{msg.errorPromptLabel}</label>
          <input
            id={`${idPrefix}-error-prompt`}
            type="text"
            maxLength={200}
            value={slot.errorPrompt ?? ''}
            onChange={(e) => onChange({ errorPrompt: e.target.value || undefined })}
          />
          <p className="field-hint">{msg.errorPromptHelp}</p>
        </div>
        <div className="form-field">
          <label htmlFor={`${idPrefix}-max-retry`}>{msg.maxRetryLabel}</label>
          <input
            id={`${idPrefix}-max-retry`}
            type="number"
            min={0}
            max={5}
            value={slot.maxRetry}
            onChange={(e) => onChange({ maxRetry: Number(e.target.value) })}
          />
        </div>
      </div>

      <div className="form-field">
        <label htmlFor={`${idPrefix}-example`}>{msg.exampleValueLabel}</label>
        <input
          id={`${idPrefix}-example`}
          type="text"
          maxLength={100}
          value={slot.exampleValue ?? ''}
          onChange={(e) => onChange({ exampleValue: e.target.value || undefined })}
        />
        <p className="field-hint">{msg.exampleValueHelp}</p>
      </div>
    </div>
  );
}
