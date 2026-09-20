import { useState } from 'react';
import { MESSAGES } from '../../../constants/messages';
import { InlineFieldError } from '../../../components/InlineFieldError';

const MAX_LENGTH = 1000;

/** 입력창(FR-10-13~15). 1,000자 초과 시 전송 버튼을 클라이언트에서 먼저 막는다. */
export function MessageComposer({ disabled, onSend }: { disabled: boolean; onSend: (text: string) => void }): JSX.Element {
  const msg = MESSAGES.simulator;
  const [value, setValue] = useState('');
  const [inlineError, setInlineError] = useState<string | undefined>(undefined);

  const tooLong = value.length > MAX_LENGTH;
  const remaining = MAX_LENGTH - value.length;

  function handleSend(): void {
    if (tooLong) return;
    if (value.trim().length === 0) {
      setInlineError(msg.composerEmptyError);
      return;
    }
    setInlineError(undefined);
    onSend(value);
    setValue('');
  }

  return (
    <div className="message-composer">
      <label htmlFor="sim-composer-input" className="sr-only">
        {msg.composerLabel}
      </label>
      <textarea
        id="sim-composer-input"
        className="message-composer-input"
        rows={1}
        value={value}
        placeholder={msg.composerPlaceholder}
        disabled={disabled}
        maxLength={MAX_LENGTH + 200}
        aria-describedby="sim-composer-remaining"
        onChange={(e) => {
          setValue(e.target.value);
          setInlineError(undefined);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
          }
        }}
      />
      <span id="sim-composer-remaining" className={`message-composer-remaining${tooLong ? ' message-composer-remaining--over' : ''}`}>
        {msg.composerRemaining(remaining, MAX_LENGTH)}
      </span>
      <button type="button" className="btn btn-primary" disabled={disabled || tooLong} aria-disabled={disabled || tooLong} onClick={handleSend}>
        {msg.send}
      </button>
      <InlineFieldError id="sim-composer-error" message={inlineError} />
    </div>
  );
}
