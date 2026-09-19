import { SetMetadata } from '@nestjs/common';

export const PERMISSION_METADATA_KEY = 'requiredPermission';

/**
 * 컨트롤러 핸들러에 필요한 권한을 표시하는 데코레이터(NFR-S5).
 * Phase 1의 `PermissionGuard`는 이 메타데이터를 읽지 않는 no-op이다 — No.12에서 구현을 채운다.
 * 예: `@RequirePermission('chatbot:write')`, `@RequirePermission('chatbot:read')`.
 */
export const RequirePermission = (permission: string): MethodDecorator & ClassDecorator =>
  SetMetadata(PERMISSION_METADATA_KEY, permission);
