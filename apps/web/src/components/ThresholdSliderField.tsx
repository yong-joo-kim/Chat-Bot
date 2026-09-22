import { useId } from 'react';
import { InlineFieldError } from './InlineFieldError';

/**
 * 슬라이더(`type="range"`) + 숫자 입력 이중 컨트롤(UIUX_준수기준.md §6 추가 규칙, NFR-A4).
 * 슬라이더 단독 제공을 금지하며, 어느 쪽을 조작해도 값이 즉시 동기화된다. 현재 값은 텍스트로도
 * 상시 노출한다. `<input type="range">`의 네이티브 키보드 동작(←/→, Home/End)을 그대로 쓴다.
 */
export function ThresholdSliderField({
  id,
  label,
  value,
  min,
  max,
  step,
  onChange,
  disabled,
  error,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  error?: string;
}): JSX.Element {
  const describedId = useId();
  const errorId = `${id}-error`;

  function clamp(v: number): number {
    if (Number.isNaN(v)) return value;
    return Math.min(max, Math.max(min, v));
  }

  return (
    <div className="threshold-slider-field form-field">
      <label htmlFor={id}>
        {label} <span className="threshold-slider-value">{value.toFixed(2)}</span>
      </label>
      <div className="threshold-slider-row">
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          aria-describedby={`${describedId}${error ? ` ${errorId}` : ''}`}
          onChange={(e) => onChange(clamp(Number(e.target.value)))}
        />
        <label className="sr-only" htmlFor={`${id}-number`}>
          {label}
        </label>
        <input
          id={`${id}-number`}
          type="number"
          className="threshold-slider-number"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          aria-describedby={`${describedId}${error ? ` ${errorId}` : ''}`}
          aria-invalid={Boolean(error)}
          onChange={(e) => onChange(clamp(Number(e.target.value)))}
        />
      </div>
      <span id={describedId} className="sr-only">
        {min}~{max}, {step} 단위
      </span>
      <InlineFieldError id={errorId} message={error} />
    </div>
  );
}
