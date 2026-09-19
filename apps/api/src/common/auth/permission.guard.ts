import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';

/**
 * 권한 검사 가드 삽입 지점(NFR-S5). Phase 1은 no-op(항상 통과)이며,
 * No.12(회원·권한·보안 관리)에서 `@RequirePermission()` 메타데이터를 읽어 실제 RBAC를 구현한다.
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  canActivate(_context: ExecutionContext): boolean {
    return true;
  }
}
