import { ConfirmDialog } from '../../../../components/Modal';
import { MESSAGES } from '../../../../constants/messages';

export interface ConvertLegacyApiConditionDialogProps {
  isOpen: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * D1a-v1 — 전환 확인 대화상자(ui-spec §3.3). "이전 형식의 헤더·URL·요청 본문은 전환 후 사라집니다.
 * 메서드와 조건 목록만 새 폼으로 옮겨집니다." danger 톤, 기본 포커스 "취소"(`ConfirmDialog` 상속).
 */
export function ConvertLegacyApiConditionDialog({ isOpen, onConfirm, onCancel }: ConvertLegacyApiConditionDialogProps): JSX.Element {
  const msg = MESSAGES.dialogue.outputFields;
  return (
    <ConfirmDialog
      isOpen={isOpen}
      title={msg.convertConfirmTitle}
      description={msg.convertConfirmDesc}
      confirmLabel={msg.convertButton}
      danger
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}
