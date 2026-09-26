import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { AuditLogService } from '../audit-log.service';
import { AUDIT_VIEW_METADATA_KEY } from './audit-view.decorator';
import type { AuditViewOptions } from './audit-view.decorator';

/**
 * ★ 열람 감사 기록 인터셉터(No.45, §11.3) — `recordView(` 호출 파일은 이 파일 1개다(정적 검사 G-15).
 * 2xx 완료 후에만 기록한다(권한 거부·404는 기록 없음). 모드 OFF 판정은 `AuditLogService.recordView()`
 * 안에서(쿼리 0) 이루어진다.
 */
@Injectable()
export class AccessViewInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly auditLog: AuditLogService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const options = this.reflector.get<AuditViewOptions | undefined>(AUDIT_VIEW_METADATA_KEY, context.getHandler());
    if (!options) return next.handle();

    const req = context.switchToHttp().getRequest<Request>();
    const targetId = options.idParam ? (req.params?.[options.idParam] ?? '*') : '*';
    const chatbotId = options.chatbotParam ? req.params?.[options.chatbotParam] : undefined;

    return next.handle().pipe(
      tap(() => {
        void this.auditLog.recordView({ targetType: options.targetType, targetId, chatbotId: chatbotId ?? null });
      }),
    );
  }
}
