import { useId } from 'react';
import { SPEECH_LIMITS } from '@chat-bot/shared-types';
import { SPEECH_TONES, type SpeechTone } from '@chat-bot/shared-types/speech-voice';
import { InlineFieldError } from '../../../components/InlineFieldError';
import { MESSAGES } from '../../../constants/messages';
import { rateForSlider } from './voiceForm';

/**
 * VO 스위치 — `role="switch"` + 레이블 + 설명 + 비활성 이유(`aria-describedby`). 비활성은 `disabled`가 아니라
 * **`aria-disabled`**(포커스 유지 — 이유 글자를 스크린리더가 읽는다, UIUX §6). 켜짐/꺼짐은 글자로 항상 병기한다.
 */
export function VoiceToggleField({
  id,
  label,
  help,
  checked,
  onChange,
  disabled = false,
  disabledReason,
  describedBy,
  children,
}: {
  id: string;
  label: string;
  help: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  /** `aria-disabled` — 값은 보존하되 바꿀 수 없다. */
  disabled?: boolean;
  disabledReason?: string;
  /** 추가로 연결할 설명 요소 id(예: 법무 확인 경고). */
  describedBy?: string;
  children?: React.ReactNode;
}): JSX.Element {
  const msg = MESSAGES.voice;
  const helpId = `${id}-help`;
  const reasonId = `${id}-reason`;
  const describedIds = [helpId, disabled && disabledReason ? reasonId : '', describedBy ?? ''].filter(Boolean).join(' ');
  return (
    <div className="form-field voice-toggle-field">
      <div className="voice-toggle-row">
        <span id={`${id}-label`} className="voice-toggle-label">
          {label}
        </span>
        <button
          id={id}
          type="button"
          role="switch"
          aria-checked={checked}
          aria-labelledby={`${id}-label`}
          aria-describedby={describedIds}
          aria-disabled={disabled || undefined}
          className={`voice-switch${checked ? ' voice-switch--on' : ''}${disabled ? ' voice-switch--locked' : ''}`}
          onClick={() => {
            if (!disabled) onChange(!checked);
          }}
        >
          <span aria-hidden="true">{checked ? '●' : '○'}</span> {checked ? msg.switchOn : msg.switchOff}
        </button>
      </div>
      <p id={helpId} className="field-hint">
        {help}
      </p>
      {disabled && disabledReason && (
        <p id={reasonId} className="field-hint voice-toggle-reason">
          <span aria-hidden="true">ⓘ</span> {disabledReason}
        </p>
      )}
      {children}
    </div>
  );
}

/**
 * 읽기 속도 — **슬라이더 + 같은 값의 숫자 입력을 항상 함께**(UIUX §6 슬라이더 규칙). 어느 쪽을 조작해도 서로 갱신되고,
 * 현재 값은 텍스트("1.00배")로 상시 보인다. 범위 밖·0.05 단위가 아닌 값은 저장 시점에 인라인 오류(여기서는 `error`로 받는다).
 * 슬라이더의 방향키·Home/End는 네이티브 동작이다.
 */
export function VoiceRateField({
  id,
  text,
  onChange,
  disabled = false,
  error,
}: {
  id: string;
  /** 입력 도중 값까지 그대로 보이도록 문자열. */
  text: string;
  onChange: (text: string) => void;
  disabled?: boolean;
  error?: string;
}): JSX.Element {
  const msg = MESSAGES.voice;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const { min, max, step } = SPEECH_LIMITS.rateMultiplier;
  const current = Number.isFinite(Number(text)) && text.trim() !== '' ? Number(text).toFixed(2) : '—';
  const describedBy = [hintId, error ? errorId : ''].filter(Boolean).join(' ');
  return (
    <div className="form-field voice-rate-field">
      <label htmlFor={`${id}-slider`}>
        {msg.rateLabel}{' '}
        <span className="voice-rate-value" data-testid="voice-rate-value">
          {msg.rateValue(current)}
        </span>
      </label>
      <div className="voice-rate-row">
        <input
          id={`${id}-slider`}
          type="range"
          min={min}
          max={max}
          step={step}
          value={rateForSlider(text)}
          aria-label={`${msg.rateLabel} ${msg.rateSliderSuffix}`}
          aria-describedby={describedBy}
          aria-disabled={disabled || undefined}
          onChange={(e) => {
            if (!disabled) onChange(Number(e.target.value).toFixed(2));
          }}
        />
        <input
          id={`${id}-number`}
          type="number"
          className="voice-rate-number"
          min={min}
          max={max}
          step={step}
          value={text}
          aria-label={`${msg.rateLabel} ${msg.rateNumberSuffix}`}
          aria-describedby={describedBy}
          aria-invalid={Boolean(error)}
          aria-disabled={disabled || undefined}
          readOnly={disabled}
          onChange={(e) => {
            if (!disabled) onChange(e.target.value);
          }}
        />
        <span aria-hidden="true">배</span>
      </div>
      <p id={hintId} className="field-hint">
        {msg.rateHelp}
      </p>
      <InlineFieldError id={errorId} message={error} />
    </div>
  );
}

/**
 * 말투 라디오 그룹 — `fieldset/legend` + 4개(차분함·밝게·사과·안내) + 항목별 한 줄 설명(단일 선택 = 라디오, UIUX §6).
 * `defaultMarkFor`로 서버 내장 기본값 옆에 "(기본)"을 병기한다.
 */
export function VoiceToneRadioGroup({
  name,
  legend,
  help,
  value,
  onChange,
  disabled = false,
  defaultMarkFor,
  required = true,
}: {
  name: string;
  legend: string;
  help: string;
  value: SpeechTone;
  onChange: (tone: SpeechTone) => void;
  disabled?: boolean;
  defaultMarkFor?: SpeechTone;
  required?: boolean;
}): JSX.Element {
  const msg = MESSAGES.voice;
  const helpId = useId();
  return (
    <fieldset className="form-field voice-tone-group" aria-describedby={helpId} aria-disabled={disabled || undefined}>
      <legend>
        {legend}{' '}
        {required && (
          <span className="required-mark" aria-hidden="true">
            *
          </span>
        )}
      </legend>
      <p id={helpId} className="field-hint">
        {help}
      </p>
      {SPEECH_TONES.map((tone) => (
        <label key={tone} className="voice-radio-label">
          <input
            type="radio"
            name={name}
            value={tone}
            checked={value === tone}
            aria-disabled={disabled || undefined}
            onChange={() => {
              if (!disabled) onChange(tone);
            }}
          />
          <span className="voice-radio-text">
            <strong>
              {msg.toneNames[tone]}
              {defaultMarkFor === tone ? ` ${msg.toneDefaultMark}` : ''}
            </strong>{' '}
            <span className="field-hint">{msg.toneFeel[tone]}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}
