import { SetMetadata, UseInterceptors, applyDecorators } from '@nestjs/common';
import type { AuditTargetType } from '@chat-bot/shared-types';
import { AccessViewInterceptor } from './access-view.interceptor';

export const AUDIT_VIEW_METADATA_KEY = 'auditViewMeta';

export interface AuditViewOptions {
  targetType: AuditTargetType;
  /** 경로 파라미터 이름(예: 'sessionRef'|'handoffId'|'surveyId'|'id') — 생략하면 `'*'`(목록). */
  idParam?: string;
  /** 챗봇 스코프 경로 파라미터(보통 'chatbotId') — 있으면 `chatbotId`로 함께 기록. */
  chatbotParam?: string;
}

/**
 * ★ 열람 감사 데코레이터(No.45, §11.3) — 메타데이터 1줄만 컨트롤러에 남긴다. 실제 기록은
 * `AccessViewInterceptor` 1파일이 한다(`AuditLogService.recordView()` 호출). 닫힌 목록은
 * `view-audit-targets.ts`(정적 검사 G-15).
 */
export const AuditView = (options: AuditViewOptions): MethodDecorator =>
  applyDecorators(SetMetadata(AUDIT_VIEW_METADATA_KEY, options), UseInterceptors(AccessViewInterceptor));
