import type { User } from '@chat-bot/shared-types';
import { KebabMenu } from '../../../components/KebabMenu';
import { SkeletonCard } from '../../../components/Skeleton';
import { RoleBadge, AccountStatusBadge } from '../../../components/security/badges';
import { MESSAGES } from '../../../constants/messages';
import { formatDateTime } from '../../../lib/date';

export interface UserCardListProps {
  items: User[];
  loading: boolean;
  currentUserId?: string;
  canWrite: boolean;
  onChangeRole: (user: User) => void;
  onDisable: (user: User) => void;
  onEnable: (user: User) => void;
  onResetPassword: (user: User) => void;
}

/**
 * U1 모바일 카드뷰(<640px, security-audit-ui-spec.md §9). 표(`UserTable`)와 동일한 정보를
 * 라벨+값 스택으로 표시한다. 본인 행에는 액션 메뉴를 노출하지 않는 규칙(§3.7)을 동일하게 유지한다.
 */
export function UserCardList({
  items,
  loading,
  currentUserId,
  canWrite,
  onChangeRole,
  onDisable,
  onEnable,
  onResetPassword,
}: UserCardListProps): JSX.Element {
  const msg = MESSAGES.users;

  if (loading) {
    return (
      <ul className="settings-card-list mobile-only">
        <li>
          <SkeletonCard />
        </li>
        <li>
          <SkeletonCard />
        </li>
        <li>
          <SkeletonCard />
        </li>
      </ul>
    );
  }

  return (
    <ul className="settings-card-list mobile-only">
      {items.map((item) => {
        const isSelf = item.id === currentUserId;
        return (
          <li key={item.id} className="settings-card">
            <div className="settings-card-header">
              <span className="settings-card-title">{item.name}</span>
              <AccountStatusBadge status={item.status} />
            </div>
            <dl className="settings-card-fields">
              <div>
                <dt>{msg.columnEmail}</dt>
                <dd>{item.email}</dd>
              </div>
              <div>
                <dt>{msg.columnRole}</dt>
                <dd>
                  <RoleBadge role={item.role} />
                </dd>
              </div>
              <div>
                <dt>{msg.columnLastLogin}</dt>
                <dd>{item.lastLoginAt ? formatDateTime(item.lastLoginAt) : msg.neverLoggedIn}</dd>
              </div>
            </dl>
            {canWrite && !isSelf && (
              <div className="settings-card-actions">
                <KebabMenu
                  label={msg.kebabLabel(item.name)}
                  items={[
                    { label: msg.menuChangeRole, onSelect: () => onChangeRole(item) },
                    item.status === 'ACTIVE'
                      ? { label: msg.menuDisable, onSelect: () => onDisable(item) }
                      : { label: msg.menuEnable, onSelect: () => onEnable(item) },
                    { label: msg.menuResetPassword, onSelect: () => onResetPassword(item) },
                  ]}
                />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
