import { useState, type FormEvent } from 'react';
import type { RoleListItem, RoleName, User } from '@chat-bot/shared-types';
import { Modal } from '../../../components/Modal';
import { usersApi } from '../../../api/users';
import { ApiError } from '../../../api/client';
import { MESSAGES } from '../../../constants/messages';

/** U1 역할 변경(security-audit-ui-spec.md §3.7.2). `409 LAST_ADMIN`은 모달을 닫지 않고 배너로 안내한다(S-9). */
export function ChangeRoleModal({
  user,
  roleOptions,
  onClose,
  onSuccess,
}: {
  user: User | null;
  roleOptions: RoleListItem[];
  onClose: () => void;
  onSuccess: () => void;
}): JSX.Element {
  const [newRole, setNewRole] = useState<RoleName | ''>('');
  const [banner, setBanner] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const otherRoles = roleOptions.filter((r) => r.role !== user?.role);

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!user || !newRole) return;
    setSubmitting(true);
    setBanner(null);
    try {
      await usersApi.update(user.id, { role: newRole });
      onSuccess();
    } catch (e2) {
      if (e2 instanceof ApiError && e2.code === 'LAST_ADMIN') {
        setBanner(MESSAGES.users.lastAdminRoleError);
      } else if (e2 instanceof ApiError && e2.code === 'SELF_MODIFICATION') {
        setBanner(MESSAGES.users.selfModificationError);
      } else if (e2 instanceof ApiError) {
        setBanner(e2.message);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal isOpen={Boolean(user)} title={MESSAGES.users.changeRoleTitle} onClose={onClose}>
      {user && (
        <form onSubmit={handleSubmit} noValidate>
          {banner && (
            <p className="modal-banner modal-banner--error" role="alert">
              {banner}
            </p>
          )}
          <div className="form-field">
            <label htmlFor="change-role-select">{MESSAGES.users.changeRoleLabel}</label>
            <select
              id="change-role-select"
              value={newRole}
              autoFocus
              onChange={(e) => setNewRole(e.target.value as RoleName)}
            >
              <option value="" disabled>
                —
              </option>
              {otherRoles.map((r) => (
                <option key={r.role} value={r.role}>
                  {r.label}
                </option>
              ))}
            </select>
            {/* [No.24] U1-ext — 선택된 역할 설명(security-audit-ui-spec.md §3.7 기존 위치·형식 계승). */}
            {newRole && <p className="field-hint">{MESSAGES.users.roleDescriptions[newRole]}</p>}
          </div>
          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              {MESSAGES.common.cancel}
            </button>
            <button type="submit" className="btn btn-primary" disabled={submitting || !newRole}>
              {MESSAGES.common.save}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
