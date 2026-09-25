import { z } from 'zod';
import { PaginationQuerySchema, csvEnumArray, queryBoolean } from './common';
import { DialogueBundleSchema } from './dialogue-engine';
import { ChatbotAnswerSettingSchema } from './answering';
import { ChatbotSnapshotProfileSchema } from './chatbot';

/**
 * 챗봇 복원 / 버전 이력관리(No.25) — `version-history-설계.md` §3, ADR-0031.
 * 의존: `version.ts → common · dialogue-engine(DialogueBundleSchema) · answering(ChatbotAnswerSettingSchema)
 * · chatbot(ChatbotSnapshotProfileSchema)`(단방향). `conversation.ts`에는 두지 않는다(위젯 번들 경계).
 */

/* ------------------------------------------------------------------------------------------------
 * 스냅샷 형식 버전 — 단일 소스(FR-H1-12)
 * ---------------------------------------------------------------------------------------------- */

export const SNAPSHOT_SCHEMA_VERSION = 1 as const;
export const MIN_RESTORABLE_SCHEMA_VERSION = 1 as const;

/* ------------------------------------------------------------------------------------------------
 * 트리거 6종 — §4.2.1
 * ---------------------------------------------------------------------------------------------- */

export const ChatbotVersionTrigger = z.enum([
  'MANUAL',
  'BEFORE_IMPORT',
  'BEFORE_BULK_DELETE',
  'BEFORE_AUGMENT_ACCEPT',
  'BEFORE_LEARNING_BULK_APPLY',
  'BEFORE_RESTORE',
]);
export type ChatbotVersionTrigger = z.infer<typeof ChatbotVersionTrigger>;

export const CHATBOT_VERSION_TRIGGER_LABELS: Record<ChatbotVersionTrigger, string> = {
  MANUAL: '수동 저장',
  BEFORE_IMPORT: '대량등록 직전(자동)',
  BEFORE_BULK_DELETE: '일괄삭제 직전(자동)',
  BEFORE_AUGMENT_ACCEPT: '증강 승인 직전(자동)',
  BEFORE_LEARNING_BULK_APPLY: '학습현황 일괄반영 직전(자동)',
  BEFORE_RESTORE: '복원 직전 백업(자동)',
};

/** 목록 필터(FR-H2-1) — MANUAL / 자동 4종 / 복원 직전 백업으로 묶는다. */
export const VersionTriggerGroup = z.enum(['MANUAL', 'AUTO', 'RESTORE_BACKUP']);
export type VersionTriggerGroup = z.infer<typeof VersionTriggerGroup>;

export const VERSION_TRIGGER_GROUPS: Record<VersionTriggerGroup, readonly ChatbotVersionTrigger[]> = {
  MANUAL: ['MANUAL'],
  AUTO: ['BEFORE_IMPORT', 'BEFORE_BULK_DELETE', 'BEFORE_AUGMENT_ACCEPT', 'BEFORE_LEARNING_BULK_APPLY'],
  RESTORE_BACKUP: ['BEFORE_RESTORE'],
};

/** 자동 스냅샷 트리거 문맥(FR-H1-9) — 문장 원문은 담지 않는다. */
export const VersionTriggerContextSchema = z.object({
  resourceType: z.enum(['INTENT', 'KEYWORD', 'FAQ']).optional(),
  targetId: z.string().uuid().optional(),
  itemCount: z.number().int().nonnegative().optional(),
  /** 운영 예약 배포(No.28) 그룹 추가 — 이 BEFORE_RESTORE 백업이 어느 예약 실행에서 생겼는지
   * (기동 시 임대 만료 회수 판정의 근거, scheduled-deploy-설계.md §7.8). 기존 행은 전부 유효(선택 필드). */
  deployScheduleId: z.string().uuid().optional(),
});
export type VersionTriggerContext = z.infer<typeof VersionTriggerContextSchema>;

/* ------------------------------------------------------------------------------------------------
 * 종류별 건수(FR-H2-1)
 * ---------------------------------------------------------------------------------------------- */

export const VersionCountsSchema = z.object({
  intents: z.number().int().nonnegative(),
  intentExamples: z.number().int().nonnegative(),
  keywords: z.number().int().nonnegative(),
  homonyms: z.number().int().nonnegative(),
  contexts: z.number().int().nonnegative(),
  dialogNodes: z.number().int().nonnegative(),
  nodeIntentLinks: z.number().int().nonnegative(),
  nodeKeywordLinks: z.number().int().nonnegative(),
  faqs: z.number().int().nonnegative(),
  /** 0 | 1 — 답변설정 행 존재 여부. */
  answerSetting: z.union([z.literal(0), z.literal(1)]),
});
export type VersionCounts = z.infer<typeof VersionCountsSchema>;

/* ------------------------------------------------------------------------------------------------
 * 자산 종류 — 차이·복원·무결성 경고가 공유하는 8종(+무결성 경고 자체는 별도 kind로 목록에 붙는다)
 * ---------------------------------------------------------------------------------------------- */

export const VersionAssetKind = z.enum(['INTENT', 'KEYWORD', 'HOMONYM', 'CONTEXT', 'NODE', 'FAQ', 'ANSWER_SETTING', 'PROFILE']);
export type VersionAssetKind = z.infer<typeof VersionAssetKind>;

export const VersionDiffSummaryKind = z.enum([...VersionAssetKind.options, 'INTEGRITY_WARNING']);
export type VersionDiffSummaryKind = z.infer<typeof VersionDiffSummaryKind>;

export const VersionChangeKind = z.enum(['ADDED', 'REMOVED', 'MODIFIED']);
export type VersionChangeKind = z.infer<typeof VersionChangeKind>;

/** 스냅샷 내부 참조 그래프 경고(FR-H1-8) — 원문을 담지 않는다(FR-0-77). */
export const VersionIntegrityWarningSchema = z.object({
  rule: z.string().max(100),
  kind: VersionAssetKind,
  id: z.string(),
  field: z.string().optional(),
  refId: z.string().optional(),
});
export type VersionIntegrityWarning = z.infer<typeof VersionIntegrityWarningSchema>;

/* ------------------------------------------------------------------------------------------------
 * 스냅샷 저장 봉투(§5.1) — 느슨한 검증만. 엄격 검증은 hydrate 후 기존 도메인 스키마로 한다(§5.5).
 * ---------------------------------------------------------------------------------------------- */

export const ChatbotSnapshotEnvelopeSchema = z.object({
  schemaVersion: z.number().int().positive(),
  capturedAt: z.coerce.date(),
  chatbotId: z.string().uuid(),
  assets: z.object({
    intents: z.array(z.unknown()),
    keywords: z.array(z.unknown()),
    homonyms: z.array(z.unknown()),
    dialogNodes: z.array(z.unknown()),
    contexts: z.array(z.unknown()),
    faqs: z.array(z.unknown()),
  }),
  answerSetting: z.unknown().nullable(),
  profile: z.unknown(),
});
export type ChatbotSnapshotEnvelope = z.infer<typeof ChatbotSnapshotEnvelopeSchema>;

/** hydrate 후 형태(§5.5) — 검증 입력. */
export interface HydratedSnapshot {
  bundle: z.infer<typeof DialogueBundleSchema>;
  answerSetting: z.infer<typeof ChatbotAnswerSettingSchema> | null;
  profile: z.infer<typeof ChatbotSnapshotProfileSchema>;
}

/* ------------------------------------------------------------------------------------------------
 * 목록 / 상세 / 현재상태
 * ---------------------------------------------------------------------------------------------- */

export const ChatbotVersionListItemSchema = z.object({
  id: z.string().uuid(),
  versionNo: z.number().int().positive(),
  trigger: ChatbotVersionTrigger,
  triggerLabel: z.string(),
  triggerContext: VersionTriggerContextSchema.nullable(),
  schemaVersion: z.number().int().positive(),
  schemaSupported: z.boolean(),
  contentHash: z.string().regex(/^[0-9a-f]{64}$/),
  counts: VersionCountsSchema,
  sizeBytes: z.number().int().nonnegative(),
  integrityWarningCount: z.number().int().nonnegative(),
  label: z.string().nullable(),
  memo: z.string().nullable(),
  pinned: z.boolean(),
  restoredFromVersionNo: z.number().int().positive().nullable(),
  createdById: z.string().uuid().nullable(),
  createdByEmail: z.string().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type ChatbotVersionListItem = z.infer<typeof ChatbotVersionListItemSchema>;

export const ChatbotVersionDetailSchema = ChatbotVersionListItemSchema.extend({
  integrityWarnings: z.array(VersionIntegrityWarningSchema),
  payloadStatus: z.enum(['OK', 'CORRUPT', 'SCHEMA_UNSUPPORTED']),
});
export type ChatbotVersionDetail = z.infer<typeof ChatbotVersionDetailSchema>;

export const ChatbotVersionListQuerySchema = PaginationQuerySchema.extend({
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  triggerGroup: csvEnumArray(VersionTriggerGroup),
  pinned: queryBoolean().optional(),
});
export type ChatbotVersionListQuery = z.infer<typeof ChatbotVersionListQuerySchema>;

export const VersionCurrentStatusSchema = z.object({
  contentHash: z.string().regex(/^[0-9a-f]{64}$/),
  counts: VersionCountsSchema,
  latestVersion: ChatbotVersionListItemSchema.nullable(),
  hasUnsavedChanges: z.boolean(),
});
export type VersionCurrentStatus = z.infer<typeof VersionCurrentStatusSchema>;

/* ------------------------------------------------------------------------------------------------
 * 수동 생성 / 라벨·메모·고정 수정
 * ---------------------------------------------------------------------------------------------- */

export const CreateChatbotVersionSchema = z.object({
  label: z.string().trim().min(1).max(50).optional(),
  memo: z.string().trim().min(1).max(500).optional(),
});
export type CreateChatbotVersionDto = z.infer<typeof CreateChatbotVersionSchema>;

export const CreateChatbotVersionResponseSchema = z.discriminatedUnion('unchanged', [
  z.object({ unchanged: z.literal(false), version: ChatbotVersionDetailSchema }),
  z.object({ unchanged: z.literal(true), latestVersionNo: z.number().int().positive(), latestVersionId: z.string().uuid() }),
]);
export type CreateChatbotVersionResponse = z.infer<typeof CreateChatbotVersionResponseSchema>;

export const UpdateChatbotVersionSchema = z
  .object({
    label: z.string().trim().min(1).max(50).nullable().optional(),
    memo: z.string().trim().min(1).max(500).nullable().optional(),
    pinned: z.boolean().optional(),
  })
  .refine((v) => v.label !== undefined || v.memo !== undefined || v.pinned !== undefined, {
    message: '변경할 값을 1개 이상 지정해 주세요.',
  });
export type UpdateChatbotVersionDto = z.infer<typeof UpdateChatbotVersionSchema>;

/* ------------------------------------------------------------------------------------------------
 * 차이(diff) — §7
 * ---------------------------------------------------------------------------------------------- */

export const VersionRefSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('CURRENT'), contentHash: z.string() }),
  z.object({ kind: z.literal('VERSION'), versionId: z.string().uuid(), versionNo: z.number().int().positive(), contentHash: z.string() }),
]);
export type VersionRef = z.infer<typeof VersionRefSchema>;

export const VersionDiffSummaryRowSchema = z.object({
  kind: VersionDiffSummaryKind,
  added: z.number().int().nonnegative(),
  removed: z.number().int().nonnegative(),
  modified: z.number().int().nonnegative(),
});
export type VersionDiffSummaryRow = z.infer<typeof VersionDiffSummaryRowSchema>;

export const VersionDiffSummarySchema = z.object({
  rows: z.array(VersionDiffSummaryRowSchema),
  totalChanged: z.number().int().nonnegative(),
  identical: z.boolean(),
});
export type VersionDiffSummary = z.infer<typeof VersionDiffSummarySchema>;

export const VersionDiffQuerySchema = PaginationQuerySchema.extend({
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  against: z.string().min(1),
  kind: VersionAssetKind.optional(),
  change: csvEnumArray(VersionChangeKind),
});
export type VersionDiffQuery = z.infer<typeof VersionDiffQuerySchema>;

export const VersionDiffListItemSchema = z.object({
  id: z.string(),
  kind: VersionAssetKind,
  change: VersionChangeKind,
  name: z.string(),
  recreated: z.object({ counterpartId: z.string() }).optional(),
  changedFields: z.array(z.string()).optional(),
});
export type VersionDiffListItem = z.infer<typeof VersionDiffListItemSchema>;

export const VersionDiffResponseSchema = z.object({
  base: VersionRefSchema,
  target: VersionRefSchema,
  summary: VersionDiffSummarySchema,
  items: z
    .object({
      items: z.array(VersionDiffListItemSchema),
      total: z.number().int().nonnegative(),
      page: z.number().int().min(1),
      pageSize: z.number().int().min(1),
    })
    .optional(),
});
export type VersionDiffResponse = z.infer<typeof VersionDiffResponseSchema>;

/** 필드 단위 차이(§7.3) — type 판별 유니온. */
export const VersionFieldDiffSchema = z.discriminatedUnion('type', [
  z.object({ field: z.string(), type: z.literal('SCALAR'), before: z.unknown(), after: z.unknown() }),
  z.object({
    field: z.string(),
    type: z.literal('VALUE_SET'),
    added: z.array(z.string()),
    removed: z.array(z.string()),
    reorderedOnly: z.boolean(),
  }),
  z.object({
    field: z.string(),
    type: z.literal('REF_SET'),
    added: z.array(z.object({ id: z.string(), name: z.string().nullable() })),
    removed: z.array(z.object({ id: z.string(), name: z.string().nullable() })),
  }),
  z.object({ field: z.string(), type: z.literal('STRUCT'), before: z.unknown(), after: z.unknown() }),
]);
export type VersionFieldDiff = z.infer<typeof VersionFieldDiffSchema>;

export const VersionDiffItemDetailSchema = z.object({
  id: z.string(),
  kind: VersionAssetKind,
  change: VersionChangeKind,
  name: z.string(),
  fields: z.array(VersionFieldDiffSchema),
});
export type VersionDiffItemDetail = z.infer<typeof VersionDiffItemDetailSchema>;

/* ------------------------------------------------------------------------------------------------
 * 내용 조회(§10.1) — 기존 도메인 스키마 재사용(원형 스키마 미지원 시 raw JSON)
 * ---------------------------------------------------------------------------------------------- */

export const VersionContentQuerySchema = PaginationQuerySchema.extend({
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  kind: VersionAssetKind,
  q: z.string().max(200).optional(),
});
export type VersionContentQuery = z.infer<typeof VersionContentQuerySchema>;

export const VersionContentPageSchema = z.object({
  kind: VersionAssetKind,
  schemaSupported: z.boolean(),
  items: z.array(z.unknown()),
  total: z.number().int().nonnegative(),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
});
export type VersionContentPage = z.infer<typeof VersionContentPageSchema>;

/* ------------------------------------------------------------------------------------------------
 * 감사 건수(§10.1)
 * ---------------------------------------------------------------------------------------------- */

export const VersionAuditCountSchema = z.object({
  versionId: z.string().uuid(),
  from: z.coerce.date(),
  to: z.coerce.date(),
  count: z.number().int().nonnegative(),
  link: z.object({
    chatbotId: z.string().uuid(),
    from: z.coerce.date(),
    to: z.coerce.date(),
    clamped: z.boolean(),
  }),
});
export type VersionAuditCount = z.infer<typeof VersionAuditCountSchema>;

/* ------------------------------------------------------------------------------------------------
 * 복원 — §8
 * ---------------------------------------------------------------------------------------------- */

export const RestoreBlockerSchema = z.discriminatedUnion('code', [
  z.object({ code: z.literal('CHATBOT_ARCHIVED') }),
  z.object({
    code: z.literal('ACTIVE_JOB'),
    jobs: z.array(
      z.object({
        source: z.enum(['TRAINING_JOB', 'TEST_RUN']),
        kind: z.string(),
        status: z.string(),
        progress: z.number().int().min(0).max(100),
      }),
    ),
  }),
  z.object({ code: z.literal('SCHEMA_UNSUPPORTED'), schemaVersion: z.number().int() }),
  z.object({
    code: z.literal('INTEGRITY_FAILED'),
    violations: z.array(VersionIntegrityWarningSchema),
    total: z.number().int().nonnegative(),
  }),
  z.object({ code: z.literal('RESTORE_IN_PROGRESS') }),
  z.object({ code: z.literal('NO_CHANGES') }),
]);
export type RestoreBlocker = z.infer<typeof RestoreBlockerSchema>;

export const RestoreWarningSchema = z.discriminatedUnion('code', [
  z.object({ code: z.literal('ACTIVE_CHATBOT') }),
  z.object({ code: z.literal('TARGET_INTEGRITY_WARNINGS'), count: z.number().int().nonnegative() }),
  z.object({ code: z.literal('BANNED_WORD_MATCHES'), count: z.number().int().nonnegative() }),
  z.object({ code: z.literal('PENDING_SUGGESTIONS_ORPHANED'), count: z.number().int().nonnegative() }),
  z.object({ code: z.literal('ACCEPTED_SUGGESTIONS_NOT_RESUGGESTED'), count: z.number().int().nonnegative() }),
  z.object({ code: z.literal('TEST_CASES_UNRESOLVED'), count: z.number().int().nonnegative() }),
  z.object({ code: z.literal('CLASSIFIER_WILL_BE_DELETED') }),
  z.object({ code: z.literal('PROFILE_WILL_CHANGE'), fields: z.array(z.string()) }),
  z.object({ code: z.literal('RAG_NOT_CONFIGURED') }),
  z.object({ code: z.literal('REINDEX_IN_PROGRESS') }),
  z.object({ code: z.literal('SCHEMA_UPCASTED'), fromVersion: z.number().int(), toVersion: z.number().int() }),
  // [No.26 신설] 레거시 API 연동 — §15. 전부 blocker 아님(FR-L8-2 · AC-L7-1).
  z.object({ code: z.literal('API_CONNECTION_MISSING'), count: z.number().int().nonnegative() }),
  z.object({ code: z.literal('API_CONNECTION_DISABLED'), count: z.number().int().nonnegative() }),
  z.object({ code: z.literal('API_LEGACY_FORMAT'), count: z.number().int().nonnegative() }),
  // [No.27 신설] 설문관리 — §16. 전부 blocker 아님(설문은 스냅샷 밖 · 참조만 스냅샷, P-6).
  z.object({ code: z.literal('SURVEY_MISSING'), count: z.number().int().nonnegative() }),
  z.object({ code: z.literal('SURVEY_NOT_OPEN'), count: z.number().int().nonnegative() }),
  z.object({ code: z.literal('SURVEY_LEGACY_FORMAT'), count: z.number().int().nonnegative() }),
  // [No.22 신설] 토픽 시스템 — §11.3. 둘 다 blocker 아님. `TOPIC_EXPOSURE_CHANGE`는 값이 있으면
  // 확인 체크(`acknowledgeTopicExposure`) 없이는 복원을 거부한다(PM 확정 2026-09-25 — §25 D-4 강화).
  z.object({ code: z.literal('TOPIC_MISSING'), count: z.number().int().nonnegative() }),
  z.object({ code: z.literal('TOPIC_EXPOSURE_CHANGE'), exposed: z.number().int().nonnegative(), hidden: z.number().int().nonnegative() }),
]);
export type RestoreWarning = z.infer<typeof RestoreWarningSchema>;

export const RestorePreviewResponseSchema = z.object({
  targetVersion: z.object({
    id: z.string().uuid(),
    versionNo: z.number().int().positive(),
    trigger: ChatbotVersionTrigger,
    createdAt: z.coerce.date(),
    schemaVersion: z.number().int().positive(),
  }),
  currentContentHash: z.string(),
  targetContentHash: z.string(),
  diffSummary: VersionDiffSummarySchema,
  changesUndone: z.number().int().nonnegative(),
  laterVersionCount: z.number().int().nonnegative(),
  blockers: z.array(RestoreBlockerSchema),
  warnings: z.array(RestoreWarningSchema),
  restorable: z.boolean(),
});
export type RestorePreviewResponse = z.infer<typeof RestorePreviewResponseSchema>;

export const RestoreRequestSchema = z.object({
  expectedCurrentHash: z.string().regex(/^[0-9a-f]{64}$/, '현재 해시 형식이 올바르지 않습니다.'),
  acknowledgeActive: z.boolean().optional(),
  /** [신규 No.22 — PM 확정 2026-09-25] 미리보기 경고 `TOPIC_EXPOSURE_CHANGE`가 해당하는데 true가
   * 아니면 `400 VALIDATION_FAILED`로 거부한다(`acknowledgeActive`와 같은 패턴, §11.3). */
  acknowledgeTopicExposure: z.boolean().optional(),
});
export type RestoreRequestDto = z.infer<typeof RestoreRequestSchema>;

export const RestoreSummaryEntrySchema = z.object({
  added: z.number().int().nonnegative(),
  removed: z.number().int().nonnegative(),
  modified: z.number().int().nonnegative(),
});

export const RestoreResponseSchema = z.object({
  restoredFromVersionNo: z.number().int().positive(),
  backupVersionNo: z.number().int().positive(),
  backupVersionId: z.string().uuid(),
  contentHash: z.string(),
  summary: z.record(VersionAssetKind, RestoreSummaryEntrySchema),
  reindexScheduled: z.literal(true),
  reindexWasRunning: z.boolean(),
  classifierDeleted: z.boolean(),
  upcastedFromSchemaVersion: z.number().int().optional(),
});
export type RestoreResponse = z.infer<typeof RestoreResponseSchema>;

/* ------------------------------------------------------------------------------------------------
 * 자동 스냅샷 결과(선택 필드 — 기존 응답 스키마에 append)
 * ---------------------------------------------------------------------------------------------- */

export const AutoSnapshotOutcomeSchema = z.object({
  status: z.enum(['CREATED', 'UNCHANGED', 'FAILED', 'DISABLED']),
  versionNo: z.number().int().positive().optional(),
  versionId: z.string().uuid().optional(),
});
export type AutoSnapshotOutcome = z.infer<typeof AutoSnapshotOutcomeSchema>;

/* ------------------------------------------------------------------------------------------------
 * 상수(§3)
 * ---------------------------------------------------------------------------------------------- */

export const VERSION_LIMITS = {
  labelMaxLength: 50,
  memoMaxLength: 500,
  listPageSizeDefault: 20,
  listPageSizeMax: 100,
  diffContentPageSizeDefault: 50,
  integrityWarningStoreMax: 100,
} as const;
