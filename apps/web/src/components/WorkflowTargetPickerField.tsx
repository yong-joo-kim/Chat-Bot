import { forwardRef } from 'react';
import { ResourcePickerField } from './ResourcePickerField';
import { useAuth } from '../context/AuthContext';
import { MESSAGES } from '../constants/messages';

export interface WorkflowTargetPickerFieldProps {
  id: string;
  label: string;
  value: string | null;
  onChange: (value: string | null) => void;
  required?: boolean;
  disabled?: boolean;
  errorMessage?: string;
}

/**
 * [No.41] `WorkflowTargetPickerField`(workflow-automation-ui-spec.md §2.2) — `ResourcePickerField`의
 * 9번째 `resourceType`(`workflowTarget`)을 그대로 쓴다(전역 자원 — `chatbotId` 불요). 노드 편집기(WF2)와
 * 챗봇 이벤트 구독(WF3) 양쪽이 공유한다.
 */
export const WorkflowTargetPickerField = forwardRef<HTMLInputElement, WorkflowTargetPickerFieldProps>(function WorkflowTargetPickerField(
  { id, label, value, onChange, required, disabled, errorMessage },
  forwardedRef,
) {
  const msg = MESSAGES.workflowTargets;
  const { can } = useAuth();
  const canManageTargets = can('security:write');
  return (
    <ResourcePickerField
      ref={forwardedRef}
      id={id}
      label={label}
      resourceType="workflowTarget"
      multiple={false}
      value={value}
      onChange={(v) => onChange((v as string) ?? null)}
      required={required}
      disabled={disabled}
      errorMessage={errorMessage}
      noResultMessage={msg.pickerNoResult}
      createLinkLabel={msg.pickerCreateLink}
      createHref={canManageTargets ? '/settings/workflow-automation/targets' : undefined}
      createHint={canManageTargets ? undefined : msg.pickerCreateHint}
    />
  );
});
