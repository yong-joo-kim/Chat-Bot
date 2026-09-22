import { useState, type FormEvent } from 'react';
import type { CurrentUser } from '@chat-bot/shared-types';
import { Modal } from '../Modal';
import { PasswordField } from './PasswordField';
import { authApi } from '../../api/auth';
import { ApiError } from '../../api/client';
import { MESSAGES } from '../../constants/messages';

/**
 * L3 — 세션 만료 재로그인 모달(security-audit-ui-spec.md §3.4). 배경의 폼/입력값은 어떤
 * 경우에도 리렌더·초기화되지 않는다 — 이 모달은 완전히 독립된 오버레이 레이어다.
 * `apps/web/src/api/client.ts`가 401을 감지해 `AuthProvider`를 통해 이 컴포넌트를 띄운다.
 */
export function SessionExpiredModal({
  email,
  onSuccess,
  onCancel,
}: {
  email: string;
  onSuccess: (user: CurrentUser) => void;
  onCancel: () => void;
}): JSX.Element {
  const msg = MESSAGES.auth.sessionExpired;
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      // C-1: 재로그인 경로도 계정 열거 방지를 위해 항상 동일 문구를 쓴다(비활성화 계정 포함).
      const res = await authApi.login({ email, password });
      onSuccess(res.user);
    } catch (e2) {
      if (e2 instanceof ApiError && (e2.status === 401 || e2.status === 429)) {
        setError(e2.status === 429 ? MESSAGES.auth.rateLimited : MESSAGES.auth.invalidCredentials);
      } else {
        setError(MESSAGES.auth.networkError);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal isOpen title={msg.title} onClose={onCancel} initialFocusSelector="#session-expired-password">
      <p className="modal-description">{msg.desc}</p>
      <form onSubmit={handleSubmit} noValidate>
        <div className="form-field">
          <label htmlFor="session-expired-email">{MESSAGES.auth.emailLabel}</label>
          <input id="session-expired-email" type="email" value={email} readOnly disabled />
        </div>
        <PasswordField
          id="session-expired-password"
          label={MESSAGES.auth.passwordLabel}
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
          required
        />
        {error && (
          <p className="form-banner form-banner--error" role="alert" aria-live="assertive">
            <span aria-hidden="true">ⓘ</span> {error}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            {msg.cancel}
          </button>
          <button type="submit" className="btn btn-primary" disabled={submitting || password.length === 0}>
            {msg.submit}
          </button>
        </div>
      </form>
    </Modal>
  );
}
