import { z } from 'zod';
import { PaginationQuerySchema, SafeUrlSchema, csvEnumArray, queryBoolean } from './common';
import { ApiConnectionAuthType, ApiSecretStatus } from './legacy-api';
import { EgressDecision } from './governance';

/**
 * [신규 No.41] 업무 자동화 워크플로우 커넥터 — 발송 대상·이벤트 구독·발송함(실행 이력)·봉투 v1 계약.
 * `docs/02-spec/workflow-automation-설계.md` §4 근거. `common.ts`·`dialogue.ts`(간접, 순환 방지 위해
 * 직접 참조하지 않는다)·`legacy-api.ts`·`governance.ts`만 의존한다.
 */

export const WorkflowEventType = z.enum([
  'NODE_ACTION',
  'HANDOFF_STARTED',
  'HANDOFF_ENDED',
  'SURVEY_COMPLETED',
  'FEEDBACK_NEGATIVE',
  'UNANSWERED_STREAK',
  'TEST',
]);
export type WorkflowEventType = z.infer<typeof WorkflowEventType>;

export const WorkflowSubscriptionEventType = z.enum(['HANDOFF_STARTED', 'HANDOFF_ENDED', 'SURVEY_COMPLETED', 'FEEDBACK_NEGATIVE', 'UNANSWERED_STREAK']);
export type WorkflowSubscriptionEventType = z.infer<typeof WorkflowSubscriptionEventType>;

export const WORKFLOW_SUBSCRIPTION_EVENT_LABELS: Record<WorkflowSubscriptionEventType, string> = {
  HANDOFF_STARTED: '상담 시작',
  HANDOFF_ENDED: '상담 종료',
  SURVEY_COMPLETED: '설문 완료',
  FEEDBACK_NEGATIVE: '부정 평가',
  UNANSWERED_STREAK: '연속 미응답',
};

export const WorkflowTriggerKind = z.enum(['NODE', 'EVENT', 'TEST']);
export type WorkflowTriggerKind = z.infer<typeof WorkflowTriggerKind>;

export const WorkflowRunStatus = z.enum(['PENDING', 'HELD', 'SENDING', 'SUCCEEDED', 'FAILED', 'SKIPPED', 'CANCELLED', 'EXPIRED']);
export type WorkflowRunStatus = z.infer<typeof WorkflowRunStatus>;

export const WorkflowStatusReason = z.enum([
  // SKIPPED
  'FEATURE_DISABLED',
  'TARGET_UNAVAILABLE',
  'BINDING_MISSING',
  'RATE_LIMITED',
  'PAYLOAD_TOO_LARGE',
  // CANCELLED
  'TARGET_DELETED',
  'MANUAL',
  // FAILED
  'PERMANENT_ERROR',
  'MAX_ATTEMPTS',
  // [신규 2026-09-26 — 화면설계 계약 반영, §10.1·§26 I-1] 보관 봉투 복호화 실패(옛 키 제거·손상) —
  // 송신하지 않고 FAILED로 종결한다. 콘솔이 PERMANENT_ERROR와 구분해 표시한다.
  'DECRYPT_FAILED',
  // EXPIRED
  'HOLD_EXPIRED',
]);
export type WorkflowStatusReason = z.infer<typeof WorkflowStatusReason>;

export const WorkflowOutcome = z.enum([
  'SUCCESS',
  'HTTP_ERROR',
  'TIMEOUT',
  'NETWORK_ERROR',
  'REDIRECT_NOT_ALLOWED',
  'BLOCKED_ADDRESS',
  'EGRESS_BLOCKED',
  'SECRET_MISSING',
  'TARGET_HOST_MISMATCH',
  'INVALID_TARGET_URL',
  'LEASE_EXPIRED',
]);
export type WorkflowOutcome = z.infer<typeof WorkflowOutcome>;

export const WorkflowHoldReason = z.enum(['TARGET', 'SUBSCRIPTION']);
export type WorkflowHoldReason = z.infer<typeof WorkflowHoldReason>;

/** 코드 상수(§3.4) — 환경변수가 아닌 고정값. */
export const WORKFLOW_LIMITS = {
  instanceConcurrentSends: 10,
  targetConcurrentSending: 2,
  perNodeOutputs: 3,
  fieldsMax: 20,
  fieldValueMax: 500,
  emissionsPerTurn: 10,
  subscriptionsPerChatbot: 20,
  testSendPerMinutePerTarget: 5,
  bulkRetryCancelMax: 100,
  historyRangeDays: 90,
  responseBodyConsumeBytes: 4096,
} as const;

/* ------------------------------------------------------------------------------------------------
 * 발송 대상
 * ---------------------------------------------------------------------------------------------- */

export const WorkflowTargetBaseUrlSchema = SafeUrlSchema.superRefine((v, ctx) => {
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: '올바른 URL 형식이 아닙니다.' });
    return;
  }
  if (u.username || u.password) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'URL에 사용자 정보를 포함할 수 없습니다.' });
  if (u.search) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'URL에 쿼리 문자열을 포함할 수 없습니다.' });
  if (u.hash) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'URL에 프래그먼트를 포함할 수 없습니다.' });
  const lowerPath = u.pathname.toLowerCase();
  if (lowerPath.includes('%2e') || lowerPath.includes('..') || lowerPath.includes('//')) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: '기준 경로에 상대 경로 이탈 문자를 포함할 수 없습니다.' });
  }
});

const SECRET_REF_PATTERN = /^[A-Z0-9_]{1,40}$/;
const FORBIDDEN_HEADER_NAMES = ['host', 'content-length', 'content-type', 'cookie', 'set-cookie', 'transfer-encoding', 'connection', 'accept', 'user-agent', 'te', 'upgrade', 'idempotency-key'];
const FORBIDDEN_HEADER_PREFIXES = ['proxy-', 'x-forwarded-', 'x-chatbot-'];

export function isForbiddenWorkflowHeaderName(name: string): boolean {
  const lower = name.toLowerCase();
  if (FORBIDDEN_HEADER_NAMES.includes(lower)) return true;
  return FORBIDDEN_HEADER_PREFIXES.some((p) => lower.startsWith(p));
}

function checkWorkflowTargetBody(
  val: { authType: ApiConnectionAuthType; authHeaderName?: string; secretRef?: string; signingEnabled: boolean; signingSecretRef?: string },
  ctx: z.RefinementCtx,
): void {
  if (val.authType !== 'NONE' && !val.secretRef) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: '인증 방식을 사용하려면 시크릿 참조 이름이 필요합니다.', path: ['secretRef'] });
  }
  if (val.authHeaderName && isForbiddenWorkflowHeaderName(val.authHeaderName)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: '사용할 수 없는 헤더 이름입니다.', path: ['authHeaderName'] });
  }
  if (val.signingEnabled && !val.signingSecretRef) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: '서명을 사용하려면 서명 시크릿 참조 이름이 필요합니다.', path: ['signingSecretRef'] });
  }
}

export const CreateWorkflowTargetSchema = z
  .object({
    name: z.string().trim().min(1, '이름을 입력해 주세요.').max(100),
    description: z.string().max(300).optional(),
    baseUrl: WorkflowTargetBaseUrlSchema,
    authType: ApiConnectionAuthType.default('NONE'),
    authHeaderName: z.string().regex(/^[A-Za-z0-9-]{1,64}$/).optional(),
    secretRef: z.string().regex(SECRET_REF_PATTERN).optional(),
    signingEnabled: z.boolean().default(true),
    signingSecretRef: z.string().regex(SECRET_REF_PATTERN).optional(),
    urlSecretRef: z.string().regex(SECRET_REF_PATTERN).optional(),
    timeoutMs: z.number().int().min(1000).max(15000).default(5000),
    maxAttempts: z.number().int().min(1).max(10).default(5),
    allowRawPersonalData: z.boolean().default(false),
    enabled: z.boolean().default(true),
    confirmRawPersonalData: z.string().max(200).optional(),
  })
  .superRefine(checkWorkflowTargetBody);
export type CreateWorkflowTargetDto = z.infer<typeof CreateWorkflowTargetSchema>;

export const UpdateWorkflowTargetSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    description: z.string().max(300).nullable().optional(),
    baseUrl: WorkflowTargetBaseUrlSchema.optional(),
    authType: ApiConnectionAuthType.optional(),
    authHeaderName: z.string().regex(/^[A-Za-z0-9-]{1,64}$/).nullable().optional(),
    secretRef: z.string().regex(SECRET_REF_PATTERN).nullable().optional(),
    signingEnabled: z.boolean().optional(),
    signingSecretRef: z.string().regex(SECRET_REF_PATTERN).nullable().optional(),
    urlSecretRef: z.string().regex(SECRET_REF_PATTERN).nullable().optional(),
    timeoutMs: z.number().int().min(1000).max(15000).optional(),
    maxAttempts: z.number().int().min(1).max(10).optional(),
    allowRawPersonalData: z.boolean().optional(),
    enabled: z.boolean().optional(),
    confirmRawPersonalData: z.string().max(200).optional(),
  })
  .superRefine((val, ctx) => {
    if (val.authHeaderName && isForbiddenWorkflowHeaderName(val.authHeaderName)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: '사용할 수 없는 헤더 이름입니다.', path: ['authHeaderName'] });
    }
  });
export type UpdateWorkflowTargetDto = z.infer<typeof UpdateWorkflowTargetSchema>;

export const WorkflowSecretStates = z.object({
  auth: ApiSecretStatus,
  signing: ApiSecretStatus,
  url: ApiSecretStatus,
  signingWeak: z.boolean(),
});
export type WorkflowSecretStatesView = z.infer<typeof WorkflowSecretStates>;

export const WorkflowTargetSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  baseUrl: z.string(),
  baseUrlHost: z.string(),
  authType: ApiConnectionAuthType,
  authHeaderName: z.string().nullable(),
  secretRef: z.string().nullable(),
  signingEnabled: z.boolean(),
  signingSecretRef: z.string().nullable(),
  urlSecretRef: z.string().nullable(),
  timeoutMs: z.number().int(),
  maxAttempts: z.number().int(),
  allowRawPersonalData: z.boolean(),
  enabled: z.boolean(),
  pausedAt: z.coerce.date().nullable(),
  secretStates: WorkflowSecretStates,
  insecureHttp: z.boolean(),
  egressDecision: EgressDecision,
  consecutiveFailures: z.number().int().nonnegative(),
  lastSuccessAt: z.coerce.date().nullable(),
  lastFailureAt: z.coerce.date().nullable(),
  referencingNodeCount: z.number().int().nonnegative(),
  subscriptionCount: z.number().int().nonnegative(),
  stats24h: z.object({ succeeded: z.number().int().nonnegative(), failed: z.number().int().nonnegative() }),
  pendingCount: z.number().int().nonnegative(),
  heldCount: z.number().int().nonnegative(),
  failedRetainedCount: z.number().int().nonnegative(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type WorkflowTarget = z.infer<typeof WorkflowTargetSchema>;

export const WorkflowTargetListResponseSchema = z.object({ items: z.array(WorkflowTargetSchema) });
export type WorkflowTargetListResponse = z.infer<typeof WorkflowTargetListResponseSchema>;

/** 노드 편집기·구독 선택 목록 — 주소·비밀 참조 없음(FR-WF1-1). */
export const WorkflowTargetPickerItemSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  enabled: z.boolean(),
  paused: z.boolean(),
  ready: z.boolean(),
  allowRawPersonalData: z.boolean(),
});
export type WorkflowTargetPickerItem = z.infer<typeof WorkflowTargetPickerItemSchema>;
export const WorkflowTargetPickerResponseSchema = z.object({ items: z.array(WorkflowTargetPickerItemSchema) });
export type WorkflowTargetPickerResponse = z.infer<typeof WorkflowTargetPickerResponseSchema>;

export const WorkflowTestSendRequestSchema = z.object({
  actionKey: z.string().regex(/^[a-z0-9._-]{1,60}$/).optional(),
});
export type WorkflowTestSendRequestDto = z.infer<typeof WorkflowTestSendRequestSchema>;

export const WorkflowTestSendResultSchema = z.object({
  runId: z.string().uuid(),
  outcome: WorkflowOutcome,
  httpStatus: z.number().int().optional(),
  latencyMs: z.number().int().nonnegative(),
  attempted: z.boolean(),
  targetDisabled: z.boolean(),
  targetPaused: z.boolean(),
  blockedAddress: z.string().optional(),
  guidance: z.string(),
});
export type WorkflowTestSendResult = z.infer<typeof WorkflowTestSendResultSchema>;

/* ------------------------------------------------------------------------------------------------
 * 이벤트 구독
 * ---------------------------------------------------------------------------------------------- */

export const WorkflowSubscriptionConditionsSchema = z
  .object({
    threshold: z.number().int().min(2).max(10).optional(),
    includeStructuredAnswers: z.boolean().optional(),
  })
  .strict();
export type WorkflowSubscriptionConditions = z.infer<typeof WorkflowSubscriptionConditionsSchema>;

function checkSubscriptionConditions(eventType: WorkflowSubscriptionEventType, conditions: WorkflowSubscriptionConditions, ctx: z.RefinementCtx): void {
  if (conditions.threshold !== undefined && eventType !== 'UNANSWERED_STREAK') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'threshold는 연속 미응답 이벤트에만 설정할 수 있습니다.', path: ['conditions', 'threshold'] });
  }
  if (conditions.includeStructuredAnswers !== undefined && eventType !== 'SURVEY_COMPLETED') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'includeStructuredAnswers는 설문 완료 이벤트에만 설정할 수 있습니다.', path: ['conditions', 'includeStructuredAnswers'] });
  }
}

export const CreateWorkflowSubscriptionSchema = z
  .object({
    eventType: WorkflowSubscriptionEventType,
    targetId: z.string().uuid(),
    enabled: z.boolean().default(true),
    conditions: WorkflowSubscriptionConditionsSchema.default({}),
  })
  .superRefine((val, ctx) => checkSubscriptionConditions(val.eventType, val.conditions, ctx));
export type CreateWorkflowSubscriptionDto = z.infer<typeof CreateWorkflowSubscriptionSchema>;

export const UpdateWorkflowSubscriptionSchema = z.object({
  targetId: z.string().uuid().optional(),
  enabled: z.boolean().optional(),
  conditions: WorkflowSubscriptionConditionsSchema.optional(),
});
export type UpdateWorkflowSubscriptionDto = z.infer<typeof UpdateWorkflowSubscriptionSchema>;

export const WorkflowSubscriptionSchema = z.object({
  id: z.string().uuid(),
  chatbotId: z.string().uuid(),
  eventType: WorkflowSubscriptionEventType,
  targetId: z.string().uuid(),
  targetName: z.string(),
  targetEnabled: z.boolean(),
  targetPaused: z.boolean(),
  enabled: z.boolean(),
  pausedAt: z.coerce.date().nullable(),
  conditions: WorkflowSubscriptionConditionsSchema,
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type WorkflowSubscription = z.infer<typeof WorkflowSubscriptionSchema>;
export const WorkflowSubscriptionListResponseSchema = z.object({ items: z.array(WorkflowSubscriptionSchema) });
export type WorkflowSubscriptionListResponse = z.infer<typeof WorkflowSubscriptionListResponseSchema>;

/* ------------------------------------------------------------------------------------------------
 * 실행 이력(발송함)
 * ---------------------------------------------------------------------------------------------- */

export const WorkflowRunItemSchema = z.object({
  id: z.string().uuid(),
  targetId: z.string().uuid(),
  targetName: z.string(),
  chatbotId: z.string().uuid().nullable(),
  triggerKind: WorkflowTriggerKind,
  eventType: WorkflowEventType,
  actionKey: z.string().nullable(),
  nodeId: z.string().uuid().nullable(),
  subscriptionId: z.string().uuid().nullable(),
  sessionRef: z.string().nullable(),
  status: WorkflowRunStatus,
  statusReason: WorkflowStatusReason.nullable(),
  holdReason: WorkflowHoldReason.nullable(),
  attemptCount: z.number().int().nonnegative(),
  nextAttemptAt: z.coerce.date().nullable(),
  lastOutcome: WorkflowOutcome.nullable(),
  lastHttpStatus: z.number().int().nullable(),
  lastLatencyMs: z.number().int().nullable(),
  personalDataMasked: z.boolean(),
  fieldNames: z.array(z.string()),
  retryable: z.boolean(),
  payloadPurged: z.boolean(),
  manualRetryCount: z.number().int().nonnegative(),
  createdAt: z.coerce.date(),
  completedAt: z.coerce.date().nullable(),
});
export type WorkflowRunItem = z.infer<typeof WorkflowRunItemSchema>;

export const WorkflowRunListQuerySchema = PaginationQuerySchema.extend({
  targetId: z.string().uuid().optional(),
  chatbotId: z.string().uuid().optional(),
  triggerKind: csvEnumArray(WorkflowTriggerKind),
  eventType: csvEnumArray(WorkflowEventType),
  status: csvEnumArray(WorkflowRunStatus),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  retryableOnly: queryBoolean().default(false),
});
export type WorkflowRunListQuery = z.infer<typeof WorkflowRunListQuerySchema>;

export const WorkflowRunListResponseSchema = z.object({
  items: z.array(WorkflowRunItemSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
});
export type WorkflowRunListResponse = z.infer<typeof WorkflowRunListResponseSchema>;

export const WorkflowRunBulkRequestSchema = z.object({
  runIds: z.array(z.string().uuid()).min(1).max(WORKFLOW_LIMITS.bulkRetryCancelMax),
});
export type WorkflowRunBulkRequestDto = z.infer<typeof WorkflowRunBulkRequestSchema>;

export const WorkflowRunBulkResultSchema = z.object({ updated: z.number().int().nonnegative() });
export type WorkflowRunBulkResult = z.infer<typeof WorkflowRunBulkResultSchema>;

export const WorkflowSummaryResponseSchema = z.object({
  days: z.union([z.literal(7), z.literal(30)]),
  timezone: z.string(),
  /** [신규 — 프런트엔드 계약 보강, 코드 리뷰 R1 후속] `WORKFLOW_ENABLED` 현재값 — 콘솔이 기능 꺼짐
   * 배너를 별도 엔드포인트 없이 이 요약 화면에서 함께 표시한다. */
  featureEnabled: z.boolean(),
  totals: z.object({
    occurred: z.number().int().nonnegative(),
    succeeded: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
    cancelled: z.number().int().nonnegative(),
    expired: z.number().int().nonnegative(),
    pending: z.number().int().nonnegative(),
    held: z.number().int().nonnegative(),
  }),
  retryRate: z.number().min(0).max(1),
  p95DeliveryMs: z.number().nullable(),
  approximated: z.boolean(),
  byTarget: z.array(z.object({ targetId: z.string().uuid(), targetName: z.string(), succeeded: z.number().int(), failed: z.number().int() })),
  byEvent: z.array(z.object({ eventType: WorkflowEventType, succeeded: z.number().int(), failed: z.number().int() })),
  daily: z.array(z.object({ dayBucket: z.string(), succeeded: z.number().int(), failed: z.number().int(), skipped: z.number().int() })),
  attention: z.object({
    failingTargets: z.number().int().nonnegative(),
    failedRetained: z.number().int().nonnegative(),
    secretMissingTargets: z.number().int().nonnegative(),
    oldestPendingMinutes: z.number().nullable(),
    enqueueFailures24h: z.number().int().nonnegative(),
  }),
});
export type WorkflowSummaryResponse = z.infer<typeof WorkflowSummaryResponseSchema>;

/* ------------------------------------------------------------------------------------------------
 * 시뮬레이터 모의
 * ---------------------------------------------------------------------------------------------- */

export const WorkflowStepViewSchema = z.object({
  nodeId: z.string().uuid(),
  targetId: z.string().uuid(),
  targetName: z.string().nullable(),
  targetState: z.enum(['READY', 'DISABLED', 'PAUSED', 'MISSING', 'SECRET_MISSING']),
  actionKey: z.string(),
  /** [신규 — 필드 단위 마스킹 계약 보강, I-n] `maskPii`가 값을 바꾼 필드에만 `masked: true`를 싣는다.
   * 콘솔은 이 값이 없는 필드(비민감 CONST/SLOT)를 일괄 마스킹 처리하지 않는다. */
  fields: z.array(z.object({ name: z.string(), value: z.string(), source: z.enum(['CONST', 'SLOT']), masked: z.literal(true).optional() })),
  bindingMissing: z.boolean(),
  rawPersonalData: z.boolean(),
  personalDataMasked: z.boolean(),
  mock: z.literal(true),
});
export type WorkflowStepView = z.infer<typeof WorkflowStepViewSchema>;

/* ------------------------------------------------------------------------------------------------
 * 봉투 v1 — 외부 계약(`.strict()`)
 * ---------------------------------------------------------------------------------------------- */

export const WorkflowEventDataSchema = z.union([
  z.object({ handoffId: z.string().uuid(), alertLevelAtStart: z.string(), consecutiveUnansweredAtStart: z.number().int() }).strict(),
  z
    .object({
      handoffId: z.string().uuid(),
      endReason: z.string(),
      userMessageCount: z.number().int(),
      agentMessageCount: z.number().int(),
      firstResponseSeconds: z.number().int().nullable(),
      durationSeconds: z.number().int(),
    })
    .strict(),
  z
    .object({
      surveyId: z.string().uuid(),
      surveyName: z.string(),
      responseId: z.string().uuid(),
      isDuplicate: z.boolean(),
      missingRequiredCount: z.number().int(),
      answers: z
        .array(z.object({ questionKey: z.string(), choiceKeys: z.array(z.string()).optional(), score: z.number().optional() }))
        .optional(),
    })
    .strict(),
  z.object({ feedbackId: z.string().uuid(), messageId: z.string().uuid(), targetKind: z.string(), targetId: z.string().nullable(), answeredByRag: z.boolean() }).strict(),
  z.object({ streakCount: z.number().int(), threshold: z.number().int(), lastMessageId: z.string().uuid().nullable(), lastReason: z.enum(['FALLBACK', 'API_NOTICE']) }).strict(),
]);
export type WorkflowEventData = z.infer<typeof WorkflowEventDataSchema>;

export const WorkflowEnvelopeV1Schema = z
  .object({
    specVersion: z.literal('1'),
    deliveryId: z.string().uuid(),
    eventType: WorkflowEventType,
    occurredAt: z.string().datetime(),
    test: z.boolean(),
    chatbot: z.object({ id: z.string().uuid(), name: z.string() }).strict().nullable(),
    channel: z.enum(['WEB']).nullable(),
    sessionRef: z
      .string()
      .regex(/^[0-9a-f]{16}$/)
      .nullable(),
    source: z
      .object({
        messageId: z.string().uuid().optional(),
        nodeId: z.string().uuid().optional(),
        outputIndex: z.number().int().optional(),
        handoffId: z.string().uuid().optional(),
        surveyResponseId: z.string().uuid().optional(),
        feedbackId: z.string().uuid().optional(),
        subscriptionId: z.string().uuid().optional(),
      })
      .strict(),
    action: z.object({ key: z.string() }).strict().optional(),
    fields: z.record(z.string()).optional(),
    data: WorkflowEventDataSchema.optional(),
  })
  .strict();
export type WorkflowEnvelopeV1 = z.infer<typeof WorkflowEnvelopeV1Schema>;
