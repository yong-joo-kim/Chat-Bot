import { z } from 'zod';
import { ApiErrorCode, PaginationQuerySchema, SortOrder, csvEnumArray, queryBoolean } from './common';
import { ExampleConflictSchema } from './dialogue';
import { AutoSnapshotOutcomeSchema } from './version';

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
  /**
   * [신규 2026-09-22 학습 고도화] 이 추천이 어디서 나왔는지(FR-L2-28). 'CLASSIFIER'(경량 분류기
   * 확률) | 'LEXICAL'(기존 문자 bigram 자카드). 선택 필드 — 하위호환(ADR-0027 §2).
   */
  source: z.enum(['CLASSIFIER', 'LEXICAL']).optional(),
  /** [신규 No.22] 추천 의도의 토픽(값 없음 = 공통) — 콘솔이 토픽 목록으로 이름·활성 여부를 해석한다(FR-TP8-6). */
  topicId: z.string().uuid().optional(),
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
  recurredOnly: queryBoolean().default(false),
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
  /** [신규 2026-09-23 No.25] 일괄 반영 직전 자동 스냅샷 결과(BEFORE_LEARNING_BULK_APPLY). 선택 필드. */
  autoSnapshot: AutoSnapshotOutcomeSchema.optional(),
});
export type BulkResult = z.infer<typeof BulkResultSchema>;

/* ==================================================================================================
 * 학습 고도화(No.16 예문 증강 · No.23 미응답 요소분해 + 경량 분류기) — 2026-09-22
 * `docs/02-spec/learning-augmentation-설계.md` §8, ADR-0025/0026/0027/0028 근거. append 배치(ADR-0003 §9).
 * ================================================================================================== */

/* ---------------------------------- No.16 증강(DLE) ---------------------------------- */

export const AugmentationProviderIdSchema = z.enum(['rule', 'gemini', 'local', 'mock']);
export type AugmentationProviderId = z.infer<typeof AugmentationProviderIdSchema>;

export const AugmentationSuggestionStatus = z.enum(['PENDING', 'ACCEPTED', 'REJECTED']);
export type AugmentationSuggestionStatus = z.infer<typeof AugmentationSuggestionStatus>;

/** 검증 5종 탈락 사유(설계서 §10.3). `AugmentationRunResultSchema.rejected`의 키 유니온이다. */
export const AugmentationRejectReasonSchema = z.enum([
  'SEMANTIC_DRIFT',
  'NEAR_DUPLICATE',
  'DUPLICATE_OF_EXISTING',
  'BANNED_WORD',
  'INVALID_FORMAT',
]);
export type AugmentationRejectReason = z.infer<typeof AugmentationRejectReasonSchema>;

export const AugmentationDegradeReasonSchema = z.enum(['API_KEY_MISSING', 'BASE_URL_MISSING', 'UNHEALTHY']);
export type AugmentationDegradeReason = z.infer<typeof AugmentationDegradeReasonSchema>;

/** `GET .../augmentations/capability`(FR-L1 §4.3) — "조용한 저하"를 만들지 않기 위한 공개 판정. */
export const AugmentationCapabilitySchema = z.object({
  providerId: AugmentationProviderIdSchema,
  configuredProviderId: AugmentationProviderIdSchema,
  degraded: z.boolean(),
  degradeReason: AugmentationDegradeReasonSchema.optional(),
  /** false면 검증(①②③)을 수행할 수 없어 증강 요청이 503으로 거부된다(DD-93). */
  embeddingReady: z.boolean(),
  requiresNetwork: z.boolean(),
});
export type AugmentationCapability = z.infer<typeof AugmentationCapabilitySchema>;

export const AugmentationConflictSchema = z.object({
  intentId: z.string().uuid(),
  intentName: z.string(),
  score: z.number(),
});

export const AugmentationSuggestionSchema = z.object({
  id: z.string().uuid(),
  text: z.string(),
  similarityToSeed: z.number(),
  conflictIntent: AugmentationConflictSchema.optional(),
  status: AugmentationSuggestionStatus,
  providerId: AugmentationProviderIdSchema,
  createdAt: z.coerce.date(),
  /** modelId 불일치·TTL 경과·대상 의도 부재 중 하나라도 해당하면 true(조회 시 계산, FR-L1-23). */
  stale: z.boolean(),
});
export type AugmentationSuggestion = z.infer<typeof AugmentationSuggestionSchema>;

/** 검증 요약(FR-L1-14) — "생성 12건 중 7건 통과(의미 이탈 3·중복 2)"를 화면이 그릴 수 있게 한다. */
export const AugmentationRunResultSchema = z.object({
  generated: z.number().int().nonnegative(),
  accepted: z.number().int().nonnegative(),
  rejected: z.record(AugmentationRejectReasonSchema, z.number().int().nonnegative()),
  providerId: AugmentationProviderIdSchema,
  degraded: z.boolean(),
  degradeReason: AugmentationDegradeReasonSchema.optional(),
});
export type AugmentationRunResult = z.infer<typeof AugmentationRunResultSchema>;

/** `POST .../intents/:intentId/augmentations` 요청 본문(생성 건수는 선택 — 미지정 시 서버 기본값). */
export const AugmentationGenerateRequestSchema = z.object({
  count: z.coerce.number().int().min(1).max(50).optional(),
});
export type AugmentationGenerateRequestDto = z.infer<typeof AugmentationGenerateRequestSchema>;

export const AugmentationGenerateResponseSchema = z.object({
  jobId: z.string().uuid(),
  status: z.literal('QUEUED'),
});
export type AugmentationGenerateResponse = z.infer<typeof AugmentationGenerateResponseSchema>;

export const AugmentationListQuerySchema = PaginationQuerySchema.extend({
  status: csvEnumArray(AugmentationSuggestionStatus).default(['PENDING']),
});
export type AugmentationListQuery = z.infer<typeof AugmentationListQuerySchema>;

export const AugmentationListResponseSchema = z.object({
  items: z.array(AugmentationSuggestionSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  /** 이 의도의 가장 최근 생성 작업 검증 요약(없으면 undefined — 생성 이력 없음). */
  runResult: AugmentationRunResultSchema.optional(),
  capability: AugmentationCapabilitySchema,
  /** 예문이 이미 충분해 증강 이득이 작다는 안내(FR-L1-2). 요청 자체는 막지 않는다. */
  sufficientExamples: z.boolean(),
});
export type AugmentationListResponse = z.infer<typeof AugmentationListResponseSchema>;

/** ★ 자산 승격 유일 경로의 요청(FR-L1-19). "전체 승인" 전용 API는 없다 — id 배열을 채워 보낸다. */
export const AugmentationAcceptRequestSchema = z.object({
  suggestionIds: z.array(z.string().uuid()).min(1).max(50),
});
export type AugmentationAcceptRequestDto = z.infer<typeof AugmentationAcceptRequestSchema>;

const AugmentationAcceptFailureSchema = z.object({
  id: z.string().uuid(),
  code: ApiErrorCode,
  message: z.string(),
});
export type AugmentationAcceptFailure = z.infer<typeof AugmentationAcceptFailureSchema>;

export const AugmentationAcceptResponseSchema = z.object({
  succeeded: z.number().int().nonnegative(),
  failed: z.array(AugmentationAcceptFailureSchema),
  /** ★ DD-113 — `LearningApplyService.applyLearning()`의 반환값을 그대로 전달한다(교체하지 않는다). */
  appliedImmediately: z.boolean(),
  linkedNodeCount: z.number().int().nonnegative(),
  /** [신규 2026-09-23 No.25] 승인 직전 자동 스냅샷 결과(BEFORE_AUGMENT_ACCEPT). 선택 필드. */
  autoSnapshot: AutoSnapshotOutcomeSchema.optional(),
});
export type AugmentationAcceptResponse = z.infer<typeof AugmentationAcceptResponseSchema>;

export const AugmentationRejectRequestSchema = z.object({
  suggestionIds: z.array(z.string().uuid()).min(1).max(50),
});
export type AugmentationRejectRequestDto = z.infer<typeof AugmentationRejectRequestSchema>;

export const AugmentationRejectResponseSchema = z.object({
  succeeded: z.number().int().nonnegative(),
});
export type AugmentationRejectResponse = z.infer<typeof AugmentationRejectResponseSchema>;

/* ---------------------------------- No.23 (A) 요소분해 ---------------------------------- */

export const DecompositionSpanRole = z.enum(['ENTITY_CANDIDATE', 'INTENT_SIGNAL', 'IGNORED']);
export type DecompositionSpanRole = z.infer<typeof DecompositionSpanRole>;

export const DecompositionSpanSchema = z.object({
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
  text: z.string(),
  role: DecompositionSpanRole,
  matchedKeyword: z
    .object({
      id: z.string().uuid(),
      name: z.string(),
      viaSynonym: z.boolean(),
    })
    .optional(),
});
export type DecompositionSpan = z.infer<typeof DecompositionSpanSchema>;

/** `GET .../unanswered-questions/:id/decomposition`(FR-L2-6) — 조회 시 계산, 저장하지 않는다. */
export const DecompositionResponseSchema = z.object({
  spans: z.array(DecompositionSpanSchema),
  /** 'heuristic@0' | 'garu-ko@x.y.z' 등 — 화면이 "정밀 분석 사용 중/기본 분해"를 구분한다(ADR-0028). */
  analyzerId: z.string(),
  version: z.literal(1),
});
export type DecompositionResponse = z.infer<typeof DecompositionResponseSchema>;

const DecomposedEntityActionSchema = z
  .object({
    action: z.enum(['ADD_SYNONYM', 'CREATE']),
    keywordId: z.string().uuid().optional(),
    name: z.string().trim().min(1).max(100).optional(),
    synonym: z.string().trim().min(1).max(100),
  })
  .refine((v) => v.action !== 'ADD_SYNONYM' || Boolean(v.keywordId), {
    message: 'ADD_SYNONYM은 대상 키워드(keywordId)가 필요합니다.',
    path: ['keywordId'],
  })
  .refine((v) => v.action !== 'CREATE' || Boolean(v.name), {
    message: 'CREATE는 새 키워드 이름(name)이 필요합니다.',
    path: ['name'],
  });
export type DecomposedEntityAction = z.infer<typeof DecomposedEntityActionSchema>;

/** `POST .../unanswered-questions/:id/resolve-decomposed`(FR-L2-9) — 의도 + 엔티티 동시 반영. */
export const DecomposedResolveRequestSchema = z
  .object({
    intentId: z.string().uuid().optional(),
    intentName: z.string().trim().min(1).max(100).optional(),
    exampleText: z.string().trim().min(1).max(200).optional(),
    /** 관리자가 수정한 분해 결과(경계·역할). 서버가 원문 범위·겹침을 재검증한다(FR-L2-8). */
    spans: z.array(DecompositionSpanSchema).optional(),
    entities: z.array(DecomposedEntityActionSchema).max(10).default([]),
  })
  .refine((v) => Boolean(v.intentId || v.intentName), {
    message: '기존 의도 ID 또는 새 의도명 중 하나를 지정해 주세요.',
    path: ['intentId'],
  });
export type DecomposedResolveRequestDto = z.infer<typeof DecomposedResolveRequestSchema>;

export const DecomposedResolveResultSchema = ResolveResultSchema.extend({
  /** 이번 요청으로 등록/갱신된 키워드 수. */
  keywordCount: z.number().int().nonnegative(),
  /** 0이면 반영 대상 키워드를 쓰는 노드가 없다 — 화면이 지속 경고 + 노드 편집 링크를 제시한다(FR-L2-12). */
  keywordLinkedNodeCount: z.number().int().nonnegative(),
  entityFailed: z.array(AugmentationAcceptFailureSchema).default([]),
});
export type DecomposedResolveResult = z.infer<typeof DecomposedResolveResultSchema>;

/* ---------------------------------- No.23 (B) 경량 분류기 ---------------------------------- */

export const IntentClassifierState = z.enum(['NONE', 'TRAINING', 'READY', 'FAILED']);
export type IntentClassifierState = z.infer<typeof IntentClassifierState>;

export const IntentClassifierStaleReason = z.enum(['MODEL_CHANGED', 'INTENTS_DRIFTED', 'EXAMPLES_DRIFTED']);
export type IntentClassifierStaleReason = z.infer<typeof IntentClassifierStaleReason>;

/** `GET .../intent-classifier/status`(FR-L2-23) — 5상태 배지 + stale 사유. */
export const IntentClassifierStatusSchema = z.object({
  state: IntentClassifierState,
  modelId: z.string().optional(),
  trainedAt: z.coerce.date().optional(),
  classCount: z.number().int().nonnegative(),
  sampleCount: z.number().int().nonnegative(),
  /** 홀드아웃 샘플 50건 미만이면 undefined("측정 안 됨"). */
  accuracy: z.number().min(0).max(1).optional(),
  stale: z.boolean(),
  staleReasons: z.array(IntentClassifierStaleReason).default([]),
});
export type IntentClassifierStatus = z.infer<typeof IntentClassifierStatusSchema>;

export const IntentClassifierTrainResponseSchema = z.object({
  jobId: z.string().uuid(),
  status: z.literal('QUEUED'),
});
export type IntentClassifierTrainResponse = z.infer<typeof IntentClassifierTrainResponseSchema>;

/* ---------------------------------- 비동기 작업 상태(TrainingJob) ---------------------------------- */

export const TrainingJobKind = z.enum(['AUGMENT', 'CLASSIFIER_TRAIN']);
export type TrainingJobKind = z.infer<typeof TrainingJobKind>;

export const TrainingJobStatus = z.enum(['QUEUED', 'RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED']);
export type TrainingJobStatus = z.infer<typeof TrainingJobStatus>;

/** `GET /chatbots/:chatbotId/training-jobs/:id`(폴링 전용, 교차 챗봇 조회는 404). */
export const TrainingJobSchema = z.object({
  id: z.string().uuid(),
  kind: TrainingJobKind,
  targetId: z.string().optional(),
  status: TrainingJobStatus,
  progress: z.number().int().min(0).max(100),
  /** 건수·사유 분포·소요시간만 담는다 — 문장 원문 0건(NFR-LS4). 구조는 kind에 따라 다르다. */
  resultSummary: z.record(z.string(), z.unknown()).optional(),
  failureReason: z.string().optional(),
  startedAt: z.coerce.date().optional(),
  finishedAt: z.coerce.date().optional(),
  createdAt: z.coerce.date(),
});
export type TrainingJob = z.infer<typeof TrainingJobSchema>;
