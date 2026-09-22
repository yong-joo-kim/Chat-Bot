import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { hasPermission } from '@chat-bot/shared-types';
import type { Permission, RoleName } from '@chat-bot/shared-types';
import { ApiException } from '../api.exception';
import type { RateLimitStore } from '../rate-limit/rate-limit.store';
import { RequestContextService } from '../request-context/request-context.service';
import { AuditLogService } from '../../audit-logs/audit-log.service';
import { SessionService } from '../../auth/session.service';
import { parseCookieHeader, SESSION_COOKIE_NAME } from './lib/cookie';
import { IS_PUBLIC_KEY, PASSWORD_CHANGE_EXEMPT_KEY } from './public.decorator';
import { PERMISSION_METADATA_KEY } from './require-permission.decorator';
import type { AuthenticatedRequest, SessionUser } from './session-context';

const PERMISSION_DENIED_WINDOW_MS = 60_000;

/**
 * 실제 동작하는 RBAC 가드(FR-12-16, ADR-0015 §3). `APP_GUARD`로 전역 등록해 fail-closed로 만든다.
 * 판정 순서: `@Public()` → 쿠키 → 세션 → 계정 상태 → 비밀번호 변경 강제 → 권한.
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessionService: SessionService,
    private readonly requestContext: RequestContextService,
    private readonly auditLogService: AuditLogService,
    @Inject('RateLimitStore') private readonly rateLimitStore: RateLimitStore,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<Request & AuthenticatedRequest>();

    const cookies = parseCookieHeader(req.headers.cookie);
    const token = cookies[SESSION_COOKIE_NAME];
    if (!token) throw new ApiException('UNAUTHENTICATED', 401, '로그인이 필요합니다.');

    const resolved = await this.sessionService.resolve(token);
    if (!resolved) throw new ApiException('SESSION_EXPIRED', 401, '로그인이 만료되었습니다. 다시 로그인해 주세요.');

    const { user } = resolved;
    if (user.status !== 'ACTIVE') {
      throw new ApiException('ACCOUNT_DISABLED', 401, '비활성화된 계정입니다.');
    }

    req.user = user;
    this.requestContext.setActor({ id: user.id, email: user.email, role: user.role });

    const passwordChangeExempt = this.reflector.getAllAndOverride<boolean>(PASSWORD_CHANGE_EXEMPT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (user.mustChangePassword && !passwordChangeExempt) {
      throw new ApiException('PASSWORD_CHANGE_REQUIRED', 403, '비밀번호를 먼저 변경해야 합니다.');
    }

    const required = this.reflector.getAllAndOverride<Permission>(PERMISSION_METADATA_KEY, [context.getHandler(), context.getClass()]);
    if (required && !hasPermission(user.role as RoleName, required)) {
      await this.recordPermissionDenied(user, req, required);
      // 요구 권한 문자열은 응답 본문에 담지 않는다(FR-12-23, AC-12B-7) — 서버 로그·AuditLog.summary에만 남긴다.
      throw new ApiException('FORBIDDEN', 403, '이 작업을 수행할 권한이 없습니다.');
    }

    // 데코레이터가 없으면(⑦) 인증만 요구하고 통과한다 — fail-closed의 기본값이 "닫힘"이다(FR-0-24).
    return true;
  }

  /** PERMISSION_DENIED 폭증 방지 — 동일 사용자·경로 조합은 60초 내 1건으로 합친다(FR-13-9, DD-46). */
  private async recordPermissionDenied(user: SessionUser, req: Request, required: Permission): Promise<void> {
    const routePath = (req.route as { path?: string } | undefined)?.path ?? req.path;
    const key = `audit:denied:${user.id}:${req.method} ${routePath}`;
    const result = this.rateLimitStore.consume(key, Date.now(), 1, PERMISSION_DENIED_WINDOW_MS);
    if (!result.allowed) return;

    await this.auditLogService.record({
      action: 'PERMISSION_DENIED',
      targetType: 'Session',
      targetId: user.id,
      summary: `${req.method} ${req.path} · 요구 권한 ${required}`,
      actorOverride: { id: user.id, email: user.email, role: user.role },
    });
  }
}
