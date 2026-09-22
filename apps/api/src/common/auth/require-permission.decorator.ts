import { SetMetadata } from '@nestjs/common';
import type { Permission } from '@chat-bot/shared-types';

export const PERMISSION_METADATA_KEY = 'requiredPermission';

/**
 * 컨트롤러 핸들러에 필요한 권한을 표시하는 데코레이터(FR-12-18, ADR-0015).
 * 인자 타입이 `Permission` 유니온으로 좁혀져 있어, 유니온에 없는 문자열은 **빌드가 실패한다**(AC-12B-9).
 * 기존 75곳에 부착된 문자열 값은 한 글자도 바꾸지 않는다.
 */
export const RequirePermission = (permission: Permission): MethodDecorator & ClassDecorator =>
  SetMetadata(PERMISSION_METADATA_KEY, permission);
