import { useEffect, useState } from 'react';
import { RoleName, ROLE_LABELS, UserStatus, type RoleName as RoleNameType, type UserStatus as UserStatusType } from '@chat-bot/shared-types';
import { useDebouncedValue } from '../../../lib/useDebouncedValue';
import { MESSAGES } from '../../../constants/messages';

export interface UserFilterBarProps {
  q: string;
  role: RoleNameType[];
  status: UserStatusType[];
  onQChange: (q: string) => void;
  onRoleChange: (role: RoleNameType[]) => void;
  onStatusChange: (status: UserStatusType[]) => void;
}

/** U1 필터바(security-audit-ui-spec.md §3.7). 역할 3개/상태 2개 체크박스 + 검색(300ms 디바운스). */
export function UserFilterBar({ q, role, status, onQChange, onRoleChange, onStatusChange }: UserFilterBarProps): JSX.Element {
  const [localQ, setLocalQ] = useState(q);
  const debouncedQ = useDebouncedValue(localQ, 300);

  useEffect(() => {
    if (debouncedQ !== q) onQChange(debouncedQ);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQ]);

  function toggleRole(value: RoleNameType): void {
    if (role.includes(value)) onRoleChange(role.filter((r) => r !== value));
    else onRoleChange([...role, value]);
  }

  function toggleStatus(value: UserStatusType): void {
    if (status.includes(value)) onStatusChange(status.filter((s) => s !== value));
    else onStatusChange([...status, value]);
  }

  return (
    <div className="chatbot-filter-bar">
      <div className="form-field form-field--inline">
        <label htmlFor="user-search">{MESSAGES.users.searchLabel}</label>
        <input
          id="user-search"
          type="search"
          value={localQ}
          placeholder={MESSAGES.users.searchPlaceholder}
          onChange={(e) => setLocalQ(e.target.value)}
        />
      </div>
      <fieldset className="status-filter">
        <legend>{MESSAGES.users.roleFilterLabel}</legend>
        {RoleName.options.map((r) => (
          <label key={r} className="status-filter-option">
            <input type="checkbox" checked={role.includes(r)} onChange={() => toggleRole(r)} />
            {ROLE_LABELS[r]}
          </label>
        ))}
      </fieldset>
      <fieldset className="status-filter">
        <legend>{MESSAGES.users.statusFilterLabel}</legend>
        {UserStatus.options.map((s) => (
          <label key={s} className="status-filter-option">
            <input type="checkbox" checked={status.includes(s)} onChange={() => toggleStatus(s)} />
            {s === 'ACTIVE' ? MESSAGES.users.statusActive : MESSAGES.users.statusDisabled}
          </label>
        ))}
        {/* Medium #3: 서버 스키마가 status 단일값만 허용해 0개/2개 선택 시 조용히 "전체"로 폴백된다 — 그 규칙을 안내한다. */}
        {status.length !== 1 && (
          <p className="field-hint" role="status">
            {MESSAGES.users.statusFilterFallbackHint}
          </p>
        )}
      </fieldset>
    </div>
  );
}
