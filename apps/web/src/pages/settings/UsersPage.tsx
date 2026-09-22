import { useCallback, useEffect, useState } from 'react';
import type { RoleListItem, RoleName, User, UserStatus } from '@chat-bot/shared-types';
import { usersApi, rolesApi } from '../../api/users';
import { ApiError } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../components/Toast';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { SkeletonRow } from '../../components/Skeleton';
import { Pagination } from '../../components/Pagination';
import { KebabMenu } from '../../components/KebabMenu';
import { Modal, ConfirmDialog } from '../../components/Modal';
import { TemporaryPasswordReveal } from '../../components/security/TemporaryPasswordReveal';
import { RoleBadge, AccountStatusBadge } from '../../components/security/badges';
import { MESSAGES } from '../../constants/messages';
import { formatDateTime } from '../../lib/date';
import { UserFilterBar } from './users/UserFilterBar';
import { CreateUserModal } from './users/CreateUserModal';
import { ChangeRoleModal } from './users/ChangeRoleModal';
import { UserCardList } from './users/UserCard';

/** U1 — 회원 관리(security-audit-ui-spec.md §3.7). */
export function UsersPage(): JSX.Element {
  const { user: me, can } = useAuth();
  const { showToast } = useToast();
  const msg = MESSAGES.users;

  const [q, setQ] = useState('');
  const [role, setRole] = useState<RoleName[]>([]);
  const [status, setStatus] = useState<UserStatus[]>(['ACTIVE']);
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<User[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [roleOptions, setRoleOptions] = useState<RoleListItem[]>([]);

  const [createOpen, setCreateOpen] = useState(false);
  const [roleTarget, setRoleTarget] = useState<User | null>(null);
  const [statusTarget, setStatusTarget] = useState<User | null>(null);
  const [resetTarget, setResetTarget] = useState<User | null>(null);
  const [resetResult, setResetResult] = useState<{ name: string; temporaryPassword: string } | null>(null);

  const canWrite = can('user:write');

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      // 스키마상 `status`는 단일 값만 허용한다 — 정확히 1개만 체크된 경우에만 서버 필터를 건다.
      const statusParam = status.length === 1 ? status[0] : undefined;
      const res = await usersApi.list({ q: q || undefined, role: role.length > 0 ? role : undefined, status: statusParam, page, pageSize: 20 });
      setItems(res.items);
      setTotal(res.total);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [q, role, status, page]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    rolesApi
      .list()
      .then((res) => setRoleOptions(res.items))
      .catch(() => setRoleOptions([]));
  }, []);

  function resetFilters(): void {
    setQ('');
    setRole([]);
    setStatus(['ACTIVE']);
    setPage(1);
  }

  async function handleToggleStatus(target: User, nextStatus: UserStatus): Promise<void> {
    try {
      await usersApi.updateStatus(target.id, { status: nextStatus });
      showToast(nextStatus === 'DISABLED' ? msg.disableSuccess : msg.enableSuccess);
      setStatusTarget(null);
      void load();
    } catch (e) {
      setStatusTarget(null);
      if (e instanceof ApiError && e.code === 'LAST_ADMIN') {
        showToast(msg.lastAdminDisableError);
      } else {
        showToast(e instanceof ApiError ? e.message : MESSAGES.errors.generic);
      }
    }
  }

  async function handleResetPassword(): Promise<void> {
    if (!resetTarget) return;
    try {
      const res = await usersApi.resetPassword(resetTarget.id);
      setResetResult({ name: resetTarget.name, temporaryPassword: res.temporaryPassword });
    } catch (e) {
      setResetTarget(null);
      showToast(e instanceof ApiError ? e.message : MESSAGES.errors.generic);
    }
  }

  return (
    <div className="settings-page">
      <h1>{msg.title}</h1>
      <div className="dialogue-toolbar">
        <UserFilterBar q={q} role={role} status={status} onQChange={(v) => { setQ(v); setPage(1); }} onRoleChange={(v) => { setRole(v); setPage(1); }} onStatusChange={(v) => { setStatus(v); setPage(1); }} />
        {canWrite && (
          <button type="button" className="btn btn-primary" onClick={() => setCreateOpen(true)}>
            {msg.addButton}
          </button>
        )}
      </div>

      {loading && (
        <>
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </>
      )}
      {!loading && error && <ErrorState title={msg.loadFailed} onRetry={load} />}
      {!loading && !error && items.length === 0 && (
        <EmptyState
          title={msg.emptyTitle}
          action={
            <button type="button" className="btn btn-secondary" onClick={resetFilters}>
              {msg.resetFilter}
            </button>
          }
        />
      )}
      {!loading && !error && items.length > 0 && (
        <div className="dialogue-table-wrap">
          <table className="dialogue-table desktop-only">
            <thead>
              <tr>
                <th scope="col">{msg.columnName}</th>
                <th scope="col">{msg.columnEmail}</th>
                <th scope="col">{msg.columnRole}</th>
                <th scope="col">{msg.columnStatus}</th>
                <th scope="col">{msg.columnLastLogin}</th>
                <th scope="col">{msg.columnActions}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const isSelf = item.id === me?.id;
                return (
                  <tr key={item.id}>
                    <td>{item.name}</td>
                    <td>{item.email}</td>
                    <td>
                      <RoleBadge role={item.role} />
                    </td>
                    <td>
                      <AccountStatusBadge status={item.status} />
                    </td>
                    <td>{item.lastLoginAt ? formatDateTime(item.lastLoginAt) : msg.neverLoggedIn}</td>
                    <td>
                      {/* §3.7: 본인 행에는 액션 메뉴 자체가 없다 — 사용자가 스스로 해소할 수 없는 조작을 노출하지 않는다. */}
                      {canWrite && !isSelf && (
                        <KebabMenu
                          label={msg.kebabLabel(item.name)}
                          items={[
                            { label: msg.menuChangeRole, onSelect: () => setRoleTarget(item) },
                            item.status === 'ACTIVE'
                              ? { label: msg.menuDisable, onSelect: () => setStatusTarget(item) }
                              : { label: msg.menuEnable, onSelect: () => void handleToggleStatus(item, 'ACTIVE') },
                            { label: msg.menuResetPassword, onSelect: () => setResetTarget(item) },
                          ]}
                        />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <UserCardList
            items={items}
            loading={false}
            currentUserId={me?.id}
            canWrite={canWrite}
            onChangeRole={(u) => setRoleTarget(u)}
            onDisable={(u) => setStatusTarget(u)}
            onEnable={(u) => void handleToggleStatus(u, 'ACTIVE')}
            onResetPassword={(u) => setResetTarget(u)}
          />
          <Pagination page={page} pageSize={20} total={total} onPageChange={setPage} />
        </div>
      )}

      <CreateUserModal isOpen={createOpen} onClose={() => setCreateOpen(false)} onCreated={() => void load()} />

      <ChangeRoleModal
        user={roleTarget}
        roleOptions={roleOptions}
        onClose={() => setRoleTarget(null)}
        onSuccess={() => {
          showToast(msg.changeRoleSuccess);
          setRoleTarget(null);
          void load();
        }}
      />

      <ConfirmDialog
        isOpen={Boolean(statusTarget)}
        title={msg.disableTitle}
        description={statusTarget ? msg.disableDesc(statusTarget.name) : ''}
        confirmLabel={msg.menuDisable}
        danger
        onConfirm={() => statusTarget && void handleToggleStatus(statusTarget, 'DISABLED')}
        onCancel={() => setStatusTarget(null)}
      />

      <ConfirmDialog
        isOpen={Boolean(resetTarget) && !resetResult}
        title={msg.resetPasswordTitle}
        description={msg.resetPasswordDesc}
        confirmLabel={msg.menuResetPassword}
        danger
        onConfirm={() => void handleResetPassword()}
        onCancel={() => setResetTarget(null)}
      />

      <Modal
        isOpen={Boolean(resetResult)}
        title={msg.temporaryPasswordLabel}
        onClose={() => undefined}
        closeOnEsc={false}
      >
        {resetResult && (
          <TemporaryPasswordReveal
            title={`'${resetResult.name}' ${msg.resetPasswordTitle}`}
            temporaryPassword={resetResult.temporaryPassword}
            notice={msg.resetPasswordNotice}
            onAcknowledge={() => {
              setResetResult(null);
              setResetTarget(null);
            }}
          />
        )}
      </Modal>
    </div>
  );
}
