import { ConfirmDialog } from '../../../../components/Modal';
import { MESSAGES } from '../../../../constants/messages';

export interface ConvertLegacySurveyDialogProps {
  isOpen: boolean;
  surveyId: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * D1a-v1(SV) — 전환 확인 대화상자(ui-spec §3.4). "이전 형식의 설문 연결('{surveyId}')은 전환 후
 * 사라집니다…" INFO 톤(No.26과 달리 잃을 시크릿이 없다), 기본 포커스 "취소".
 */
export function ConvertLegacySurveyDialog({ isOpen, surveyId, onConfirm, onCancel }: ConvertLegacySurveyDialogProps): JSX.Element {
  const msg = MESSAGES.dialogue.outputFields;
  return (
    <ConfirmDialog
      isOpen={isOpen}
      title={msg.convertSurveyConfirmTitle}
      description={msg.convertSurveyConfirmDesc(surveyId)}
      confirmLabel={msg.convertSurveyButton}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}
