import { ConfirmDialog } from '../../../components/Modal';
import { MESSAGES } from '../../../constants/messages';

/** 채널 삭제 확인(FR-11-11, AC-C-6). */
export function ChannelDeleteConfirmDialog({
  isOpen,
  onConfirm,
  onCancel,
}: {
  isOpen: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}): JSX.Element {
  const msg = MESSAGES.channels;
  return (
    <ConfirmDialog
      isOpen={isOpen}
      title={msg.deleteTitle}
      description={msg.deleteDesc}
      confirmLabel={MESSAGES.common.delete}
      onConfirm={onConfirm}
      onCancel={onCancel}
      danger
    />
  );
}
