import { MESSAGES } from '../../../constants/messages';

export interface SurveyPreviewToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
}

/**
 * SIM1-ext — "설문 미리보기" 토글(`survey-management-ui-spec.md` §3.6 `SurveyPreviewToggle`).
 * 기본 꺼짐(실제 대화와 동일하게 상태·기간을 따른다) — 아무것도 설정하지 않아도 안전하게 시험할 수 있다.
 */
export function SurveyPreviewToggle({ checked, onChange }: SurveyPreviewToggleProps): JSX.Element {
  const msg = MESSAGES.simulator;
  return (
    <fieldset className="survey-preview-toggle form-field" role="radiogroup" aria-label={msg.surveyPreviewToggleLabel}>
      <legend>{msg.surveyPreviewToggleLabel}</legend>
      <label className="form-field--inline">
        <input type="radio" name="survey-preview" checked={!checked} onChange={() => onChange(false)} />
        {msg.surveyPreviewOff}
      </label>
      <label className="form-field--inline">
        <input type="radio" name="survey-preview" checked={checked} onChange={() => onChange(true)} />
        {msg.surveyPreviewOn}
      </label>
      {checked && <span className="field-hint">{msg.surveyPreviewHint}</span>}
    </fieldset>
  );
}
