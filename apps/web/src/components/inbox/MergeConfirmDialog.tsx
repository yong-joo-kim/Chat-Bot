import { ConfirmDialog } from '../Modal';
import { InlineFieldError } from '../InlineFieldError';
import { MESSAGES } from '../../constants/messages';

/**
 * OI-6a 병합 확인(`omnichannel-inbox-ui-spec.md` §3.6a `MergeConfirmDialog`) — `ConfirmDialog` 재사용
 * + 명시 문구. `danger`는 아니다(되돌릴 수 있는 동작, §12 D-7).
 */
export function MergeConfirmDialog({
  isOpen,
  sourceLabel,
  targetLabel,
  saving,
  error,
  onConfirm,
  onCancel,
}: {
  isOpen: boolean;
  sourceLabel: string;
  targetLabel: string;
  saving: boolean;
  error?: string;
  onConfirm: () => void;
  onCancel: () => void;
}): JSX.Element {
  const msg = MESSAGES.inbox;
  return (
    <ConfirmDialog
      isOpen={isOpen}
      title={msg.mergeConfirmTitle}
      description={msg.mergeConfirmDesc(sourceLabel, targetLabel)}
      confirmLabel={saving ? MESSAGES.common.saving : msg.mergeConfirmButton}
      onConfirm={onConfirm}
      onCancel={onCancel}
      confirmDisabled={saving}
    >
      <InlineFieldError id="merge-confirm-error" message={error} />
    </ConfirmDialog>
  );
}
