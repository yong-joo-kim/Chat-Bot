import { z } from 'zod';
import { ApiErrorCode, PaginationQuerySchema, SortOrder, csvEnumArray } from './common';
import { ExampleConflictSchema } from './dialogue';

/**
 * No.15 학습현황(관리자 보조 재학습) 도메인 스키마.
 * `docs/02-spec/stats-learning-설계.md` §4.3, ADR-0018/0019 근거.
 * ⚠ `UnansweredQuestionSchema`/`ResolveUnansweredQuestionSchema`는 Phase 0 초안 상태로
 * `stats.ts`에 있었으나 소비자가 0이라 이 파일로 이동·재정비했다(ADR-0019).
 */

export const UnansweredQuestionStatus = z.enum(['PENDING', 'RESOLVED', 'IGNORED']);
export type UnansweredQuestionStatus = z.infer<typeof UnansweredQuestionStatus>;

export const UNANSWERED_STATUS_LABELS: Record<UnansweredQuestionStatus, string> = {
  PENDING: '대기',
  RESOLVED: '반영 완료',
  IGNORED: '무시됨',
};

/** 수집 소스(J-2 §1.5). 이번 Phase는 'UNANSWERED' 1종이며 No.44가 'NEGATIVE_FEEDBACK'을 더한다. */
export const UnansweredSource = z.enum(['UNANSWERED']);
export type UnansweredSource = z.infer<typeof UnansweredSource>;

/** 학습현황 그룹 한도값(전부 환경변수로 조정 가능한 서버 기본값의 클라이언트 표기용 사본). */
export const LEARNING_LIMITS = {
  bulkMaxItems: 50,
  maxPendingPerChatbot: 5000,
  maxQuestionLength: 200,
  variantsMax: 5,
  suggestionsMax: 3,
  suggestMinScore: 0.25,
  trendDays: 14,
};

export const IntentSuggestionSchema = z.object({
  intentId: z.string().uuid(),
  intentName: z.string(),
  score: z.number().min(0).max(1),
  matchedExample: z.string(),
});
export type IntentSuggestion = z.infer<typeof IntentSuggestionSchema>;

export const UnansweredQuestionListItemSchema = z.object({
  id: z.string().uuid(),
  chatbotId: z.string().uuid(),
  /** 표시용 원문 — 최초 수집 1건(마스킹 후 값, FR-15-4, ADR-0013). */
  questionText: z.string(),
  occurredCount: z.number().int().positive(),
  status: UnansweredQuestionStatus,
  /** = `createdAt`(최초 발생). */
  firstOccurredAt: z.coerce.date(),
  lastOccurredAt: z.coerce.date(),
  /** 반영/무시 이후 재발생 횟수(FR-15-5). 0이면 배지를 렌더하지 않는다. */
  recurredCount: z.number().int().nonnegative(),
  recurredAfterAt: z.coerce.date().optional(),
  channelType: z.string().optional(),
  resolvedIntentId: z.string().uuid().optional(),
  resolvedIntentName: z.string().optional(),
  resolvedAt: z.coerce.date().optional(),
  /** 조회 시점 계산(J-5). 저장되지 않는다. */
  suggestions: z.array(IntentSuggestionSchema).default([]),
});
export type UnansweredQuestionListItem = z.infer<typeof UnansweredQuestionListItemSchema>;

export const UnansweredQuestionListQuerySchema = PaginationQuerySchema.extend({
  status: csvEnumArray(UnansweredQuestionStatus).default(['PENDING']),
  /** `lastOccurredAt` 기준 필터(FR-15-10). */
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  q: z.string().max(200).optional(),
  recurredOnly: z.coerce.boolean().default(false),
  sort: z.enum(['occurredCount', 'lastOccurredAt', 'createdAt']).default('occurredCount'),
  order: SortOrder.default('desc'),
});
export type UnansweredQuestionListQuery = z.infer<typeof UnansweredQuestionListQuerySchema>;

/** 탭 배지·대시보드 위젯 전용 경량 응답(FR-15-14) — 목록 전체를 불러오지 않는다. */
export const UnansweredQuestionSummarySchema = z.object({
  pendingCount: z.number().int().nonnegative(),
  /** 챗봇당 `PENDING` 상한(FR-15-8)에 도달했는지. 도달 시 화면이 배너를 표시한다. */
  limitReached: z.boolean(),
});
export type UnansweredQuestionSummary = z.infer<typeof UnansweredQuestionSummarySchema>;

export const UnansweredQuestionDetailSchema = UnansweredQuestionListItemSchema.extend({
  /** 최근 표기 변형 샘플 최대 5건(FR-15-4). */
  variants: z.array(z.string()),
  /** 발생 추이(DD-67, `variants[]` 기반 파생). */
  trend: z.array(z.object({ dayBucket: z.string(), count: z.number().int().nonnegative() })),
  /** 변형이 5종을 넘으면 일부 발생이 추이 집계에서 빠질 수 있다(DD-67). */
  trendApproximated: z.boolean(),
});
export type UnansweredQuestionDetail = z.infer<typeof UnansweredQuestionDetailSchema>;

/**
 * 반영 요청(FR-15-20). `intentId`/`intentName` 중 하나는 반드시 있어야 한다(`intentId` 우선).
 * `exampleText` 미지정 시 `questionText`(마스킹된 원문)를 그대로 예문으로 쓴다(FR-15-22).
 */
export const ResolveUnansweredQuestionSchema = z
  .object({
    intentId: z.string().uuid().optional(),
    intentName: z.string().trim().min(1).max(100).optional(),
    exampleText: z.string().trim().min(1).max(200).optional(),
  })
  .refine((v) => Boolean(v.intentId || v.intentName), {
    message: '기존 의도 ID 또는 새 의도명 중 하나를 지정해 주세요.',
    path: ['intentId'],
  });
export type ResolveUnansweredQuestionDto = z.infer<typeof ResolveUnansweredQuestionSchema>;

export const ResolveResultSchema = z.object({
  questionId: z.string().uuid(),
  intentId: z.string().uuid(),
  intentName: z.string(),
  /** `true`면 새 의도가 생성됐다(AC-15B-6). 화면이 저장 전에 이 판정을 먼저 보여준다(F-9). */
  created: z.boolean(),
  exampleCount: z.number().int().nonnegative(),
  /** 0이면 반영 대상 의도를 쓰는 노드가 없다 — 화면이 지속 표시 경고를 띄운다(FR-15-25). */
  linkedNodeCount: z.number().int().nonnegative(),
  conflicts: z.array(ExampleConflictSchema).default([]),
  /**
   * ★ DD-55 인계 계약 K-4 — `LearningApplyService.applyLearning()`의 반환값을 그대로 전달한다.
   * `z.literal(true)`로 고정하지 않는다 — No.16 전환 시 이 값이 `false`가 되고 화면 문구가
   * 자동으로 바뀌는 것이 인계 계약의 핵심이다.
   */
  appliedImmediately: z.boolean(),
});
export type ResolveResult = z.infer<typeof ResolveResultSchema>;

const BulkResolveItemSchema = z
  .object({
    id: z.string().uuid(),
    intentId: z.string().uuid().optional(),
    intentName: z.string().trim().min(1).max(100).optional(),
    exampleText: z.string().trim().min(1).max(200).optional(),
  })
  .refine((v) => Boolean(v.intentId || v.intentName), {
    message: '기존 의도 ID 또는 새 의도명 중 하나를 지정해 주세요.',
    path: ['intentId'],
  });
export type BulkResolveItem = z.infer<typeof BulkResolveItemSchema>;

/**
 * ⚠ 여기의 `.max()`는 명백히 과도한 페이로드를 막는 안전판(500)일 뿐이다. 업무 규칙상의
 * 상한(50건, FR-15-30)은 서비스 계층이 검사해 전용 오류코드 `BULK_SIZE_EXCEEDED`로 응답한다
 * (AC-15B-13) — zod 단계의 일반 `VALIDATION_FAILED`로는 그 코드를 낼 수 없기 때문이다.
 */
export const BulkResolveSchema = z.object({
  items: z.array(BulkResolveItemSchema).min(1).max(500),
});
export type BulkResolveDto = z.infer<typeof BulkResolveSchema>;

export const BulkIgnoreSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(500),
});
export type BulkIgnoreDto = z.infer<typeof BulkIgnoreSchema>;

const BulkFailureSchema = z.object({
  id: z.string().uuid(),
  code: ApiErrorCode,
  message: z.string(),
});
export type BulkFailure = z.infer<typeof BulkFailureSchema>;

export const BulkResultSchema = z.object({
  succeeded: z.number().int().nonnegative(),
  results: z.array(ResolveResultSchema),
  failed: z.array(BulkFailureSchema),
});
export type BulkResult = z.infer<typeof BulkResultSchema>;
