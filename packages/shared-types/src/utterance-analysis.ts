import { z } from 'zod';
import { ApiErrorCode, PaginationQuerySchema, csvEnumArray, queryBoolean } from './common';
import { AutoSnapshotOutcomeSchema } from './version';

/**
 * 발화 묶음 분석(No.21 딥러닝 군집분석) API 계약 — `docs/02-spec/deep-clustering-설계.md` §11, ADR-0047.
 *
 * 이 파일의 스키마는 관리자 콘솔 전용이다(`@Public()` 0 — 공개 대화 경로·위젯 계약은 불변).
 * 문장 원문은 어디에도 없다 — 발화 텍스트는 금지어 → PII 마스킹을 거친 마스킹본만 응답에 실린다.
 * 화면 용어는 "묶음"이며 "토픽"·"군집"·"임베딩" 같은 기술 용어는 화면 문구에 쓰지 않는다(DC-15).
 */

export const UTTERANCE_ANALYSIS_LIMITS = {
  targetClusterCount: { min: 2, max: 50, default: 10 },
  minClusterSize: { min: 2, max: 100, default: 5 },
  keywordCount: { min: 1, max: 20, default: 10 },
  applyMaxUtterances: 50,
  utterancePageSizeMax: 100,
  customNameMax: 40,
  /** 기존 의도 이름 규칙(`IntentSchema.name`)과 같게 — 구현은 이 값을 그대로 쓴다. */
  newIntentNameMax: 100,
  /** 기존 의도 예문 규칙(`IntentExampleSchema` — FR-6-6)과 같게. */
  exampleMaxChars: 200,
} as const;

export const UtteranceAnalysisStatus = z.enum(['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED']);
export type UtteranceAnalysisStatus = z.infer<typeof UtteranceAnalysisStatus>;

export const UtteranceAnalysisStage = z.enum(['EMBEDDING', 'CLUSTERING', 'KEYWORDS', 'PROBING', 'NAMING', 'SAVING']);
export type UtteranceAnalysisStage = z.infer<typeof UtteranceAnalysisStage>;

export const ProbeTarget = z.enum(['SERVING', 'DRAFT']);
export type ProbeTarget = z.infer<typeof ProbeTarget>;

export const UtteranceExclusionReason = z.enum(['EMPTY', 'TOO_LONG', 'TOO_SHORT', 'NO_CONTENT']);
export type UtteranceExclusionReason = z.infer<typeof UtteranceExclusionReason>;

export const UtteranceAnalysisNotice = z.enum(['TARGET_REDUCED', 'FEWER_THAN_TARGET', 'NO_CLUSTER', 'HEURISTIC_ANALYZER']);
export type UtteranceAnalysisNotice = z.infer<typeof UtteranceAnalysisNotice>;

/** 분석 종결 상태(삭제·파기 대상). */
export const UTTERANCE_ANALYSIS_TERMINAL_STATUSES = ['SUCCEEDED', 'FAILED', 'CANCELLED'] as const;

/* ── 조건 ── */

export const UtteranceAnalysisConditionsSchema = z
  .object({
    targetClusterCount: z.number().int().min(2).max(50).default(10),
    minClusterSize: z.number().int().min(2).max(100).default(5),
    keywordCount: z.number().int().min(1).max(20).default(10),
    nounsOnly: z.boolean().default(true),
    probe: z
      .object({
        enabled: z.boolean().default(true),
        target: ProbeTarget.default('SERVING'),
        /** null = 챗봇 답변 설정의 acceptThreshold를 따른다. */
        scoreThreshold: z.number().min(0).max(1).nullable().default(null),
      })
      .strict()
      .default({}),
    nameSuggest: z.boolean().default(false),
  })
  .strict();
export type UtteranceAnalysisConditions = z.infer<typeof UtteranceAnalysisConditionsSchema>;

/* ── 건수 · 미리보기 ── */

export const UtteranceAnalysisCountsSchema = z.object({
  totalRows: z.number().int(),
  validCount: z.number().int(),
  mergedCount: z.number().int(),
  excluded: z.record(UtteranceExclusionReason, z.number().int()),
  maskedRowCount: z.number().int(),
  bannedRowCount: z.number().int(),
  invalidCountRows: z.number().int(),
  occurrenceTotal: z.number().int(),
});
export type UtteranceAnalysisCounts = z.infer<typeof UtteranceAnalysisCountsSchema>;

export const UtterancePreviewQuerySchema = z.object({
  minClusterSize: z.coerce.number().int().min(2).max(100).optional(),
});
export type UtterancePreviewQuery = z.infer<typeof UtterancePreviewQuerySchema>;

export const UtterancePreviewResponseSchema = UtteranceAnalysisCountsSchema.extend({
  fileKind: z.enum(['XLSX', 'CSV']),
  canAnalyze: z.boolean(),
  reasonIfNot: z.literal('TOO_FEW').optional(),
  /** [선택 필드 — 화면 설계서 §12-6] `canAnalyze` 판정 기준(= 최소 발화 수 × 2). 화면이 규칙을 복제하지 않게 한다. */
  minValidCount: z.number().int().optional(),
});
export type UtterancePreviewResponse = z.infer<typeof UtterancePreviewResponseSchema>;

/* ── 목록 ── */

export const UtteranceAnalysisListItemSchema = z.object({
  id: z.string().uuid(),
  status: UtteranceAnalysisStatus,
  stage: UtteranceAnalysisStage.nullable(),
  progress: z.number().int(),
  fileName: z.string(),
  requestedByEmail: z.string().nullable(),
  createdAt: z.coerce.date(),
  finishedAt: z.coerce.date().nullable(),
  validCount: z.number().int(),
  clusterCount: z.number().int().nullable(),
  candidateCount: z.number().int().nullable(),
  appliedCount: z.number().int(),
  expiresAt: z.coerce.date(),
  /** [선택 필드 — 화면 설계서 §12-3] 실패 사유 코드(문장 0). 목록 행에 사유를 보이려는 화면용. */
  failureReason: z.string().nullable().optional(),
});
export type UtteranceAnalysisListItem = z.infer<typeof UtteranceAnalysisListItemSchema>;

export const UtteranceAnalysisListQuerySchema = PaginationQuerySchema.extend({
  status: csvEnumArray(UtteranceAnalysisStatus),
});
export type UtteranceAnalysisListQuery = z.infer<typeof UtteranceAnalysisListQuerySchema>;

/* ── 상세 ── */

export const UtteranceClusterKeywordSchema = z.object({
  term: z.string(),
  score: z.number(),
  count: z.number().int(),
});
export type UtteranceClusterKeyword = z.infer<typeof UtteranceClusterKeywordSchema>;

export const UtteranceClusterSchema = z.object({
  id: z.string().uuid(),
  ordinal: z.number().int(),
  unassigned: z.boolean(),
  /** customName > autoName(AI 제안은 이름을 대체하지 않는다 — §6.3). */
  displayName: z.string(),
  autoName: z.string(),
  customName: z.string().nullable(),
  suggestedName: z.string().nullable(),
  keywords: z.array(UtteranceClusterKeywordSchema),
  utteranceCount: z.number().int(),
  occurrenceSum: z.number().int(),
  candidateCount: z.number().int(),
  candidateRatio: z.number().nullable(),
  appliedCount: z.number().int(),
  representatives: z.array(z.object({ utteranceId: z.string(), text: z.string() })).max(3),
});
export type UtteranceCluster = z.infer<typeof UtteranceClusterSchema>;

export const UtteranceAnalysisDetailSchema = UtteranceAnalysisListItemSchema.extend({
  fileKind: z.enum(['XLSX', 'CSV']),
  conditions: UtteranceAnalysisConditionsSchema,
  counts: UtteranceAnalysisCountsSchema,
  notices: z.array(UtteranceAnalysisNotice),
  failureReason: z.string().nullable(),
  embeddingModelId: z.string().nullable(),
  /** 현재 임베딩 modelId와 다름(EX-DC-12 · NFR-DCM3). */
  staleModel: z.boolean(),
  algorithmVersion: z.string(),
  analyzerId: z.string().nullable(),
  probe: z.object({
    status: z.enum(['OFF', 'DONE', 'FAILED']),
    failureReason: z.string().nullable(),
    targetKind: z.enum(['LIVE', 'PROD']).nullable(),
    versionNo: z.number().int().nullable(),
    threshold: z.number().nullable(),
    wouldUseRagCount: z.number().int(),
  }),
  nameSuggest: z.object({
    status: z.enum(['OFF', 'DONE', 'PARTIAL', 'FAILED']),
    failureReason: z.string().nullable(),
  }),
  unassignedCount: z.number().int().nullable(),
  /** ≤ 51행 — 상세에 동봉한다. 처리 중이면 `[]`. */
  clusters: z.array(UtteranceClusterSchema),
  startedAt: z.coerce.date().nullable(),
  durationMs: z.number().int().nullable(),
});
export type UtteranceAnalysisDetail = z.infer<typeof UtteranceAnalysisDetailSchema>;

export const StartUtteranceAnalysisResponseSchema = z.object({
  analysisId: z.string().uuid(),
  status: z.literal('QUEUED'),
});
export type StartUtteranceAnalysisResponse = z.infer<typeof StartUtteranceAnalysisResponseSchema>;

/* ── 발화 목록 ── */

export const AnalyzedUtteranceSchema = z.object({
  id: z.string().uuid(),
  seq: z.number().int(),
  clusterId: z.string().uuid(),
  clusterOrdinal: z.number().int(),
  clusterDisplayName: z.string(),
  /** 금지어·PII 마스킹 완료본. */
  text: z.string(),
  occurrenceCount: z.number().int(),
  sourceMemo: z.string().nullable(),
  hasBannedWord: z.boolean(),
  hasMaskToken: z.boolean(),
  /** 대조를 끈 분석 = null. */
  probe: z
    .object({
      answered: z.boolean(),
      matchKind: z.enum(['INTENT', 'FAQ', 'NODE']).nullable(),
      matchId: z.string().nullable(),
      matchName: z.string().nullable(),
      band: z.string().nullable(),
      score: z.number().nullable(),
      wouldUseRag: z.boolean(),
    })
    .nullable(),
  learningCandidate: z.boolean(),
  suggestedIntents: z.array(z.object({ intentId: z.string(), name: z.string(), score: z.number(), source: z.enum(['SEMANTIC', 'LEXICAL']) })),
  applied: z.object({ intentId: z.string(), intentName: z.string(), byEmail: z.string().nullable(), at: z.coerce.date() }).nullable(),
});
export type AnalyzedUtterance = z.infer<typeof AnalyzedUtteranceSchema>;

export const AnalyzedUtteranceListQuerySchema = PaginationQuerySchema.extend({
  clusterId: z.string().uuid().optional(),
  // z.coerce.boolean 금지(CLAUDE.md) — "false"가 true가 된다.
  candidateOnly: queryBoolean(),
  unappliedOnly: queryBoolean(),
  /** 마스킹본 부분 일치(서버 검색 — 5,000행 전송 0, NFR-DCP3). */
  q: z.string().trim().min(1).max(50).optional(),
});
export type AnalyzedUtteranceListQuery = z.infer<typeof AnalyzedUtteranceListQuerySchema>;

/* ── 묶음 이름 수정 ── */

export const ClusterRenameRequestSchema = z
  .object({
    /** null = 자동 이름으로 되돌림. */
    customName: z.string().trim().min(1).max(40).nullable(),
  })
  .strict();
export type ClusterRenameRequest = z.infer<typeof ClusterRenameRequestSchema>;

/* ── 예문 반영 ── */

export const UtteranceApplyTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('EXISTING'), intentId: z.string().uuid() }).strict(),
  z.object({ kind: z.literal('NEW'), intentName: z.string().trim().min(1).max(100) }).strict(),
]);
export type UtteranceApplyTarget = z.infer<typeof UtteranceApplyTargetSchema>;

export const UtteranceApplyRequestSchema = z
  .object({
    utteranceIds: z.array(z.string().uuid()).min(1).max(50),
    target: UtteranceApplyTargetSchema,
  })
  .strict();
export type UtteranceApplyRequest = z.infer<typeof UtteranceApplyRequestSchema>;

export const UtteranceApplyExcludeReason = z.enum([
  'NOT_FOUND',
  'ALREADY_APPLIED',
  'BANNED_WORD',
  'TOO_LONG',
  'DUPLICATE_IN_TARGET',
  'DUPLICATE_IN_OTHER_INTENT',
  'TARGET_LIMIT',
]);
export type UtteranceApplyExcludeReason = z.infer<typeof UtteranceApplyExcludeReason>;

const UtteranceApplyExcludedSchema = z.object({
  utteranceId: z.string(),
  reason: UtteranceApplyExcludeReason,
  conflictIntentName: z.string().optional(),
});

export const UtteranceApplyPreviewResponseSchema = z.object({
  target: z.object({
    resolution: z.enum(['EXISTING', 'NEW', 'EXISTING_BY_NAME']),
    intentId: z.string().nullable(),
    intentName: z.string(),
  }),
  included: z.array(z.object({ utteranceId: z.string(), text: z.string(), warnings: z.array(z.enum(['MASK_TOKEN'])) })),
  excluded: z.array(UtteranceApplyExcludedSchema),
  resultingExampleCount: z.number().int(),
  /** 새 의도 = null · 0이면 "이 의도를 쓰는 대화상자가 없습니다"(No.15 규칙). */
  linkedNodeCount: z.number().int().nullable(),
  /** 환경 모드 켜짐 — 초안에만 반영(FR-DC7-6). */
  draftOnly: z.boolean(),
});
export type UtteranceApplyPreviewResponse = z.infer<typeof UtteranceApplyPreviewResponseSchema>;

export const UtteranceApplyResponseSchema = z.object({
  succeeded: z.number().int(),
  intentId: z.string().nullable(),
  intentName: z.string(),
  created: z.boolean(),
  excluded: z.array(UtteranceApplyExcludedSchema),
  failed: z.array(z.object({ utteranceId: z.string(), code: ApiErrorCode, message: z.string() })),
  appliedImmediately: z.boolean(),
  linkedNodeCount: z.number().int(),
  draftOnly: z.boolean(),
  /** 기존 증강 승인 응답과 같은 형식. */
  autoSnapshot: AutoSnapshotOutcomeSchema.optional(),
});
export type UtteranceApplyResponse = z.infer<typeof UtteranceApplyResponseSchema>;

/* ── 기능 상태(capability) ── */

export const UtteranceAnalysisCapabilitySchema = z.object({
  embeddingAvailable: z.boolean(),
  /** 설정 켬 ∧ AUGMENTATION_LOCAL_BASE_URL 있음(네트워크 확인 없음). */
  nameSuggestAvailable: z.boolean(),
  busy: z.object({ server: z.boolean(), chatbot: z.boolean() }),
  stored: z.object({ count: z.number().int(), max: z.number().int() }),
  limits: z.object({ maxFileBytes: z.number().int(), maxRows: z.number().int(), maxChars: z.number().int() }),
  retentionDays: z.number().int(),
  /** 대조 대상 선택지("운영 중 답변"/"초안") 표시 판단. */
  envModeEnabled: z.boolean(),
});
export type UtteranceAnalysisCapability = z.infer<typeof UtteranceAnalysisCapabilitySchema>;

/** 양식 받기 쿼리(`GET …/template?format=xlsx|csv`). */
export const UtteranceTemplateQuerySchema = z.object({
  format: z.enum(['xlsx', 'csv']).default('xlsx'),
});
export type UtteranceTemplateQuery = z.infer<typeof UtteranceTemplateQuerySchema>;

/** 양식 머리글 — 열 순서 고정(설계서 §7.1). */
export const UTTERANCE_TEMPLATE_HEADERS = ['발화', '발생 횟수', '출처 메모'] as const;
