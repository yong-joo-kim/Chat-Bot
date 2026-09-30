import { UTTERANCE_ANALYSIS_LIMITS, type ProbeTarget, type UtteranceAnalysisCapability } from '@chat-bot/shared-types';
import { InlineFieldError } from '../../../components/InlineFieldError';
import { MESSAGES } from '../../../constants/messages';

export interface ConditionValues {
  targetClusterCount: string;
  minClusterSize: string;
  keywordCount: string;
  nounsOnly: boolean;
  probeEnabled: boolean;
  probeTarget: ProbeTarget;
  /** 0~100 입력값. 비우면 챗봇 답변 설정 기준을 따른다. */
  scoreThreshold: string;
  nameSuggest: boolean;
}

export type ConditionErrorKey = 'targetClusterCount' | 'minClusterSize' | 'keywordCount' | 'scoreThreshold' | 'nameSuggest';
export type ConditionErrors = Partial<Record<ConditionErrorKey, string>>;

export const CONDITION_FIELD_IDS: Record<ConditionErrorKey, string> = {
  targetClusterCount: 'ua-target-count',
  minClusterSize: 'ua-min-size',
  keywordCount: 'ua-keyword-count',
  scoreThreshold: 'ua-threshold',
  nameSuggest: 'ua-name-suggest',
};

export function defaultConditionValues(): ConditionValues {
  const l = UTTERANCE_ANALYSIS_LIMITS;
  return {
    targetClusterCount: String(l.targetClusterCount.default),
    minClusterSize: String(l.minClusterSize.default),
    keywordCount: String(l.keywordCount.default),
    nounsOnly: true,
    probeEnabled: true,
    probeTarget: 'SERVING',
    scoreThreshold: '',
    nameSuggest: false,
  };
}

function NumberField({
  errorKey,
  label,
  hint,
  value,
  min,
  max,
  error,
  disabled,
  required = true,
  onChange,
}: {
  errorKey: ConditionErrorKey;
  label: string;
  hint: string;
  value: string;
  min: number;
  max: number;
  error?: string;
  disabled: boolean;
  required?: boolean;
  onChange: (v: string) => void;
}): JSX.Element {
  const id = CONDITION_FIELD_IDS[errorKey];
  return (
    <div className="form-field">
      <label htmlFor={id}>
        {label}{' '}
        {required && (
          <span className="required-mark" aria-hidden="true">
            *
          </span>
        )}
      </label>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        step="any"
        value={value}
        disabled={disabled}
        aria-required={required}
        aria-invalid={Boolean(error)}
        aria-describedby={[`${id}-hint`, error ? `${id}-error` : ''].filter(Boolean).join(' ')}
        onChange={(e) => onChange(e.target.value)}
      />
      <p id={`${id}-hint`} className="field-hint">
        {hint}
      </p>
      <InlineFieldError id={`${id}-error`} message={error} />
    </div>
  );
}

/**
 * 분석 조건 입력(UA-2 §4.2~4.3) — 조건 7종 + 이름 제안. 값은 문자열로 들고 있다가 제출 시점에 범위를 검사한다(UIUX §7).
 * 챗봇은 화면 머리에 글자로만 고정되고 여기서 고르지 않는다(R-22).
 */
export function AnalysisConditionsForm({
  values,
  errors,
  capability,
  disabled,
  onChange,
}: {
  values: ConditionValues;
  errors: ConditionErrors;
  capability: UtteranceAnalysisCapability | null;
  disabled: boolean;
  onChange: (patch: Partial<ConditionValues>) => void;
}): JSX.Element {
  const msg = MESSAGES.utteranceAnalysis;
  const l = UTTERANCE_ANALYSIS_LIMITS;
  const nameSuggestId = CONDITION_FIELD_IDS.nameSuggest;
  return (
    <>
      <fieldset className="ua-fieldset" disabled={disabled}>
        <legend>{msg.groupHow}</legend>
        <NumberField
          errorKey="targetClusterCount"
          label={msg.targetCountLabel}
          hint={msg.targetCountHint(l.targetClusterCount.min, l.targetClusterCount.max, l.targetClusterCount.default)}
          value={values.targetClusterCount}
          min={l.targetClusterCount.min}
          max={l.targetClusterCount.max}
          error={errors.targetClusterCount}
          disabled={disabled}
          onChange={(v) => onChange({ targetClusterCount: v })}
        />
        <NumberField
          errorKey="minClusterSize"
          label={msg.minSizeLabel}
          hint={msg.minSizeHint(l.minClusterSize.min, l.minClusterSize.max, l.minClusterSize.default)}
          value={values.minClusterSize}
          min={l.minClusterSize.min}
          max={l.minClusterSize.max}
          error={errors.minClusterSize}
          disabled={disabled}
          onChange={(v) => onChange({ minClusterSize: v })}
        />
        <NumberField
          errorKey="keywordCount"
          label={msg.keywordCountLabel}
          hint={msg.keywordCountHint(l.keywordCount.min, l.keywordCount.max, l.keywordCount.default)}
          value={values.keywordCount}
          min={l.keywordCount.min}
          max={l.keywordCount.max}
          error={errors.keywordCount}
          disabled={disabled}
          onChange={(v) => onChange({ keywordCount: v })}
        />
        <div className="form-field">
          <label className="ua-checkbox-label">
            <input type="checkbox" checked={values.nounsOnly} disabled={disabled} onChange={(e) => onChange({ nounsOnly: e.target.checked })} /> {msg.nounsOnlyLabel}
          </label>
        </div>
      </fieldset>

      <fieldset className="ua-fieldset" disabled={disabled}>
        <legend>{msg.groupProbe}</legend>
        <div className="form-field">
          <label className="ua-checkbox-label">
            <input type="checkbox" checked={values.probeEnabled} disabled={disabled} onChange={(e) => onChange({ probeEnabled: e.target.checked })} /> {msg.probeEnabledLabel}
          </label>
          <p className="field-hint">{msg.probeEnabledHint}</p>
        </div>
        {capability?.envModeEnabled ? (
          <fieldset className="ua-fieldset ua-fieldset--inner" disabled={disabled || !values.probeEnabled}>
            <legend>{msg.probeTargetLegend}</legend>
            <label className="ua-radio-label">
              <input type="radio" name="ua-probe-target" checked={values.probeTarget === 'SERVING'} onChange={() => onChange({ probeTarget: 'SERVING' })} /> {msg.probeTargetServing}
            </label>
            <label className="ua-radio-label">
              <input type="radio" name="ua-probe-target" checked={values.probeTarget === 'DRAFT'} onChange={() => onChange({ probeTarget: 'DRAFT' })} /> {msg.probeTargetDraft}
            </label>
          </fieldset>
        ) : (
          <p className="field-hint">{msg.probeTargetFixed}</p>
        )}
        <NumberField
          errorKey="scoreThreshold"
          label={msg.thresholdLabel}
          hint={msg.thresholdHint}
          value={values.scoreThreshold}
          min={0}
          max={100}
          error={errors.scoreThreshold}
          disabled={disabled || !values.probeEnabled}
          required={false}
          onChange={(v) => onChange({ scoreThreshold: v })}
        />
      </fieldset>

      {capability?.nameSuggestAvailable && (
        <fieldset className="ua-fieldset" disabled={disabled}>
          <legend>{msg.groupNaming}</legend>
          <div className="form-field">
            <label className="ua-checkbox-label">
              <input
                id={nameSuggestId}
                type="checkbox"
                checked={values.nameSuggest}
                disabled={disabled}
                aria-invalid={Boolean(errors.nameSuggest)}
                aria-describedby={[`${nameSuggestId}-hint`, errors.nameSuggest ? `${nameSuggestId}-error` : ''].filter(Boolean).join(' ')}
                onChange={(e) => onChange({ nameSuggest: e.target.checked })}
              />{' '}
              {msg.nameSuggestLabel}
            </label>
            <p id={`${nameSuggestId}-hint`} className="field-hint">
              {msg.nameSuggestHint}
            </p>
            <InlineFieldError id={`${nameSuggestId}-error`} message={errors.nameSuggest} />
          </div>
        </fieldset>
      )}
    </>
  );
}
