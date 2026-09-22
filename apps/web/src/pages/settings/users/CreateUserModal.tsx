import { useEffect, useState, type FormEvent } from 'react';
import type { RoleListItem, RoleName } from '@chat-bot/shared-types';
import { Modal } from '../../../components/Modal';
import { InlineFieldError } from '../../../components/InlineFieldError';
import { TemporaryPasswordReveal } from '../../../components/security/TemporaryPasswordReveal';
import { usersApi, rolesApi } from '../../../api/users';
import { ApiError } from '../../../api/client';
import { MESSAGES } from '../../../constants/messages';
import { fieldErrorsFromApiError } from '../../../lib/apiErrorHelpers';

/**
 * U1 회원 등록(security-audit-ui-spec.md §3.7.1). 성공 시 같은 모달 안에서
 * `TemporaryPasswordReveal`로 전환한다(모달이 닫혔다 다시 열리는 깜빡임 방지).
 */
export function CreateUserModal({
  isOpen,
  onClose,
  onCreated,
}: {
  isOpen: boolean;
  onClose: () => void;
  onCreated: () => void;
}): JSX.Element {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<RoleName | ''>('');
  const [roleOptions, setRoleOptions] = useState<RoleListItem[]>([]);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState<{ name: string; temporaryPassword: string } | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setEmail('');
    setName('');
    setRole('');
    setFieldErrors({});
    setCreated(null);
    rolesApi
      .list()
      .then((res) => {
        setRoleOptions(res.items);
        setRole((prev) => prev || res.items[0]?.role || '');
      })
      .catch(() => setRoleOptions([]));
  }, [isOpen]);

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!role) return;
    setSubmitting(true);
    setFieldErrors({});
    try {
      const res = await usersApi.create({ email: email.trim(), name: name.trim(), role });
      setCreated({ name: res.user.name, temporaryPassword: res.temporaryPassword });
    } catch (e2) {
      if (e2 instanceof ApiError && e2.code === 'DUPLICATE_EMAIL') {
        setFieldErrors({ email: MESSAGES.users.duplicateEmailError });
      } else {
        setFieldErrors(fieldErrorsFromApiError(e2));
      }
    } finally {
      setSubmitting(false);
    }
  }

  function handleAcknowledge(): void {
    onCreated();
    onClose();
  }

  return (
    <Modal
      isOpen={isOpen}
      title={created ? MESSAGES.users.temporaryPasswordLabel : MESSAGES.users.createTitle}
      onClose={created ? () => undefined : onClose}
      closeOnEsc={!created}
    >
      {created ? (
        <TemporaryPasswordReveal
          title={MESSAGES.users.createSuccessTitle(created.name)}
          temporaryPassword={created.temporaryPassword}
          onAcknowledge={handleAcknowledge}
        />
      ) : (
        <form onSubmit={handleSubmit} noValidate>
          <div className="form-field">
            <label htmlFor="create-user-email">
              {MESSAGES.users.emailLabel} <span className="required-mark" aria-hidden="true">*</span>
            </label>
            <input
              id="create-user-email"
              type="email"
              value={email}
              autoFocus
              required
              onChange={(e) => setEmail(e.target.value)}
              aria-describedby={fieldErrors.email ? 'create-user-email-error' : undefined}
              aria-invalid={Boolean(fieldErrors.email)}
            />
            <InlineFieldError id="create-user-email-error" message={fieldErrors.email} />
          </div>
          <div className="form-field">
            <label htmlFor="create-user-name">
              {MESSAGES.users.nameLabel} <span className="required-mark" aria-hidden="true">*</span>
            </label>
            <input id="create-user-name" type="text" value={name} required maxLength={100} onChange={(e) => setName(e.target.value)} />
            <InlineFieldError id="create-user-name-error" message={fieldErrors.name} />
          </div>
          <div className="form-field">
            <label htmlFor="create-user-role">{MESSAGES.users.roleLabel}</label>
            <select id="create-user-role" value={role} onChange={(e) => setRole(e.target.value as RoleName)}>
              {roleOptions.map((r) => (
                <option key={r.role} value={r.role}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>
          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              {MESSAGES.common.cancel}
            </button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {MESSAGES.common.save}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
