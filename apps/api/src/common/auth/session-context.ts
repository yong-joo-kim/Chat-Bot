import type { RoleName, UserStatus } from '@chat-bot/shared-types';

/**
 * `PermissionGuard`가 세션 검증 후 `req.user`에 부착하는 인증된 사용자 뷰(FR-12-16).
 * `passwordHash`는 존재하지 않는다(NFR-S1).
 */
export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: RoleName;
  status: UserStatus;
  mustChangePassword: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuthenticatedRequest {
  user?: SessionUser;
}

export type { AuthenticatedActor } from '../request-context/request-context.service';
