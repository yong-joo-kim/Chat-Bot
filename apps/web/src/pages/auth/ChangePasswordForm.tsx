import { useState, type FormEvent } from 'react';
import { PasswordField } from '../../components/security/PasswordField';
import { PasswordPolicyChecklist } from '../../components/security/PasswordPolicyChecklist';
import { authApi } from '../../api/auth';
import { ApiError } from '../../api/client';
import { MESSAGES } from '../../constants/messages';
import { useAuth } from '../../context/AuthContext';

/**
 * L2(강제 변경)와 N1의 `ChangePasswordModal`이 공유하는 폼 본체(security-audit-ui-spec.md §3.3).
 * FR-12-11: 본인 변경 시 현재 세션은 재발급되어 그대로 이어진다 — 별도 재로그인 없음.
 */
export function ChangePasswordForm({
  submitLabel,
  onSuccess,
}: {
  submitLabel: string;
  onSuccess: () => void;
}): JSX.Element {
  const { user, refreshMe, logout } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newPasswordConfirm, setNewPasswordConfirm] = useState('');
  const [currentPasswordError, setCurrentPasswordError] = useState<string | undefined>();
  const [newPasswordError, setNewPasswordError] = useState<string | undefined>();
  const [confirmError, setConfirmError] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setCurrentPasswordError(undefined);
    setNewPasswordError(undefined);
    setConfirmError(undefined);

    if (newPassword !== newPasswordConfirm) {
      setConfirmError(MESSAGES.auth.passwordMismatch);
      return;
    }

    setSubmitting(true);
    try {
      await authApi.changePassword({ currentPassword, newPassword });
      await refreshMe();
      onSuccess();
    } catch (e2) {
      if (e2 instanceof ApiError) {
        if (e2.code === 'INVALID_CREDENTIALS') {
          // 현재 비밀번호가 실제로 틀린 경우에만 이 필드 오류를 표시한다.
          setCurrentPasswordError(MESSAGES.auth.currentPasswordInvalid);
        } else if (e2.status === 401 && (e2.code === 'SESSION_EXPIRED' || e2.code === 'UNAUTHENTICATED' || e2.code === 'ACCOUNT_DISABLED')) {
          // EX-12-8: 세션 만료/계정 비활성화로 인한 401은 "현재 비밀번호 불일치"가 아니다.
          // 재로그인을 유도한다 — logout()이 status를 'unauthenticated'로 바꾸면 App.tsx가
          // 자동으로 /login으로 전환한다(재로그인 후 처음부터, 화면 전환 자체가 안내를 겸한다).
          await logout();
        } else if (e2.status === 400 && e2.details && e2.details.length > 0) {
          setNewPasswordError(e2.details.map((d) => d.message).join(' '));
        } else if (e2.status === 400) {
          setNewPasswordError(e2.message);
        } else if (e2.status === 401) {
          // 코드가 없는 예상 밖 401 폴백 — "현재 비밀번호 오류"로 오인시키지 않는다.
          setCurrentPasswordError(e2.message || MESSAGES.errors.generic);
        }
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <PasswordField
        id="change-password-current"
        label={MESSAGES.auth.currentPasswordLabel}
        value={currentPassword}
        onChange={setCurrentPassword}
        autoComplete="current-password"
        errorMessage={currentPasswordError}
        required
      />
      <PasswordField
        id="change-password-new"
        label={MESSAGES.auth.newPasswordLabel}
        value={newPassword}
        onChange={setNewPassword}
        autoComplete="new-password"
        errorMessage={newPasswordError}
        required
      />
      <PasswordPolicyChecklist password={newPassword} email={user?.email} />
      <PasswordField
        id="change-password-confirm"
        label={MESSAGES.auth.newPasswordConfirmLabel}
        value={newPasswordConfirm}
        onChange={setNewPasswordConfirm}
        autoComplete="new-password"
        errorMessage={confirmError}
        required
      />
      <div className="modal-actions">
        <button type="submit" className="btn btn-primary" disabled={submitting}>
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
