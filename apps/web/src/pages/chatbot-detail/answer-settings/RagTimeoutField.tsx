import { InlineFieldError } from '../../../components/InlineFieldError';
import { MESSAGES } from '../../../constants/messages';

/** 타임아웃(초) 입력, 하한 120초(FR-N2-26). 화면 표시 단위는 초, 저장은 ms(부모가 변환). */
export function RagTimeoutField({
  valueSeconds,
  onChange,
  disabled,
  error,
}: {
  valueSeconds: number;
  onChange: (v: number) => void;
  disabled?: boolean;
  error?: string;
}): JSX.Element {
  const msg = MESSAGES.answerSettings.rag;
  return (
    <div className="form-field">
      <label htmlFor="rag-timeout">{msg.timeoutLabel}</label>
      <input
        id="rag-timeout"
        type="number"
        min={120}
        max={300}
        step={1}
        value={valueSeconds}
        disabled={disabled}
        aria-describedby={error ? 'rag-timeout-error' : undefined}
        aria-invalid={Boolean(error)}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <InlineFieldError id="rag-timeout-error" message={error} />
    </div>
  );
}
