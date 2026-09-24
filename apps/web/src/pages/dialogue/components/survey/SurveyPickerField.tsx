import { forwardRef } from 'react';
import { ResourcePickerField } from '../../../../components/ResourcePickerField';
import { MESSAGES } from '../../../../constants/messages';
import { useAuth } from '../../../../context/AuthContext';

export interface SurveyPickerFieldProps {
  id: string;
  label: string;
  chatbotId: string;
  value: string | null;
  onChange: (value: string | null) => void;
  required?: boolean;
  disabled?: boolean;
  errorMessage?: string;
}

/**
 * `ResourcePickerField`(ui-spec §2.2)의 `resourceType='survey'`로 구현한 설문 선택기. 후보 0건이면
 * "설문 만들기 →" 링크(`dialogue:write` 없으면 안내 텍스트만) — `apps/web/src/lib/surveyDisplay.ts`
 * 기준으로 상태 라벨을 옵션 문자열에 접미한다(`ResourcePickerField`가 담당).
 */
export const SurveyPickerField = forwardRef<HTMLInputElement, SurveyPickerFieldProps>(function SurveyPickerField(
  { id, label, chatbotId, value, onChange, required = false, disabled = false, errorMessage },
  ref,
) {
  const { can } = useAuth();
  const canWrite = can('dialogue:write');
  return (
    <ResourcePickerField
      ref={ref}
      id={id}
      label={label}
      resourceType="survey"
      chatbotId={chatbotId}
      multiple={false}
      value={value}
      onChange={(v) => onChange((v as string) || null)}
      required={required}
      disabled={disabled}
      errorMessage={errorMessage}
      noResultMessage={MESSAGES.surveys.pickerNoResult}
      createHref={canWrite ? `/chatbots/${chatbotId}/dialogue/surveys/new` : undefined}
      createHint={canWrite ? undefined : MESSAGES.surveys.pickerCreateHint}
    />
  );
});
