import type { AuditTargetType } from '@chat-bot/shared-types';

/**
 * ★ 열람 감사 닫힌 목록(No.45, §11.3) — `@AuditView(...)` 부착 위치와 이 상수가 1:1이어야 한다
 * (정적 검사 G-15). 새 열람 감사 대상을 추가하려면 이 배열도 함께 늘려야 한다.
 */
export interface ViewAuditTargetDef {
  readonly controller: string;
  readonly handler: string;
  readonly targetType: AuditTargetType;
}

export const VIEW_AUDIT_TARGETS: readonly ViewAuditTargetDef[] = [
  { controller: 'LiveSessionsController', handler: 'list', targetType: 'ConversationLog' },
  { controller: 'LiveSessionsController', handler: 'getTranscript', targetType: 'ConversationLog' },
  { controller: 'HandoffsController', handler: 'detail', targetType: 'HandoffSession' },
  { controller: 'SurveyResultsController', handler: 'responses', targetType: 'Survey' },
  { controller: 'SurveyResultsController', handler: 'textAnswers', targetType: 'Survey' },
  { controller: 'UnansweredQuestionsController', handler: 'detail', targetType: 'UnansweredQuestion' },
  { controller: 'AuditLogsController', handler: 'list', targetType: 'AuditLog' },
  { controller: 'AuditLogsController', handler: 'findOne', targetType: 'AuditLog' },
];
