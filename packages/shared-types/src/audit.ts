import { z } from 'zod';
import { PaginationQuerySchema, csvEnumArray, paginated } from './common';

/**
 * No.13 이력관리(감사추적) — `security-audit-설계.md` §4.2, ADR-0016.
 * `common.ts`에만 의존하는 단방향 의존 파일이다(개발명세서 §6-9 배치 규칙).
 */

/* ── 동작 12종 (FR-13-4) ── */
export const AuditAction = z.enum([
  'CREATE',
  'UPDATE',
  'DELETE',
  'PURGE',
  'STATUS_CHANGE',
  'BULK_DELETE',
  'IMPORT',
  'COPY',
  'LOGIN',
  'LOGIN_FAILED',
  'LOGOUT',
  'PERMISSION_DENIED',
]);
export type AuditAction = z.infer<typeof AuditAction>;

export const AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
  CREATE: '등록',
  UPDATE: '수정',
  DELETE: '삭제',
  PURGE: '영구삭제',
  STATUS_CHANGE: '상태변경',
  BULK_DELETE: '일괄삭제',
  IMPORT: '대량등록',
  COPY: '복사',
  LOGIN: '로그인',
  LOGIN_FAILED: '로그인 실패',
  LOGOUT: '로그아웃',
  PERMISSION_DENIED: '권한거부',
};

/** 파괴적 동작(시각적 구분 대상, FR-13-21). */
export const DESTRUCTIVE_AUDIT_ACTIONS: readonly AuditAction[] = ['DELETE', 'PURGE', 'BULK_DELETE'];

/* ── 대상 유형 (§9.3) — Prisma 모델명과 1:1 ── */
export const AuditTargetType = z.enum([
  'ChatbotGroup',
  'Chatbot',
  'Intent',
  'Keyword',
  'HomonymDictionary',
  'ContextVariable',
  'DialogNode',
  'FaqEntry',
  'Channel',
  'User',
  'BannedWord',
  'Session',
]);
export type AuditTargetType = z.infer<typeof AuditTargetType>;

export const AUDIT_TARGET_LABELS: Record<AuditTargetType, string> = {
  ChatbotGroup: '챗봇 그룹',
  Chatbot: '챗봇',
  Intent: '의도',
  Keyword: '키워드',
  HomonymDictionary: '동음이의어',
  ContextVariable: '컨텍스트',
  DialogNode: '대화노드',
  FaqEntry: 'FAQ',
  Channel: '채널',
  User: '회원',
  BannedWord: '금지어',
  Session: '세션',
};

/**
 * 대상 편집 화면 경로 템플릿(FR-13-22). 서버가 링크를 만들지 않고 프런트가 `:chatbotId`/`:id`
 * 자리표시자를 실제 값으로 치환해 조립한다. 편집 화면이 없는 대상(회원/금지어/세션/그룹 등)은
 * 이 맵에 없으며, 프런트는 그 경우 링크 없이 렌더한다.
 */
export const AUDIT_TARGET_ROUTE: Partial<Record<AuditTargetType, string>> = {
  Chatbot: '/chatbots/:id',
  DialogNode: '/chatbots/:chatbotId/dialogue/nodes/:id',
  ContextVariable: '/chatbots/:chatbotId/dialogue/contexts/:id',
};

export const AuditLogListItemSchema = z.object({
  id: z.string().uuid(),
  createdAt: z.coerce.date(),
  actorId: z.string().uuid().nullable(),
  actorEmail: z.string().nullable(),
  actorRole: z.string().nullable(),
  action: AuditAction,
  targetType: AuditTargetType,
  targetId: z.string(),
  targetName: z.string().nullable(),
  chatbotId: z.string().nullable(),
  summary: z.string().nullable(),
});
export type AuditLogListItem = z.infer<typeof AuditLogListItemSchema>;

export const AuditLogDetailSchema = AuditLogListItemSchema.extend({
  before: z.record(z.string(), z.unknown()).nullable(),
  after: z.record(z.string(), z.unknown()).nullable(),
  changedFields: z.array(z.string()),
  truncated: z.boolean(),
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
});
export type AuditLogDetail = z.infer<typeof AuditLogDetailSchema>;

export const AuditLogListQuerySchema = PaginationQuerySchema.extend({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  actorId: z.string().uuid().optional(),
  action: csvEnumArray(AuditAction),
  targetType: csvEnumArray(AuditTargetType),
  chatbotId: z.string().optional(),
  q: z.string().trim().min(1).max(100).optional(),
});
export type AuditLogListQuery = z.infer<typeof AuditLogListQuerySchema>;

/**
 * `appliedFrom`/`appliedTo`/`rangeDefaulted`를 함께 실어 보낸다(AC-13-9) — 기간 기본값·상한
 * 판정은 서버가 하고 프런트는 렌더만 한다(FR-11-3의 "서버 상수" 선례).
 */
export const AuditLogListResponseSchema = paginated(AuditLogListItemSchema).and(
  z.object({
    appliedFrom: z.coerce.date(),
    appliedTo: z.coerce.date(),
    rangeDefaulted: z.boolean(),
  }),
);
export type AuditLogListResponse = z.infer<typeof AuditLogListResponseSchema>;

export const AUDIT_LIMITS = {
  defaultRangeDays: 30,
  snapshotBytes: 8192,
  bulkTargetIds: 50,
  exportRows: 10000,
} as const;
