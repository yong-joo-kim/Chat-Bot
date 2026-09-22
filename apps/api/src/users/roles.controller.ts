import { Controller, Get } from '@nestjs/common';
import { ROLE_LABELS, ROLE_PERMISSIONS, RoleListItem, RoleName } from '@chat-bot/shared-types';
import { RequirePermission } from '../common/auth/require-permission.decorator';

/**
 * `GET /roles` — 역할 3종과 역할별 권한 목록(FR-12-21). 테이블 기반 CRUD가 아니라
 * `shared-types`의 코드 상수를 그대로 반환하는 상수 조회 API다(J-6, ADR-0015).
 * enum 크기로 고정된 목록이므로 `{ items }`만 반환한다(개발명세서 §4.1 채널 8종과 동일 예외).
 */
@Controller('roles')
export class RolesController {
  @Get()
  @RequirePermission('user:read')
  list(): { items: RoleListItem[] } {
    const items = RoleName.options.map((role) => ({
      role,
      label: ROLE_LABELS[role],
      permissions: [...ROLE_PERMISSIONS[role]],
    }));
    return { items };
  }
}
