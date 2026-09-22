import { z } from 'zod';

/**
 * FAQ/의도 매칭 고도화(NLU 1단계 + RAG 2단계) 계약 — `nlu-rag-answering-설계.md` §5·§6.2·§10.1.
 * 의존 방향: `answering.ts → common.ts` 단방향. `chatbot.ts`(설정·스킨·상태로 이미 비대)는 참조하지 않는다.
 */

/* ------------------------------------------------------------------------------------------------
 * 열거형 — DD-85, FR-N1-16, FR-N2-2, §6.4
 * ---------------------------------------------------------------------------------------------- */

/** 색인 대상 4종(FR-N1-16). `EmbeddingVector.ownerType`의 값 제약 단일 소스. */
export const EmbeddingOwnerType = z.enum(['FAQ_QUESTION', 'FAQ_ALT', 'INTENT_NAME', 'INTENT_EXAMPLE']);
export type EmbeddingOwnerType = z.infer<typeof EmbeddingOwnerType>;

/** 1단계 실패 시 `FALLBACK` 노드와의 우선순위(FR-N2-2). */
export const FallbackPolicy = z.enum(['RAG_FIRST', 'NODE_FIRST']);
export type FallbackPolicy = z.infer<typeof FallbackPolicy>;

/** `RagCallLog.outcome`의 값 제약 단일 소스(§6.4). */
export const RagOutcome = z.enum(['SUCCESS', 'NO_EVIDENCE', 'UPSTREAM_ERROR', 'TIMEOUT', 'CIRCUIT_OPEN', 'RATE_LIMITED', 'SCHEMA_INVALID']);
export type RagOutcome = z.infer<typeof RagOutcome>;

/** `EmbeddingVector.status`/재색인 항목 상태(FR-N1-20). */
export const EmbeddingVectorStatus = z.enum(['READY', 'PENDING', 'FAILED']);
export type EmbeddingVectorStatus = z.infer<typeof EmbeddingVectorStatus>;

/* ------------------------------------------------------------------------------------------------
 * 임계값 기본값 — `modelId → 기본 임계값` 매핑(FR-N1-26, ADR-0021 §5). 코드 상수 1곳.
 * ml-engineer 확정값(threshold-recommendation.md): KURE-v1 기준 accept 0.90 / low 0.60 / margin 0.05.
 * ---------------------------------------------------------------------------------------------- */

export interface MatchingThresholds {
  accept: number;
  low: number;
  margin: number;
}

/** 골든셋 보정 전 잠정 기본값(모델 불명 시 폴백, ADR-0021). */
export const FALLBACK_DEFAULT_THRESHOLDS: MatchingThresholds = { accept: 0.8, low: 0.6, margin: 0.05 };

/** ml-engineer가 확정한 1차 모델의 골든셋 보정값(threshold-recommendation.md, model-comparison.md 근거). */
export const DEFAULT_THRESHOLDS_BY_MODEL: Record<string, MatchingThresholds> = {
  'nlpai-lab/KURE-v1@main|noprefix|l2': { accept: 0.9, low: 0.6, margin: 0.05 },
};

/** `modelId`에 대응하는 기본 임계값을 조회한다. 미등록 모델은 잠정 기본값으로 폴백한다(FR-N1-26). */
export function defaultThresholdsForModel(modelId: string): MatchingThresholds {
  return DEFAULT_THRESHOLDS_BY_MODEL[modelId] ?? FALLBACK_DEFAULT_THRESHOLDS;
}

/* ------------------------------------------------------------------------------------------------
 * `ChatbotAnswerSetting` — 1:1(DD-74, ADR-0021 §4). 행이 없으면 전부 기본값(두 단계 비활성).
 * ---------------------------------------------------------------------------------------------- */

export const ChatbotAnswerSettingSchema = z
  .object({
    chatbotId: z.string().uuid(),
    semanticEnabled: z.boolean(),
    acceptThreshold: z.number().min(0).max(1),
    lowThreshold: z.number().min(0).max(1),
    marginThreshold: z.number().min(0).max(0.5),
    ragEnabled: z.boolean(),
    ragCompany: z.string().max(200).nullable(),
    ragCategory: z.string().max(200).nullable(),
    ragSubcategory: z.string().max(200).nullable(),
    /** null이면 요청에 `similarity_threshold` 필드를 아예 넣지 않는다(FR-N2-8). */
    ragSimilarityThreshold: z.number().gt(0).lt(1).nullable(),
    fallbackPolicy: FallbackPolicy,
    showSources: z.boolean(),
    /** 하한 120000을 서버가 강제(FR-N2-26). */
    ragTimeoutMs: z.number().int().min(120_000).max(300_000),
    createdAt: z.coerce.date(),
    updatedAt: z.coerce.date(),
  })
  .strict();
export type ChatbotAnswerSetting = z.infer<typeof ChatbotAnswerSettingSchema>;

/**
 * 전체 교체 PUT 바디(부분 수정 아님 — 상호 제약이 많다, §10.1). `provider` 필드는 존재하지 않는다(FR-N2-6).
 * ⚠ 필드 간 상호 제약(임계값 순서·`ragEnabled⇒company`·`subcategory⇒category`)은 **여기서 검증하지
 * 않는다** — `apps/api`의 `lib/validate-thresholds.ts`가 서비스 계층에서 검증해 임계값 위반은
 * `400 INVALID_THRESHOLD`, 그 외 위반은 `400 VALIDATION_FAILED`로 **구분되는 오류 코드**를 낸다
 * (ADR-0021 §6.2). `ZodValidationPipe`가 여기서 상호 제약까지 걸러버리면 전부 `VALIDATION_FAILED`로
 * 뭉개져 AC-N1-18(정확히 `INVALID_THRESHOLD`)을 만족할 수 없다.
 */
export const UpdateAnswerSettingSchema = z.object({
  semanticEnabled: z.boolean().default(false),
  acceptThreshold: z.number().min(0).max(1).default(0.8),
  lowThreshold: z.number().min(0).max(1).default(0.6),
  marginThreshold: z.number().min(0).max(0.5).default(0.05),
  ragEnabled: z.boolean().default(false),
  ragCompany: z.string().trim().min(1).max(200).nullable().default(null),
  ragCategory: z.string().trim().min(1).max(200).nullable().default(null),
  ragSubcategory: z.string().trim().min(1).max(200).nullable().default(null),
  ragSimilarityThreshold: z.number().gt(0).lt(1).nullable().default(null),
  fallbackPolicy: FallbackPolicy.default('RAG_FIRST'),
  showSources: z.boolean().default(true),
  ragTimeoutMs: z.number().int().min(120_000).max(300_000).default(120_000),
});
export type UpdateAnswerSettingDto = z.infer<typeof UpdateAnswerSettingSchema>;

/* ------------------------------------------------------------------------------------------------
 * 임계값 미리보기 — FR-N3-5, AC-N3-9. 저장하지 않고 외부 RAG를 호출하지 않는다.
 * ---------------------------------------------------------------------------------------------- */

export const ThresholdPreviewRequestSchema = z.object({
  message: z.string().trim().min(1).max(1000),
});
export type ThresholdPreviewRequestDto = z.infer<typeof ThresholdPreviewRequestSchema>;

export const ThresholdPreviewCandidateSchema = z.object({
  kind: z.enum(['FAQ', 'INTENT']),
  id: z.string(),
  label: z.string(),
  score: z.number(),
});

export const ThresholdPreviewResponseSchema = z.object({
  band: z.enum(['CONFIRMED', 'AMBIGUOUS', 'FAILED']),
  top3: z.array(ThresholdPreviewCandidateSchema).max(3),
  /** 이 문장이 실제 대화였다면 2단계(RAG)로 넘어갔을지(FAILED이고 RAG 사용 가능일 때만 true). */
  wouldUseRag: z.boolean(),
});
export type ThresholdPreviewResponse = z.infer<typeof ThresholdPreviewResponseSchema>;

/* ------------------------------------------------------------------------------------------------
 * 색인 상태 — FR-N1-23
 * ---------------------------------------------------------------------------------------------- */

export const EmbeddingIndexStatusSchema = z.object({
  modelId: z.string().nullable(),
  dimension: z.number().int().nonnegative().nullable(),
  totalTargets: z.number().int().nonnegative(),
  indexed: z.number().int().nonnegative(),
  pending: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  staleModel: z.boolean(),
  lastIndexedAt: z.coerce.date().nullable(),
  providerHealthy: z.boolean(),
});
export type EmbeddingIndexStatus = z.infer<typeof EmbeddingIndexStatusSchema>;

/* ------------------------------------------------------------------------------------------------
 * 연결 점검 — FR-N3-6/7. `/api/rag/query`를 호출하지 않는다(AC-N3-4).
 * ---------------------------------------------------------------------------------------------- */

export const RagConnectionCheckResultSchema = z.object({
  upstreamStatus: z.enum(['OK', 'UNAVAILABLE', 'NOT_CONFIGURED']),
  vllmReady: z.boolean().nullable(),
  neo4jReady: z.boolean().nullable(),
  /** 현재 챗봇 스코프(company/category/subcategory)에 해당하는 청크 수. 다른 회사명은 노출하지 않는다(FR-N2-7). */
  scopeChunkCount: z.number().int().nonnegative().nullable(),
  checkedAt: z.coerce.date(),
});
export type RagConnectionCheckResult = z.infer<typeof RagConnectionCheckResultSchema>;
