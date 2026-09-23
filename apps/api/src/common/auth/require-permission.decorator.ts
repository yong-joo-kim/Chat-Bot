import { SetMetadata } from '@nestjs/common';
import type { Permission } from '@chat-bot/shared-types';

export const PERMISSION_METADATA_KEY = 'requiredPermission';

/**
 * 컨트롤러 핸들러에 필요한 권한을 표시하는 데코레이터(FR-12-18, ADR-0015).
 * 인자 타입이 `Permission` 유니온으로 좁혀져 있어, 유니온에 없는 문자열은 **빌드가 실패한다**(AC-12B-9).
 * 기존 75곳+에 부착된 단일 인자 호출은 한 글자도 바꾸지 않는다.
 *
 * [신규 2026-09-23 No.25] 복수 인자 **AND** 확장(ADR-0031 §7, P-5) — 복원은 대화 자산(`dialogue:*`)과
 * 답변설정·표시설정(`chatbot:write`)을 함께 바꾸므로 두 권한을 모두 요구한다. 항상 배열로 저장하며
 * `PermissionGuard`가 배열 전체를 AND 판정한다. 튜플 타입(`[Permission, ...Permission[]]`)이라
 * 빈 호출은 컴파일 오류다.
 */
export const RequirePermission = (...permissions: [Permission, ...Permission[]]): MethodDecorator & ClassDecorator =>
  SetMetadata(PERMISSION_METADATA_KEY, permissions);
