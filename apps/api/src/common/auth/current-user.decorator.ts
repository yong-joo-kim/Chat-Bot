import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { SessionUser } from './session-context';

/**
 * 컨트롤러 전용 인증 주체 접근자(FR-0-26, ADR-0016 §3③). actor가 비즈니스 인자인 경우
 * (본인 비밀번호 변경, 자기수정 판정 등)에만 사용하며, 서비스 시그니처에 명시적으로 넘긴다.
 * 감사 기록용 암묵 전달(`RequestContextService`)과 이 데코레이터를 섞지 않는다.
 */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): SessionUser => {
  const req = ctx.switchToHttp().getRequest<Request & { user?: SessionUser }>();
  if (!req.user) {
    throw new Error('CurrentUser: 인증 컨텍스트가 없습니다. PermissionGuard 이후에만 사용할 수 있습니다.');
  }
  return req.user;
});
