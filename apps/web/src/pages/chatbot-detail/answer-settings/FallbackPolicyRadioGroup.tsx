import type { FallbackPolicy } from '@chat-bot/shared-types';
import { MESSAGES } from '../../../constants/messages';

/** `RAG_FIRST`/`NODE_FIRST` 라디오(단일 선택, UIUX §6). */
export function FallbackPolicyRadioGroup({
  value,
  onChange,
  disabled,
}: {
  value: FallbackPolicy;
  onChange: (v: FallbackPolicy) => void;
  disabled?: boolean;
}): JSX.Element {
  const msg = MESSAGES.answerSettings.rag;
  return (
    <fieldset className="fallback-policy-group" disabled={disabled}>
      <legend>{msg.fallbackPolicyLabel}</legend>
      <label className="form-field--inline">
        <input type="radio" name="fallback-policy" checked={value === 'RAG_FIRST'} onChange={() => onChange('RAG_FIRST')} />
        {msg.fallbackPolicyOptions.RAG_FIRST}
      </label>
      <label className="form-field--inline">
        <input type="radio" name="fallback-policy" checked={value === 'NODE_FIRST'} onChange={() => onChange('NODE_FIRST')} />
        {msg.fallbackPolicyOptions.NODE_FIRST}
      </label>
    </fieldset>
  );
}
