import type { ReactNode } from 'react';
import type { Permission } from '@chat-bot/shared-types';
import { useAuth } from '../../context/AuthContext';
import { ForbiddenState } from './ForbiddenState';

/**
 * 페이지 단위 접근 거부 가드(F-4, security-audit-ui-spec.md §3.5). 주소는 그대로 유지한 채
 * 그 라우트의 콘텐츠 자리에 `ForbiddenState`(L4)를 대신 렌더한다(AC-U-6).
 */
export function RequirePermission({
  permission,
  menuName,
  children,
}: {
  permission: Permission;
  menuName?: string;
  children: ReactNode;
}): JSX.Element {
  const { can } = useAuth();
  if (!can(permission)) return <ForbiddenState menuName={menuName} />;
  return <>{children}</>;
}
