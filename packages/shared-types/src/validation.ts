import { z } from 'zod';
import { PaginationQuerySchema, queryBoolean } from './common';
import { DialogueOverlaySchema } from './conversation';

/**
 * 검증/품질 고도화 (No.19 대화검증시스템·TC테스트 / No.20 학습영향도 TEST) 계약.
 * `docs/02-spec/validation-regression-설계.md` §3, ADR-0029/0030 근거.
 * 의존 방향: `validation.ts → { common.ts, conversation.ts(오버레이 DTO 재사용) }` 단방향(역방향 없음).
 * `conversation.ts`에 넣지 않는다 — 그 파일은 위젯 서브패스 번들 경계를 공유하므로 검증 타입이
 * 위젯 빌드에 딸려 들어갈 위험이 있다.
 */

export const VALIDATION_LIMITS = {
  maxSetsPerChatbot: 20,
  maxCasesPerSet: 2000,
  maxCasesPerChatbot: 5000,
  maxTurnsPerCase: 5,
  maxMessageLength: 1000,
  maxAnswerNoteLength: 500,
  maxBulkDisable: 500,
  maxSuggestionIds: 50,
} as const;

/* ------------------------------------------------------------------------------------------------
 * 열거형 — J-1/J-4, ADR-0029 §2·§3
 * ---------------------------------------------------------------------------------------------- */

export const TestCaseExpectedKind = z.enum(['INTENT', 'FAQ', 'NODE', 'FALLBACK', 'ANY']);
export type TestCaseExpectedKind = z.infer<typeof TestCaseExpectedKind>;

/** 기대 대상 ID가 필수인 유형(§FR-V1-3). */
const TARGET_REQUIRED_KINDS: readonly TestCaseExpectedKind[] = ['INTENT', 'FAQ', 'NODE'];

export const TestCaseResultKind = z.enum(['PASS', 'FAIL', 'NOT_JUDGED', 'UNRESOLVED']);
export type TestCaseResultKind = z.infer<typeof TestCaseResultKind>;

export const TestRunMode = z.enum(['SINGLE', 'OVERLAY_COMPARE']);
export type TestRunMode = z.infer<typeof TestRunMode>;

export const TestRunStatus = z.enum(['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED']);
export type TestRunStatus = z.infer<typeof TestRunStatus>;

export const TestRunOverlaySource = z.enum(['NONE', 'INLINE', 'AUGMENTATION_SUGGESTIONS']);
export type TestRunOverlaySource = z.infer<typeof TestRunOverlaySource>;

export const TestRunComparisonKind = z.enum(['REGRESSED', 'IMPROVED', 'CHANGED', 'UNCHANGED', 'ONLY_IN_ONE']);
export type TestRunComparisonKind = z.infer<typeof TestRunComparisonKind>;

export const TestRunResultBand = z.enum(['CONFIRMED', 'AMBIGUOUS', 'FAILED', 'SKIPPED']);
export type TestRunResultBand = z.infer<typeof TestRunResultBand>;

/* ------------------------------------------------------------------------------------------------
 * TestCaseSet — FR-V1-1, FR-V1-8
 * ---------------------------------------------------------------------------------------------- */

export const TestCaseSetSchema = z.object({
  id: z.string().uuid(),
  chatbotId: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  isDefault: z.boolean(),
  /** 파생 카운트(조회 시점 집계) — 저장 컬럼이 아니다. */
  caseCount: z.number().int().nonnegative(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type TestCaseSet = z.infer<typeof TestCaseSetSchema>;

export const CreateTestCaseSetSchema = z.object({
  name: z.string().trim().min(1, '이름을 입력해 주세요.').max(100),
  description: z.string().max(300).optional(),
  isDefault: z.boolean().optional(),
});
export type CreateTestCaseSetDto = z.infer<typeof CreateTestCaseSetSchema>;

export const UpdateTestCaseSetSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  description: z.string().max(300).nullable().optional(),
  isDefault: z.boolean().optional(),
});
export type UpdateTestCaseSetDto = z.infer<typeof UpdateTestCaseSetSchema>;

export const TestCaseSetListQuerySchema = PaginationQuerySchema.extend({
  q: z.string().trim().min(1).max(100).optional(),
});
export type TestCaseSetListQuery = z.infer<typeof TestCaseSetListQuerySchema>;

/* ------------------------------------------------------------------------------------------------
 * TestCase — FR-V1-2~7
 * ---------------------------------------------------------------------------------------------- */

export const TestCaseMessageSchema = z.string().trim().min(1).max(VALIDATION_LIMITS.maxMessageLength);

export const TestCaseSchema = z.object({
  id: z.string().uuid(),
  setId: z.string().uuid(),
  chatbotId: z.string().uuid(),
  seq: z.number().int().nonnegative(),
  /** 1~5턴. 2건 이상이면 멀티턴이며 **마지막 턴으로 판정**한다(FR-V1-2). */
  messages: z.array(TestCaseMessageSchema).min(1).max(VALIDATION_LIMITS.maxTurnsPerCase),
  expectedKind: TestCaseExpectedKind,
  expectedTargetId: z.string().nullable(),
  /** 조회 시점에 서버가 현재 자산에서 해석해 채운다(FR-V1-4) — 저장하지 않는다. */
  expectedTargetName: z.string().nullable().optional(),
  /** 참고 메모. **판정에 일절 사용되지 않는다**(FR-V1-5). */
  expectedAnswerNote: z.string().nullable(),
  tags: z.array(z.string()).nullable().optional(),
  enabled: z.boolean(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type TestCase = z.infer<typeof TestCaseSchema>;

function refineExpectedTarget(val: { expectedKind: TestCaseExpectedKind; expectedTargetId?: string | null }, ctx: z.RefinementCtx): void {
  const requiresTarget = TARGET_REQUIRED_KINDS.includes(val.expectedKind);
  if (requiresTarget && !val.expectedTargetId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: '기대 대상을 선택해 주세요.', path: ['expectedTargetId'] });
  }
  if (!requiresTarget && val.expectedTargetId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'FALLBACK/ANY 유형은 기대 대상을 지정할 수 없습니다.', path: ['expectedTargetId'] });
  }
}

export const CreateTestCaseSchema = z
  .object({
    messages: z.array(TestCaseMessageSchema).min(1).max(VALIDATION_LIMITS.maxTurnsPerCase),
    expectedKind: TestCaseExpectedKind,
    expectedTargetId: z.string().optional(),
    expectedAnswerNote: z.string().max(VALIDATION_LIMITS.maxAnswerNoteLength).optional(),
    tags: z.array(z.string().max(50)).max(20).optional(),
    enabled: z.boolean().default(true),
  })
  .superRefine(refineExpectedTarget);
export type CreateTestCaseDto = z.infer<typeof CreateTestCaseSchema>;

export const UpdateTestCaseSchema = z.object({
  messages: z.array(TestCaseMessageSchema).min(1).max(VALIDATION_LIMITS.maxTurnsPerCase).optional(),
  expectedKind: TestCaseExpectedKind.optional(),
  expectedTargetId: z.string().nullable().optional(),
  expectedAnswerNote: z.string().max(VALIDATION_LIMITS.maxAnswerNoteLength).nullable().optional(),
  tags: z.array(z.string().max(50)).max(20).nullable().optional(),
  enabled: z.boolean().optional(),
});
export type UpdateTestCaseDto = z.infer<typeof UpdateTestCaseSchema>;

export const TestCaseListQuerySchema = PaginationQuerySchema.extend({
  expectedKind: TestCaseExpectedKind.optional(),
  enabled: queryBoolean().optional(),
  q: z.string().trim().min(1).max(200).optional(),
});
export type TestCaseListQuery = z.infer<typeof TestCaseListQuerySchema>;

export const BulkDisableTestCasesSchema = z.object({
  caseIds: z.array(z.string()).min(1).max(VALIDATION_LIMITS.maxBulkDisable),
});
export type BulkDisableTestCasesDto = z.infer<typeof BulkDisableTestCasesSchema>;

/* ------------------------------------------------------------------------------------------------
 * TestRun — FR-V1-16~25, FR-V2-1~19, ADR-0029 §2·§4
 * ---------------------------------------------------------------------------------------------- */

export const TestRunEnvFingerprintSchema = z.object({
  assetCounts: z.object({
    intents: z.number().int().nonnegative(),
    keywords: z.number().int().nonnegative(),
    homonyms: z.number().int().nonnegative(),
    contexts: z.number().int().nonnegative(),
    nodes: z.number().int().nonnegative(),
    faqs: z.number().int().nonnegative(),
  }),
  embeddingModelId: z.string().nullable(),
  semanticEnabled: z.boolean(),
  thresholds: z.object({ accept: z.number(), low: z.number(), margin: z.number() }),
  degradedMode: z.boolean(),
  useRag: z.boolean(),
  overlaySource: TestRunOverlaySource,
  engineVersion: z.string().optional(),
});
export type TestRunEnvFingerprint = z.infer<typeof TestRunEnvFingerprintSchema>;

export const TestRunSideSummarySchema = z.object({
  pass: z.number().int().nonnegative(),
  fail: z.number().int().nonnegative(),
  notJudged: z.number().int().nonnegative(),
  unresolved: z.number().int().nonnegative(),
});
export type TestRunSideSummary = z.infer<typeof TestRunSideSummarySchema>;

export const TestRunSummarySchema = z.object({
  a: TestRunSideSummarySchema,
  b: TestRunSideSummarySchema.optional(),
  regressed: z.number().int().nonnegative().optional(),
  improved: z.number().int().nonnegative().optional(),
  excludedSuggestions: z.number().int().nonnegative().optional(),
});
export type TestRunSummary = z.infer<typeof TestRunSummarySchema>;

export const TestRunSchema = z.object({
  id: z.string().uuid(),
  chatbotId: z.string().uuid(),
  setId: z.string().uuid(),
  mode: TestRunMode,
  overlaySource: TestRunOverlaySource,
  status: TestRunStatus,
  progress: z.number().int().min(0).max(100),
  totalCount: z.number().int().nonnegative(),
  processedCount: z.number().int().nonnegative(),
  summary: TestRunSummarySchema.nullable(),
  envFingerprint: TestRunEnvFingerprintSchema.nullable(),
  degradedMode: z.boolean(),
  useRag: z.boolean(),
  ragCallCount: z.number().int().nonnegative(),
  pinned: z.boolean(),
  failureReason: z.string().nullable(),
  elapsedMs: z.number().int().nonnegative().nullable().optional(),
  startedAt: z.coerce.date().nullable(),
  finishedAt: z.coerce.date().nullable(),
  createdAt: z.coerce.date(),
});
export type TestRun = z.infer<typeof TestRunSchema>;

export const TestRunListQuerySchema = PaginationQuerySchema.extend({
  setId: z.string().uuid().optional(),
  status: TestRunStatus.optional(),
});
export type TestRunListQuery = z.infer<typeof TestRunListQuerySchema>;

/** `overlay`는 No.10과 **동일한 `DialogueOverlaySchema`를 재사용**한다(AC-V3-9 — 새 DTO를 만들지 않는다). */
export const StartTestRunRequestSchema = z
  .object({
    overlaySource: TestRunOverlaySource.default('NONE'),
    overlay: DialogueOverlaySchema.optional(),
    suggestionIds: z.array(z.string()).max(VALIDATION_LIMITS.maxSuggestionIds).optional(),
    useRag: z.boolean().default(false),
  })
  .superRefine((val, ctx) => {
    if (val.overlaySource === 'INLINE' && !val.overlay) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'overlaySource가 INLINE이면 overlay가 필요합니다.', path: ['overlay'] });
    }
    if (val.overlaySource === 'AUGMENTATION_SUGGESTIONS' && (!val.suggestionIds || val.suggestionIds.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'overlaySource가 AUGMENTATION_SUGGESTIONS이면 suggestionIds가 필요합니다.',
        path: ['suggestionIds'],
      });
    }
  });
export type StartTestRunRequestDto = z.infer<typeof StartTestRunRequestSchema>;

export const StartTestRunResponseSchema = z.object({
  runId: z.string().uuid(),
  status: TestRunStatus,
});
export type StartTestRunResponse = z.infer<typeof StartTestRunResponseSchema>;

export const PinTestRunRequestSchema = z.object({ pinned: z.boolean() });
export type PinTestRunRequestDto = z.infer<typeof PinTestRunRequestSchema>;

/* ------------------------------------------------------------------------------------------------
 * TestRunResult — FR-V1-26~31
 * ---------------------------------------------------------------------------------------------- */

export const TestRunResultSchema = z.object({
  id: z.string().uuid(),
  runId: z.string().uuid(),
  caseId: z.string(),
  seq: z.number().int().nonnegative(),
  questionText: z.string(),
  expectedKind: TestCaseExpectedKind,
  expectedTargetId: z.string().nullable(),
  expectedTargetName: z.string().nullable().optional(),
  resultA: TestCaseResultKind,
  matchedIntentIdA: z.string().nullable(),
  matchedFaqIdA: z.string().nullable(),
  matchedNodeIdA: z.string().nullable(),
  matchedNameA: z.string().nullable().optional(),
  bandA: TestRunResultBand.nullable(),
  top1ScoreA: z.number().nullable(),
  top1KindA: z.enum(['FAQ', 'INTENT']).nullable(),
  top1IdA: z.string().nullable(),
  marginToTop2A: z.number().nullable(),
  outputsPreviewA: z.string().nullable(),
  unsupportedCountA: z.number().int().nonnegative(),
  blockedByFilterA: z.boolean(),
  elapsedMsA: z.number().int().nonnegative(),
  resultB: TestCaseResultKind.nullable().optional(),
  matchedIntentIdB: z.string().nullable().optional(),
  matchedFaqIdB: z.string().nullable().optional(),
  matchedNodeIdB: z.string().nullable().optional(),
  matchedNameB: z.string().nullable().optional(),
  bandB: TestRunResultBand.nullable().optional(),
  top1ScoreB: z.number().nullable().optional(),
  outputsPreviewB: z.string().nullable().optional(),
  diffStatus: z.enum(['SAME', 'DIFFERENT']).nullable().optional(),
  wouldUseRag: z.boolean(),
  ragAttempted: z.boolean(),
  ragLatencyMs: z.number().nullable().optional(),
  ragSourceCount: z.number().nullable().optional(),
  createdAt: z.coerce.date(),
});
export type TestRunResult = z.infer<typeof TestRunResultSchema>;

export const TestRunResultListQuerySchema = PaginationQuerySchema.extend({
  resultA: TestCaseResultKind.optional(),
  q: z.string().trim().min(1).max(200).optional(),
  /** OVERLAY_COMPARE 전용 — A=PASS → B=FAIL(요약의 `regressed`와 같은 규칙)만 서버에서 거른다. */
  regressedOnly: queryBoolean().default(false),
});
export type TestRunResultListQuery = z.infer<typeof TestRunResultListQuerySchema>;

/* ------------------------------------------------------------------------------------------------
 * 비교(M1) — FR-V2-4~19, ADR-0029 §2
 * ---------------------------------------------------------------------------------------------- */

export const TestRunComparisonQuerySchema = z.object({
  baseRunId: z.string(),
  targetRunId: z.string(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  /** 콤마 구분 분류 필터(예: `REGRESSED,FAIL`) — 서비스가 파싱한다. */
  filter: z.string().trim().optional(),
});
export type TestRunComparisonQuery = z.infer<typeof TestRunComparisonQuerySchema>;

export const TestRunComparisonRowSideSchema = z.object({
  result: TestCaseResultKind,
  matchedIntentId: z.string().nullable(),
  matchedFaqId: z.string().nullable(),
  matchedNodeId: z.string().nullable(),
  outputsHash: z.string(),
});
export type TestRunComparisonRowSide = z.infer<typeof TestRunComparisonRowSideSchema>;

export const TestRunComparisonRowSchema = z.object({
  caseId: z.string(),
  questionText: z.string().nullable(),
  classification: TestRunComparisonKind,
  base: TestRunComparisonRowSideSchema.nullable(),
  target: TestRunComparisonRowSideSchema.nullable(),
});
export type TestRunComparisonRow = z.infer<typeof TestRunComparisonRowSchema>;

export const FingerprintDiffBadgeSchema = z.object({
  key: z.string(),
  label: z.string(),
  severity: z.enum(['WARNING', 'INFO']),
});
export type FingerprintDiffBadge = z.infer<typeof FingerprintDiffBadgeSchema>;

export const TestRunComparisonCountsSchema = z.object({
  REGRESSED: z.number().int().nonnegative(),
  IMPROVED: z.number().int().nonnegative(),
  CHANGED: z.number().int().nonnegative(),
  UNCHANGED: z.number().int().nonnegative(),
  ONLY_IN_ONE: z.number().int().nonnegative(),
});
export type TestRunComparisonCounts = z.infer<typeof TestRunComparisonCountsSchema>;

export const TestRunComparisonSchema = z.object({
  base: TestRunSchema,
  target: TestRunSchema,
  counts: TestRunComparisonCountsSchema,
  fingerprintDiff: z.array(FingerprintDiffBadgeSchema),
  items: z.array(TestRunComparisonRowSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
});
export type TestRunComparison = z.infer<typeof TestRunComparisonSchema>;
