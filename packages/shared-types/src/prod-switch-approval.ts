import { z } from 'zod';
import { PaginationQuerySchema, paginated } from './common';
import { EnvironmentReasonSchema, ProdSwitchPreviewResponseSchema, ProdSwitchResponseSchema } from './environment';

/**
 * [신규 No.36] 운영 전환 2인 승인 — `docs/02-spec/ai-guardrails-설계.md` §10·§13.2, ADR-0048.
 * 요청자와 다른 `chatbot:deploy` 보유자의 승인 없이는 운영 포인터가 바뀌지 않는다(정책이 켜진 챗봇).
 */

export const ProdSwitchApprovalAction = z.enum(['PROD_SWITCH', 'PROD_ROLLBACK', 'SCHEDULED_PROD_SWITCH']);
export type ProdSwitchApprovalAction = z.infer<typeof ProdSwitchApprovalAction>;

export const ProdSwitchApprovalStatus = z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'EXPIRED']);
export type ProdSwitchApprovalStatus = z.infer<typeof ProdSwitchApprovalStatus>;

export const ProdSwitchApprovalOutcome = z.enum(['APPLIED', 'NOOP', 'FAILED', 'SCHEDULED']);
export type ProdSwitchApprovalOutcome = z.infer<typeof ProdSwitchApprovalOutcome>;

export const ProdSwitchApprovalClosedReason = z.enum(['REQUESTER', 'POLICY_OFF', 'BASE_CHANGED', 'SCHEDULE_INACTIVE']);
export type ProdSwitchApprovalClosedReason = z.infer<typeof ProdSwitchApprovalClosedReason>;

export const APPROVAL_TTL_HOURS = { min: 1, max: 168, default: 24 } as const;
export const APPROVAL_NOTE_MAX_CODE_POINTS = 200;

export const UpdateApprovalPolicySchema = z.object({
  required: z.boolean(),
  ttlHours: z.number().int().min(APPROVAL_TTL_HOURS.min).max(APPROVAL_TTL_HOURS.max),
});
export type UpdateApprovalPolicyDto = z.infer<typeof UpdateApprovalPolicySchema>;

export const CreateProdSwitchApprovalSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('PROD_SWITCH'),
    targetVersionId: z.string().uuid(),
    expectedProdVersionId: z.string().uuid(),
    acknowledgeWarnings: z.boolean().optional(),
    reason: EnvironmentReasonSchema.optional(),
  }),
  z.object({
    action: z.literal('PROD_ROLLBACK'),
    targetVersionId: z.string().uuid().optional(),
    expectedProdVersionId: z.string().uuid(),
    acknowledgeWarnings: z.boolean().optional(),
    reason: EnvironmentReasonSchema.optional(),
  }),
  z.object({
    action: z.literal('SCHEDULED_PROD_SWITCH'),
    deployScheduleId: z.string().uuid(),
    reason: EnvironmentReasonSchema.optional(),
  }),
]);
export type CreateProdSwitchApprovalDto = z.infer<typeof CreateProdSwitchApprovalSchema>;

export const ApproveProdSwitchSchema = z.object({ acknowledgeWarnings: z.boolean().optional() });
export type ApproveProdSwitchDto = z.infer<typeof ApproveProdSwitchSchema>;

export const RejectProdSwitchSchema = z.object({
  note: z
    .string()
    .trim()
    .refine((v) => Array.from(v).length <= APPROVAL_NOTE_MAX_CODE_POINTS, { message: `반려 메모는 최대 ${APPROVAL_NOTE_MAX_CODE_POINTS}자까지 입력할 수 있습니다.` })
    .optional(),
});
export type RejectProdSwitchDto = z.infer<typeof RejectProdSwitchSchema>;

const VersionRefLiteSchema = z.object({ versionId: z.string().uuid(), versionNo: z.number().int().positive() });

export const ProdSwitchApprovalSummarySchema = z.object({
  id: z.string().uuid(),
  chatbotId: z.string().uuid(),
  chatbotName: z.string(),
  action: ProdSwitchApprovalAction,
  /** 지연 판정이 반영된 유효 상태(만료·기준 변경·예약 비활성은 조회 시점에 종결). */
  status: ProdSwitchApprovalStatus,
  outcome: ProdSwitchApprovalOutcome.nullable(),
  failureCode: z.string().nullable(),
  closedReason: ProdSwitchApprovalClosedReason.nullable(),
  target: VersionRefLiteSchema,
  base: VersionRefLiteSchema,
  deployScheduleId: z.string().uuid().nullable(),
  scheduledAt: z.coerce.date().nullable(),
  gateVerdict: z.enum(['PASS', 'WARN', 'BLOCK']),
  warningCodes: z.array(z.string()),
  diffChangedCount: z.number().int(),
  reason: z.string().nullable(),
  decisionNote: z.string().nullable(),
  requestedBy: z.object({ id: z.string(), email: z.string(), active: z.boolean() }),
  decidedBy: z.object({ id: z.string(), email: z.string() }).nullable(),
  decidedAt: z.coerce.date().nullable(),
  expiresAt: z.coerce.date(),
  createdAt: z.coerce.date(),
  /** 요청자가 아니고 대기 중이면 true(서버가 다시 강제한다). */
  canApprove: z.boolean(),
  canCancel: z.boolean(),
  /** 실제 전환이 실행된 시각(즉시 승인 = 승인 시각, 예약 = 전환 이력 시각). 미실행 null. */
  executedAt: z.coerce.date().nullable(),
});
export type ProdSwitchApprovalSummary = z.infer<typeof ProdSwitchApprovalSummarySchema>;

export const ProdSwitchApprovalDetailSchema = ProdSwitchApprovalSummarySchema.extend({
  /** 대기 요청이면 현재 운영 기준 전환 미리보기(차이·게이트·경고). */
  livePreview: ProdSwitchPreviewResponseSchema.nullable(),
});
export type ProdSwitchApprovalDetail = z.infer<typeof ProdSwitchApprovalDetailSchema>;

export const ApprovalPolicyStatusSchema = z.object({
  policy: UpdateApprovalPolicySchema,
  envModeOn: z.boolean(),
  /** 활성 `chatbot:deploy` 보유자 수(나 포함) · 나 제외. */
  eligibleApproverCount: z.number().int().nonnegative(),
  otherApproverCount: z.number().int().nonnegative(),
  /** 끄기 잠금(실효값 — `ENV_APPROVAL_OFF_LOCKED` 명시값 우선, 미설정이면 거버넌스 모드 연동). */
  offLocked: z.boolean(),
  /** 잠겼을 때만 실린다: SERVER_SETTING = 서버 설정이 true · GOVERNANCE_MODE = 거버넌스 모드 기본 잠금(N36-1). */
  offLockedBy: z.enum(['SERVER_SETTING', 'GOVERNANCE_MODE']).optional(),
  pending: ProdSwitchApprovalSummarySchema.nullable(),
  recent: z.array(ProdSwitchApprovalSummarySchema).max(20),
});
export type ApprovalPolicyStatus = z.infer<typeof ApprovalPolicyStatusSchema>;

export const ApproveProdSwitchResponseSchema = z.object({
  request: ProdSwitchApprovalSummarySchema,
  /** 즉시 동작(전환·롤백)이면 전환 결과, 예약이면 null(실행은 예약 시각). */
  switch: ProdSwitchResponseSchema.nullable(),
});
export type ApproveProdSwitchResponse = z.infer<typeof ApproveProdSwitchResponseSchema>;

export const ApprovalListQuerySchema = PaginationQuerySchema.extend({
  status: z.enum(['PENDING', 'ALL']).default('PENDING'),
});
export type ApprovalListQuery = z.infer<typeof ApprovalListQuerySchema>;

export const ApprovalListResponseSchema = paginated(ProdSwitchApprovalSummarySchema);
export type ApprovalListResponse = z.infer<typeof ApprovalListResponseSchema>;

export const ApprovalSummaryResponseSchema = z.object({
  pendingTotal: z.number().int().nonnegative(),
  /** 요청자가 나 자신이 아닌 대기 건수(콘솔 배지). */
  pendingForMe: z.number().int().nonnegative(),
});
export type ApprovalSummaryResponse = z.infer<typeof ApprovalSummaryResponseSchema>;
