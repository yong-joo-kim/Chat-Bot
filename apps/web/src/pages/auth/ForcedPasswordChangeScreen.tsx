import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../components/Toast';
import { MESSAGES } from '../../constants/messages';
import { ChangePasswordForm } from './ChangePasswordForm';

/**
 * L2 — 최초 비밀번호 변경 강제 화면(security-audit-ui-spec.md §3.3). 라우트가 아니라
 * `App.tsx`가 `status==='password-change-required'`일 때 전체 화면을 대체 렌더한다(F-8).
 * 주소창 경로와 무관하게 항상 이 화면만 보인다 — 탈출구는 "다른 계정으로 로그인"뿐이다(EX-12-9).
 */
export function ForcedPasswordChangeScreen(): JSX.Element {
  const { user, logout } = useAuth();
  const { showToast } = useToast();

  function handleSuccess(): void {
    showToast(MESSAGES.auth.passwordChangeSuccess);
    // AuthProvider.refreshMe()가 ChangePasswordForm 내부에서 이미 호출되어
    // mustChangePassword=false로 갱신되면 App.tsx가 자동으로 정상 화면으로 전환한다.
  }

  return (
    <div className="auth-standalone-layout">
      <div className="auth-card">
        <h1 className="auth-card-title">{MESSAGES.auth.forcedChangeTitle}</h1>
        <p className="modal-description">{MESSAGES.auth.forcedChangeDesc}</p>
        {user && <p className="field-hint">{user.email}</p>}
        <ChangePasswordForm submitLabel={MESSAGES.auth.changeAndContinue} onSuccess={handleSuccess} />
        <button
          type="button"
          className="link-button auth-logout-escape"
          onClick={() => {
            void logout();
          }}
        >
          {MESSAGES.auth.logoutAsOtherAccount}
        </button>
      </div>
    </div>
  );
}
