import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { PasswordField } from '../../components/security/PasswordField';
import { ApiError } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { MESSAGES } from '../../constants/messages';
import { fieldErrorsFromApiError } from '../../lib/apiErrorHelpers';

/**
 * L1 — 로그인 화면(security-audit-ui-spec.md §3.2). `TopBar`·`UnsavedGuardProvider` 바깥의
 * 완전히 독립된 레이아웃이다(F-1) — `App.tsx`가 `status==='unauthenticated'`일 때만 렌더한다.
 */
export function LoginPage(): JSX.Element {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [emailError, setEmailError] = useState<string | undefined>();
  const [passwordError, setPasswordError] = useState<string | undefined>();
  const [banner, setBanner] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const bannerRef = useRef<HTMLParagraphElement>(null);

  // AC-U-3: 배너형 오류(401/429 등)도 필드오류와 동일하게 포커스가 이동해야 한다(Low #8).
  // 배너 DOM은 banner가 설정된 다음 렌더에야 존재하므로 useEffect에서 포커스를 옮긴다.
  useEffect(() => {
    if (banner) bannerRef.current?.focus();
  }, [banner]);

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (submitting) return;
    setEmailError(undefined);
    setPasswordError(undefined);
    setBanner(null);
    setSubmitting(true);
    try {
      await login(email, password);
      const returnTo = searchParams.get('returnTo');
      navigate(returnTo ? decodeURIComponent(returnTo) : '/', { replace: true });
    } catch (e2) {
      if (e2 instanceof ApiError) {
        if (e2.status === 400 && e2.details && e2.details.length > 0) {
          const fieldErrors = fieldErrorsFromApiError(e2);
          setEmailError(fieldErrors.email);
          setPasswordError(fieldErrors.password);
          if (fieldErrors.email) emailRef.current?.focus();
        } else if (e2.code === 'INVALID_CREDENTIALS') {
          // §0-4: 계정 열거 방지를 위해 서버 message가 아니라 클라이언트 고정 문구를 쓴다.
          setBanner(MESSAGES.auth.invalidCredentials);
        } else if (e2.code === 'ACCOUNT_LOCKED') {
          // 서버 message가 이미 "로그인 시도가 너무 많습니다. N분 후 다시 시도해 주세요." 형식이다.
          setBanner(e2.message);
        } else if (e2.status === 429) {
          setBanner(MESSAGES.auth.rateLimited);
        } else {
          setBanner(e2.message || MESSAGES.auth.networkError);
        }
      } else {
        setBanner(MESSAGES.auth.networkError);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-standalone-layout">
      <div className="auth-card">
        <h1 className="auth-app-title">{MESSAGES.auth.appTitle}</h1>
        <h2 className="auth-card-title">{MESSAGES.auth.loginTitle}</h2>
        <form onSubmit={handleSubmit} noValidate>
          <div className="form-field">
            <label htmlFor="login-email">
              {MESSAGES.auth.emailLabel} <span className="required-mark" aria-hidden="true">*</span>
            </label>
            <input
              id="login-email"
              ref={emailRef}
              type="email"
              value={email}
              autoComplete="username"
              aria-invalid={Boolean(emailError)}
              aria-describedby={emailError ? 'login-email-error' : undefined}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus
            />
            {emailError && (
              <p id="login-email-error" className="field-error" role="alert">
                <span aria-hidden="true">⚠</span> {emailError}
              </p>
            )}
          </div>
          <PasswordField
            id="login-password"
            label={MESSAGES.auth.passwordLabel}
            value={password}
            onChange={setPassword}
            autoComplete="current-password"
            errorMessage={passwordError}
            required
          />
          {banner && (
            <p
              ref={bannerRef}
              tabIndex={-1}
              className="form-banner form-banner--error"
              role="alert"
              aria-live="assertive"
            >
              <span aria-hidden="true">ⓘ</span> {banner}
            </p>
          )}
          <button type="submit" className="btn btn-primary auth-submit-button" disabled={submitting}>
            {submitting ? MESSAGES.auth.loggingIn : MESSAGES.auth.loginButton}
          </button>
        </form>
      </div>
    </div>
  );
}
