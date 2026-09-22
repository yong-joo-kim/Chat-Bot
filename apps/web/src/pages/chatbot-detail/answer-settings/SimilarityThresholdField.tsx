import { InlineFieldError } from '../../../components/InlineFieldError';
import { MESSAGES } from '../../../constants/messages';

/**
 * 선택적 유사도 임계값(ui-spec §4.1.3). 기본 체크된 "기본값 사용" 상태에서는 숫자 입력이
 * 비활성이고 값은 `null`(요청에 필드 자체가 실리지 않음, FR-N2-8). 체크 해제 시 `0 < v < 1`.
 */
export function SimilarityThresholdField({
  value,
  onChange,
  disabled,
  error,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  disabled?: boolean;
  error?: string;
}): JSX.Element {
  const msg = MESSAGES.answerSettings.rag;
  const useDefault = value === null;

  return (
    <div className="form-field">
      <label htmlFor="rag-similarity-threshold">{msg.similarityThresholdLabel}</label>
      <div className="threshold-slider-row">
        <input
          id="rag-similarity-threshold"
          type="number"
          min={0}
          max={1}
          step={0.01}
          disabled={disabled || useDefault}
          value={value ?? ''}
          aria-describedby={error ? 'rag-similarity-threshold-error' : undefined}
          aria-invalid={Boolean(error)}
          onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        />
        <label className="form-field--inline">
          <input
            type="checkbox"
            disabled={disabled}
            checked={useDefault}
            onChange={(e) => onChange(e.target.checked ? null : 0.35)}
          />
          {msg.similarityThresholdUseDefaultLabel}
        </label>
      </div>
      <InlineFieldError id="rag-similarity-threshold-error" message={error} />
    </div>
  );
}
