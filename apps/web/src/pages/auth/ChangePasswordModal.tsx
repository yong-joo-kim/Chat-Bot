import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { MESSAGES } from '../../constants/messages';
import { ChangePasswordForm } from './ChangePasswordForm';

/**
 * N1 `UserMenu`의 "비밀번호 변경"(security-audit-ui-spec.md §3.6). L2와 달리 강제 이동이
 * 없고, 성공 시 토스트 후 모달만 닫힌다(계속 콘솔 사용).
 */
export function ChangePasswordModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }): JSX.Element {
  const { showToast } = useToast();

  function handleSuccess(): void {
    showToast(MESSAGES.auth.passwordChangeSuccess);
    onClose();
  }

  return (
    <Modal isOpen={isOpen} title={MESSAGES.auth.changePasswordMenu} onClose={onClose}>
      <ChangePasswordForm submitLabel={MESSAGES.auth.changeAndContinue} onSuccess={handleSuccess} />
    </Modal>
  );
}
