import { z } from 'zod';
import { PaginationQuerySchema } from './common';
import { VersionDiffSummarySchema } from './version';

/**
 * 환경 분리 / 버전 관리(No.40) — `environment-separation-설계.md` §4.1, ADR-0039.
 * 의존: `environment.ts → common · version(VersionDiffSummarySchema)`(단방향). `deploy-schedule.ts`가
 * 이 파일을 역으로 의존한다(SWITCH_PROD_VERSION 미리보기 — 순환을 피하려고 이 파일은 deploy-schedule을
 * 의존하지 않는다. 사유 메모는 `deploy-schedule.MemoSchema`를 재사용하지 않고 `EnvironmentReasonSchema`를
 * 별도로 둔다).
 */

export const EnvironmentKind = z.enum(['DRAFT', 'STAGING', 'PROD']);
export type EnvironmentKind = z.infer<typeof EnvironmentKind>;

export const EnvironmentSwitchMethod = z.enum(['INIT', 'PROMOTE', 'IMMEDIATE', 'SCHEDULED', 'ROLLBACK', 'DISABLE']);
export type EnvironmentSwitchMethod = z.infer<typeof EnvironmentSwitchMethod>;

export const EnvironmentDisableMode = z.enum(['KEEP_PROD', 'PROMOTE_DRAFT']);
export type EnvironmentDisableMode = z.infer<typeof EnvironmentDisableMode>;

export const EnvironmentGateMode = z.enum(['WARN', 'BLOCK']);
export type EnvironmentGateMode = z.infer<typeof EnvironmentGateMode>;

export const ENVIRONMENT_LIMITS = {
  reasonMaxCodePoints: 200,
  historyPageSizeDefault: 20,
  historyPageSizeMax: 100,
  gateMinPassRateMin: 0,
  gateMinPassRateMax: 100,
  gateValidHoursMin: 1,
  gateValidHoursMax: 168,
} as const;

export const EnvironmentReasonSchema = z
  .string()
  .trim()
  .min(1)
  .refine((v) => Array.from(v).length <= ENVIRONMENT_LIMITS.reasonMaxCodePoints, {
    message: `사유는 최대 ${ENVIRONMENT_LIMITS.reasonMaxCodePoints}자까지 입력할 수 있습니다.`,
  })
  .refine((v) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v), {
    message: '사유에 제어 문자를 포함할 수 없습니다.',
  });

export const EnvironmentVersionRefSchema = z.object({
  versionId: z.string().uuid(),
  versionNo: z.number().int().positive(),
  capturedAt: z.coerce.date(),
  label: z.string().nullable(),
});
export type EnvironmentVersionRef = z.infer<typeof EnvironmentVersionRefSchema>;

export const EnvironmentGateSettingsSchema = z.object({
  mode: EnvironmentGateMode,
  testSetId: z.string().uuid().nullable(),
  minPassRate: z.number().int().min(ENVIRONMENT_LIMITS.gateMinPassRateMin).max(ENVIRONMENT_LIMITS.gateMinPassRateMax),
  validHours: z.number().int().min(ENVIRONMENT_LIMITS.gateValidHoursMin).max(ENVIRONMENT_LIMITS.gateValidHoursMax),
});
export type EnvironmentGateSettings = z.infer<typeof EnvironmentGateSettingsSchema>;

/** PUT 본문 — BLOCK이면 testSetId 필수. */
export const UpdateEnvironmentGateSchema = EnvironmentGateSettingsSchema.superRefine((v, ctx) => {
  if (v.mode === 'BLOCK' && !v.testSetId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['testSetId'], message: '차단 게이트는 필수 검증 세트를 지정해야 합니다.' });
  }
});
export type UpdateEnvironmentGateDto = z.infer<typeof UpdateEnvironmentGateSchema>;

export const GateEvaluationSchema = z.object({
  verdict: z.enum(['PASS', 'WARN', 'BLOCK']),
  reason: z.enum(['PASSED', 'NO_RUN', 'BELOW_THRESHOLD', 'EXPIRED', 'MODEL_CHANGED', 'SET_MISSING', 'NOT_CONFIGURED']).optional(),
  run: z
    .object({
      runId: z.string().uuid(),
      setId: z.string().uuid(),
      setName: z.string(),
      passRate: z.number().min(0).max(1),
      finishedAt: z.coerce.date(),
    })
    .nullable(),
});
export type GateEvaluation = z.infer<typeof GateEvaluationSchema>;

export const EnvironmentStatusSchema = z.discriminatedUnion('enabled', [
  z.object({ enabled: z.literal(false), gate: EnvironmentGateSettingsSchema.nullable() }),
  z.object({
    enabled: z.literal(true),
    enabledAt: z.coerce.date(),
    prod: EnvironmentVersionRefSchema.extend({
      switchedAt: z.coerce.date(),
      legacyTiebreak: z.boolean(),
      readFailed: z.boolean(),
      semanticPending: z.number().int().nonnegative(),
    }),
    staging: EnvironmentVersionRefSchema.extend({ legacyTiebreak: z.boolean(), semanticPending: z.number().int().nonnegative() }).nullable(),
    draft: z.object({ contentHash: z.string(), sameAsProd: z.boolean(), sameAsStaging: z.boolean() }),
    gate: EnvironmentGateSettingsSchema,
    activeSwitchSchedule: z
      .object({
        scheduleId: z.string().uuid(),
        scheduledAt: z.coerce.date(),
        targetVersionNo: z.number().int().positive(),
        status: z.enum(['PENDING', 'HELD']),
      })
      .nullable(),
  }),
]);
export type EnvironmentStatus = z.infer<typeof EnvironmentStatusSchema>;

/* ── 켜기 ── */

export const EnableEnvironmentPreviewResponseSchema = z.object({
  draftContentHash: z.string(),
  version: z.discriminatedUnion('action', [
    z.object({ action: z.literal('REUSE'), versionId: z.string().uuid(), versionNo: z.number().int().positive() }),
    z.object({ action: z.literal('CREATE') }),
  ]),
  heldRestoreSchedules: z.number().int().nonnegative(),
  blockers: z.array(z.enum(['CHATBOT_ARCHIVED', 'RESTORE_IN_PROGRESS', 'SCHEDULE_RUNNING', 'ALREADY_ENABLED'])),
});
export type EnableEnvironmentPreviewResponse = z.infer<typeof EnableEnvironmentPreviewResponseSchema>;

export const EnableEnvironmentSchema = z.object({
  expectedDraftHash: z.string().regex(/^[0-9a-f]{64}$/),
  reason: EnvironmentReasonSchema.optional(),
});
export type EnableEnvironmentDto = z.infer<typeof EnableEnvironmentSchema>;

export const EnableEnvironmentResponseSchema = EnvironmentStatusSchema.and(z.object({ heldRestoreSchedules: z.number().int().nonnegative() }));
export type EnableEnvironmentResponse = z.infer<typeof EnableEnvironmentResponseSchema>;

/* ── 끄기 ── */

export const DisableEnvironmentPreviewResponseSchema = z.object({
  prod: EnvironmentVersionRefSchema,
  draftContentHash: z.string(),
  prodContentHash: z.string(),
  draftDiffersFromProd: z.boolean(),
  diffSummary: VersionDiffSummarySchema,
  cancelledSwitchSchedules: z.number().int().nonnegative(),
  /** 동점 노드가 있어 "운영 유지" 후 라이브 동점 승자가 달라질 수 있음(§27 L-6). */
  potentialTieShift: z.boolean(),
});
export type DisableEnvironmentPreviewResponse = z.infer<typeof DisableEnvironmentPreviewResponseSchema>;

export const DisableEnvironmentSchema = z.object({
  mode: EnvironmentDisableMode,
  expectedProdVersionId: z.string().uuid(),
  expectedDraftHash: z.string().regex(/^[0-9a-f]{64}$/),
  reason: EnvironmentReasonSchema.optional(),
});
export type DisableEnvironmentDto = z.infer<typeof DisableEnvironmentSchema>;

export const DisableEnvironmentResponseSchema = EnvironmentStatusSchema.and(z.object({ cancelledSwitchSchedules: z.number().int().nonnegative() }));
export type DisableEnvironmentResponse = z.infer<typeof DisableEnvironmentResponseSchema>;

/* ── 스테이징 승격 ── */

export const PromoteToStagingSchema = z.object({
  expectedStagingVersionId: z.string().uuid().nullable(),
  label: z.string().trim().min(1).max(50).optional(),
  memo: z.string().trim().min(1).max(500).optional(),
});
export type PromoteToStagingDto = z.infer<typeof PromoteToStagingSchema>;

export const PromoteToStagingResponseSchema = z.object({
  outcome: z.enum(['CREATED', 'REUSED', 'NOOP']),
  staging: EnvironmentVersionRefSchema,
  previousStagingVersionNo: z.number().int().positive().nullable(),
});
export type PromoteToStagingResponse = z.infer<typeof PromoteToStagingResponseSchema>;

/* ── 운영 전환 · 롤백 ── */

export const ProdSwitchWarningSchema = z.discriminatedUnion('code', [
  z.object({ code: z.literal('GATE_WARN'), gate: GateEvaluationSchema }),
  z.object({ code: z.literal('LEGACY_TIEBREAK') }),
  z.object({ code: z.literal('SEMANTIC_INDEX_PENDING'), count: z.number().int().nonnegative() }),
  z.object({ code: z.literal('CONTEXT_FLOWS_AFFECTED'), count: z.number().int().nonnegative() }),
  z.object({ code: z.literal('TOPIC_EXPOSURE_CHANGE'), exposed: z.number().int().nonnegative(), hidden: z.number().int().nonnegative() }),
  z.object({ code: z.literal('TOPIC_MISSING'), count: z.number().int().nonnegative() }),
  z.object({ code: z.literal('SURVEY_MISSING'), count: z.number().int().nonnegative() }),
  z.object({ code: z.literal('SURVEY_NOT_OPEN'), count: z.number().int().nonnegative() }),
  z.object({ code: z.literal('API_CONNECTION_MISSING'), count: z.number().int().nonnegative() }),
  z.object({ code: z.literal('API_CONNECTION_DISABLED'), count: z.number().int().nonnegative() }),
  z.object({ code: z.literal('PROFILE_WILL_CHANGE'), fields: z.array(z.string()) }),
  z.object({ code: z.literal('OLDER_THAN_DRAFT') }),
  // [No.41 신설] 업무 자동화 워크플로우 — 전부 blocker 아님(ADR-0041 §8).
  z.object({ code: z.literal('WORKFLOW_TARGET_MISSING'), count: z.number().int().nonnegative() }),
  z.object({ code: z.literal('WORKFLOW_TARGET_DISABLED'), count: z.number().int().nonnegative() }),
]);
export type ProdSwitchWarning = z.infer<typeof ProdSwitchWarningSchema>;

export const ProdSwitchPreviewSchema = z.object({
  kind: z.enum(['SWITCH', 'ROLLBACK']),
  targetVersionId: z.string().uuid().optional(),
});
export type ProdSwitchPreviewDto = z.infer<typeof ProdSwitchPreviewSchema>;

export const ProdSwitchPreviewResponseSchema = z.object({
  kind: z.enum(['SWITCH', 'ROLLBACK']),
  current: EnvironmentVersionRefSchema,
  target: EnvironmentVersionRefSchema,
  expectedProdVersionId: z.string().uuid(),
  outcome: z.enum(['SWITCHABLE', 'NOOP']),
  diffSummary: VersionDiffSummarySchema,
  gate: GateEvaluationSchema,
  blockers: z.array(z.enum(['TARGET_NOT_ALLOWED', 'GATE_BLOCKED', 'GATE_CONFIG_ERROR', 'TARGET_UNREADABLE', 'CHATBOT_ARCHIVED', 'ENV_MODE_DISABLED'])),
  warnings: z.array(ProdSwitchWarningSchema),
});
export type ProdSwitchPreviewResponse = z.infer<typeof ProdSwitchPreviewResponseSchema>;

export const ProdSwitchSchema = z.object({
  targetVersionId: z.string().uuid(),
  expectedProdVersionId: z.string().uuid(),
  acknowledgeWarnings: z.boolean().optional(),
  reason: EnvironmentReasonSchema.optional(),
});
export type ProdSwitchDto = z.infer<typeof ProdSwitchSchema>;

/** 생략 = 직전 운영 버전(자동 결정). */
export const ProdRollbackSchema = ProdSwitchSchema.extend({ targetVersionId: z.string().uuid().optional() });
export type ProdRollbackDto = z.infer<typeof ProdRollbackSchema>;

export const ProdSwitchResponseSchema = z.object({
  outcome: z.enum(['APPLIED', 'NOOP']),
  prod: EnvironmentVersionRefSchema,
  fromVersionNo: z.number().int().positive(),
  semanticPending: z.number().int().nonnegative(),
});
export type ProdSwitchResponse = z.infer<typeof ProdSwitchResponseSchema>;

/* ── 이력 ── */

export const EnvironmentSwitchLogItemSchema = z.object({
  id: z.string().uuid(),
  environment: z.enum(['STAGING', 'PROD']),
  method: EnvironmentSwitchMethod,
  fromVersionNo: z.number().int().positive().nullable(),
  toVersionNo: z.number().int().positive().nullable(),
  toVersionId: z.string().uuid().nullable(),
  deployScheduleId: z.string().uuid().nullable(),
  disableMode: EnvironmentDisableMode.nullable(),
  actorEmail: z.string().nullable(),
  reason: z.string().nullable(),
  createdAt: z.coerce.date(),
});
export type EnvironmentSwitchLogItem = z.infer<typeof EnvironmentSwitchLogItemSchema>;

export const EnvironmentHistoryQuerySchema = PaginationQuerySchema.extend({
  pageSize: z.coerce.number().int().min(1).max(ENVIRONMENT_LIMITS.historyPageSizeMax).default(ENVIRONMENT_LIMITS.historyPageSizeDefault),
  environment: EnvironmentKind.exclude(['DRAFT']).optional(),
});
export type EnvironmentHistoryQuery = z.infer<typeof EnvironmentHistoryQuerySchema>;

/* ── 버전 목록/상세 환경 배지 ── */

export const EnvironmentBadge = z.enum(['PROD', 'STAGING', 'PROD_HISTORY']);
export type EnvironmentBadge = z.infer<typeof EnvironmentBadge>;

/** 버전 목록·상세의 환경 배지(포인터·이력 파생 — 라벨과 무관). FE/BE 공용 순수 함수. 순서 고정: PROD → STAGING → PROD_HISTORY(현재 운영 제외). */
export function deriveEnvironmentBadges(
  versionId: string,
  ctx: { prodVersionId: string | null; stagingVersionId: string | null; prodHistoryIds: ReadonlySet<string> },
): EnvironmentBadge[] {
  const badges: EnvironmentBadge[] = [];
  if (ctx.prodVersionId === versionId) badges.push('PROD');
  if (ctx.stagingVersionId === versionId) badges.push('STAGING');
  if (versionId !== ctx.prodVersionId && ctx.prodHistoryIds.has(versionId)) badges.push('PROD_HISTORY');
  return badges;
}

/* ── 학습 큐 "운영 미반영" 판정(§15.1) ── */

export const ProdReflectionSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('PENDING_SWITCH') }),
  z.object({ status: z.literal('REFLECTED'), reflectedAt: z.coerce.date() }),
]);
export type ProdReflection = z.infer<typeof ProdReflectionSchema>;

/** 순수 함수 — now 무관. `prosSwitchesDesc`는 PROD 전환 이력을 최신순(내림차순)으로 정렬한 것. */
export function judgeProdReflection(input: {
  resolvedAt: Date;
  prodSwitchesDesc: ReadonlyArray<{ at: Date; toVersionCapturedAt: Date | null }>;
}): { status: 'PENDING_SWITCH' } | { status: 'REFLECTED'; reflectedAt: Date } {
  const { resolvedAt, prodSwitchesDesc } = input;
  if (prodSwitchesDesc.length === 0) return { status: 'PENDING_SWITCH' };

  const current = prodSwitchesDesc[0];
  if (!current.toVersionCapturedAt || current.toVersionCapturedAt.getTime() < resolvedAt.getTime()) {
    return { status: 'PENDING_SWITCH' };
  }

  // 최근 이력부터 거슬러 "toVersionCapturedAt ≥ resolvedAt"가 이어지는 가장 이른 이력의 at = reflectedAt.
  let earliest = current;
  for (const entry of prodSwitchesDesc) {
    if (entry.toVersionCapturedAt && entry.toVersionCapturedAt.getTime() >= resolvedAt.getTime()) {
      earliest = entry;
    } else {
      break;
    }
  }
  return { status: 'REFLECTED', reflectedAt: earliest.at };
}

export function shouldShowRecurredAfterApply(input: {
  recurredCount: number;
  lastOccurredAt: Date;
  reflection?: { status: 'PENDING_SWITCH' } | { status: 'REFLECTED'; reflectedAt: Date };
}): boolean {
  const { recurredCount, lastOccurredAt, reflection } = input;
  if (!reflection) return recurredCount > 0; // 모드 꺼짐 — 현행.
  if (reflection.status === 'PENDING_SWITCH') return false; // 운영 미반영 기간 재유입은 "반영 후 재발생"이 아니다.
  return recurredCount > 0 && lastOccurredAt.getTime() > reflection.reflectedAt.getTime();
}
