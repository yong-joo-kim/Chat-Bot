import { z } from 'zod';
import { PaginationQuerySchema, csvEnumArray, paginated } from './common';

export const GovernanceMode = z.enum(['OFF', 'ON']);
export type GovernanceMode = z.infer<typeof GovernanceMode>;

export const PiiMaskModeSchema = z.enum(['PARTIAL', 'FULL']);
export type PiiMaskMode = z.infer<typeof PiiMaskModeSchema>;

// [신규 No.43] 7번째 클래스 `KB_CRAWL`(지식베이스 크롤러) — ADR-0044 §6.
export const EgressExitId = z.enum(['EMBEDDING', 'RAG', 'AUGMENT_GEMINI', 'AUGMENT_LOCAL', 'LEGACY_API', 'WORKFLOW_WEBHOOK', 'KB_CRAWL']);
export type EgressExitId = z.infer<typeof EgressExitId>;

// [신규 No.43] `CRAWL_REQUEST`(크롤러 요청 줄) · `DOCUMENT_BODY`(지식베이스 적재 문서 본문 — 데이터 지도
// `egress.kbSources` 절에서만 쓰인다. RAG 출구 자체의 exits[] 행은 `QUESTION_MASKED` 그대로다).
export const EgressDataKind = z.enum(['QUERY_RAW', 'QUESTION_MASKED', 'SEED_MASKED', 'SEED_UNMASKED', 'FORM_SLOT', 'WORKFLOW_PAYLOAD', 'CRAWL_REQUEST', 'DOCUMENT_BODY']);
export type EgressDataKind = z.infer<typeof EgressDataKind>;

export const EgressDecision = z.enum(['ALLOWED', 'BLOCKED', 'NOT_CONFIGURED', 'NOT_ENFORCED']);
export type EgressDecision = z.infer<typeof EgressDecision>;

// [신규 No.41] 발송함 본문(재시도용 일시 보관) — 4번째 암호화 대상(ADR-0041 §7). 백필·재암호화 잡 제외 대상.
// [신규 No.42] 인박스 항목 본문·고객 표시 이름 — 5·6번째 암호화 대상(ADR-0042 §6). 백필·재암호화 잡 편입.
export const EncryptedFieldId = z.enum(['HANDOFF_RAW_TEXT', 'HANDOFF_TEXT', 'SURVEY_TEXT_VALUE', 'WORKFLOW_PAYLOAD', 'INBOX_ENTRY_TEXT', 'CUSTOMER_DISPLAY_NAME']);
export type EncryptedFieldId = z.infer<typeof EncryptedFieldId>;

// [신규 No.42] `INBOX_TEXT`·`CUSTOMER_IDENTITY` — 전역만(ADR-0042 §6, `CONVERSATION_RETENTION_KINDS` 불변).
export const RetentionTargetKind = z.enum([
  'CONVERSATION_TEXT',
  'UNANSWERED_CLOSED',
  'SURVEY_FREE_TEXT',
  'HANDOFF_TEXT',
  'CALL_LOGS',
  'AUDIT_LOGS',
  'INBOX_TEXT',
  'CUSTOMER_IDENTITY',
]);
export type RetentionTargetKind = z.infer<typeof RetentionTargetKind>;

export const CONVERSATION_RETENTION_KINDS = ['CONVERSATION_TEXT', 'UNANSWERED_CLOSED', 'SURVEY_FREE_TEXT', 'HANDOFF_TEXT'] as const;

export const RetentionDays = z.number().int().min(1).max(36500).nullable();
export const GlobalRetentionUpdateSchema = z.object({
  days: z
    .object({
      CONVERSATION_TEXT: RetentionDays,
      UNANSWERED_CLOSED: RetentionDays,
      SURVEY_FREE_TEXT: RetentionDays,
      HANDOFF_TEXT: RetentionDays,
      CALL_LOGS: RetentionDays,
      AUDIT_LOGS: RetentionDays,
      // [신규 No.42] 선택 키 — 기존 6키 요청은 그대로 통과한다(생략 = 현재값 유지, ADR-0042 §6 제약 ⑥⑦).
      INBOX_TEXT: RetentionDays.optional(),
      CUSTOMER_IDENTITY: RetentionDays.optional(),
    })
    .strict(),
  confirmText: z.string().trim().max(100).optional(),
});
export type GlobalRetentionUpdateDto = z.infer<typeof GlobalRetentionUpdateSchema>;

const ChatbotRetentionValue = z.union([RetentionDays, z.literal('GLOBAL')]);
export const ChatbotRetentionUpdateSchema = z.object({
  days: z
    .object({
      CONVERSATION_TEXT: ChatbotRetentionValue,
      UNANSWERED_CLOSED: ChatbotRetentionValue,
      SURVEY_FREE_TEXT: ChatbotRetentionValue,
      HANDOFF_TEXT: ChatbotRetentionValue,
    })
    .strict(),
  confirmText: z.string().trim().max(100).optional(),
});
export type ChatbotRetentionUpdateDto = z.infer<typeof ChatbotRetentionUpdateSchema>;

export const RetentionKindView = z.object({
  kind: RetentionTargetKind,
  days: z.number().int().nullable(),
  source: z.enum(['GLOBAL', 'CHATBOT', 'DEFAULT']),
  pending: z.object({ days: z.number().int().nullable(), effectiveAt: z.coerce.date() }).optional(),
  belowServerMinimum: z.literal(true).optional(),
});
export type RetentionKindView = z.infer<typeof RetentionKindView>;
export const RetentionPolicyResponseSchema = z.object({
  scope: z.enum(['GLOBAL', 'CHATBOT']),
  chatbotId: z.string().optional(),
  kinds: z.array(RetentionKindView),
  bounds: z.object({ minConversationDays: z.number(), minAuditDays: z.number(), maxDays: z.number(), shortenGraceDays: z.number() }),
  updatedAt: z.coerce.date().nullable(),
  updatedByEmail: z.string().nullable(),
});
export type RetentionPolicyResponse = z.infer<typeof RetentionPolicyResponseSchema>;

export const RetentionPreviewRequestSchema = z.object({
  days: z
    .object({
      CONVERSATION_TEXT: ChatbotRetentionValue.optional(),
      UNANSWERED_CLOSED: ChatbotRetentionValue.optional(),
      SURVEY_FREE_TEXT: ChatbotRetentionValue.optional(),
      HANDOFF_TEXT: ChatbotRetentionValue.optional(),
      CALL_LOGS: RetentionDays.optional(),
      AUDIT_LOGS: RetentionDays.optional(),
      // [신규 No.42]
      INBOX_TEXT: RetentionDays.optional(),
      CUSTOMER_IDENTITY: RetentionDays.optional(),
    })
    .partial(),
});
export type RetentionPreviewRequestDto = z.infer<typeof RetentionPreviewRequestSchema>;

export const RetentionPreviewResponseSchema = z.object({
  items: z.array(
    z.object({
      kind: RetentionTargetKind,
      currentDays: z.number().nullable(),
      newDays: z.number().nullable(),
      shortening: z.boolean(),
      affectedCount: z.number().int().nullable(),
      firstPurgeAt: z.coerce.date().nullable(),
    }),
  ),
  requiresConfirm: z.boolean(),
  confirmHint: z.string().optional(),
});
export type RetentionPreviewResponse = z.infer<typeof RetentionPreviewResponseSchema>;

export const RetentionRunKind = z.enum(['PURGE', 'BACKFILL', 'REENCRYPT', 'CHAIN_VERIFY']);
export type RetentionRunKind = z.infer<typeof RetentionRunKind>;
export const RetentionRunItemSchema = z.object({
  id: z.string().uuid(),
  runId: z.string(),
  kind: RetentionRunKind,
  target: z.string().nullable(),
  chatbotId: z.string().nullable(),
  days: z.number().int().nullable(),
  cutoff: z.coerce.date().nullable(),
  affectedCount: z.number().int(),
  status: z.enum(['SUCCEEDED', 'PARTIAL', 'FAILED']),
  resultCode: z.string().nullable(),
  headSeq: z.number().int().nullable(),
  headHash: z.string().nullable(),
  anchorSeq: z.number().int().nullable(),
  startedAt: z.coerce.date(),
  finishedAt: z.coerce.date().nullable(),
});
export type RetentionRunItem = z.infer<typeof RetentionRunItemSchema>;

export const RetentionRunListQuerySchema = PaginationQuerySchema.extend({
  kind: csvEnumArray(RetentionRunKind),
  chatbotId: z.string().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
export type RetentionRunListQuery = z.infer<typeof RetentionRunListQuerySchema>;

export const RetentionRunListResponseSchema = paginated(RetentionRunItemSchema);
export type RetentionRunListResponse = z.infer<typeof RetentionRunListResponseSchema>;

export const RetentionOverrideItemSchema = z.object({
  chatbotId: z.string(),
  chatbotName: z.string(),
  status: z.string(),
  kinds: z.array(RetentionKindView),
});
export type RetentionOverrideItem = z.infer<typeof RetentionOverrideItemSchema>;

export const RetentionOverrideListResponseSchema = paginated(RetentionOverrideItemSchema);
export type RetentionOverrideListResponse = z.infer<typeof RetentionOverrideListResponseSchema>;
export const GovernanceMapResponseSchema = z.object({
  mode: GovernanceMode,
  generatedAt: z.coerce.date(),
  storage: z.object({
    kind: z.enum(['SQLITE_FILE', 'REMOTE_DB']),
    location: z.string(),
    residency: z.enum(['NOT_CONFIGURED', 'ALLOWED', 'NOT_ENFORCED']),
    allowedDirs: z.array(z.string()),
    allowedDbHosts: z.array(z.string()),
    atRestEncryptionDeclared: z.boolean(),
  }),
  egress: z.object({
    allowedHosts: z.array(z.string()),
    exits: z.array(
      z.object({
        exitId: EgressExitId,
        configured: z.boolean(),
        host: z.string().nullable(),
        dataKind: EgressDataKind,
        // [신규 No.41 — 프런트엔드 계약 보강] 'PER_TARGET' — 워크플로 웹훅 행 전용(대상별 원문 허용
        // 토글, §9.1). 'PER_CONNECTION'(레거시 연동)과 의미는 같되 이름을 구분해 화면이 "대상"·"연동"
        // 문구를 갈라 쓸 수 있게 한다.
        masked: z.enum(['YES', 'NO', 'PER_CONNECTION', 'PER_TARGET']),
        decision: EgressDecision,
        rawTextOffHost: z.literal(true).optional(),
      }),
    ),
    legacyConnections: z.array(
      z.object({
        connectionId: z.string(),
        name: z.string(),
        host: z.string(),
        enabled: z.boolean(),
        decision: EgressDecision,
        allowRawPersonalData: z.boolean(),
        blockedLast24h: z.number().int(),
      }),
    ),
    /** [신규 No.41] 발송 대상이 1개 이상일 때만 채워진다(대상 0개 설치는 바이트 동일, FR-0-172). */
    workflowTargets: z
      .array(
        z.object({
          targetId: z.string().uuid(),
          name: z.string(),
          host: z.string(),
          enabled: z.boolean(),
          paused: z.boolean(),
          decision: EgressDecision,
          allowRawPersonalData: z.boolean(),
          failedLast24h: z.number().int().nonnegative(),
          payloadRetained: z.number().int().nonnegative(),
        }),
      )
      .optional(),
  }),
  encryption: z.object({
    enabled: z.boolean(),
    writeKeyId: z.string().nullable(),
    keyIds: z.array(z.string()),
    fields: z.array(
      z.object({
        field: EncryptedFieldId,
        plaintextRows: z.number().int(),
        byKey: z.record(z.string(), z.number().int()),
        unknownKeyRows: z.number().int(),
      }),
    ),
    statsComputedAt: z.coerce.date().nullable(),
    passInProgress: z.boolean(),
  }),
  retention: z.object({
    global: z.array(RetentionKindView),
    chatbotOverrideCount: z.number().int(),
    nextWindowStartAt: z.coerce.date().nullable(),
    jobEnabled: z.boolean(),
    lastRuns: z.array(RetentionRunItemSchema),
    bounds: RetentionPolicyResponseSchema.shape.bounds,
    auditMinimumLowered: z.literal(true).optional(),
  }),
  auditChain: z.object({
    method: z.enum(['SHA256', 'HMAC']),
    signingKeyId: z.string().nullable(),
    head: z.object({ seq: z.number().int(), hash: z.string() }).nullable(),
    lastVerification: z.object({ at: z.coerce.date(), status: z.string(), checkedRows: z.number().int() }).nullable(),
  }),
  risks: z.object({
    v1PlainHeaderNodes: z.number().int(),
    v1PlainHeaderSnapshots: z.number().int().nullable(),
    snapshotScanAt: z.coerce.date().nullable(),
    rawPersonalDataConnections: z.number().int(),
    externalLlmAugmentation: z.boolean(),
    piiMaskMode: PiiMaskModeSchema,
    /** [신규 No.41] 원문 개인정보 전송을 허용한 업무 자동화 대상 수(대상 0개면 키 자체가 없다). */
    rawPersonalDataWorkflowTargets: z.number().int().nonnegative().optional(),
  }),
  /** [신규 No.42] 고객 0명이면 키 자체를 생략한다(§13.4 — No.41 선례). */
  inbox: z
    .object({
      customers: z.number().int().nonnegative(),
      identifiedCustomers: z.number().int().nonnegative(),
      threads: z.number().int().nonnegative(),
      entries: z.number().int().nonnegative(),
      identityHashOnly: z.literal(true),
      displayNameEncrypted: z.boolean(),
      retentionDays: z.object({ INBOX_TEXT: z.number().int().nullable(), CUSTOMER_IDENTITY: z.number().int().nullable() }),
    })
    .optional(),
  /** [신규 No.43] 소스 0개면 키 자체를 생략한다(§3.4 — No.41·No.42 선례). 소스 단위로 마스킹·원본 파일
   * 전달·전송 전제(ACK)를 표시한다(적재는 RAG 출구 그대로라 exits[]에는 별도 행이 생기지 않는다). */
  kbSources: z
    .array(
      z.object({
        sourceId: z.string().uuid(),
        name: z.string(),
        hosts: z.array(z.string()),
        enabled: z.boolean(),
        decision: EgressDecision,
        piiMask: z.boolean(),
        allowRawFileIngest: z.boolean(),
        ingestDataKind: z.literal('DOCUMENT_BODY'),
        scopeCompany: z.string(),
        ingestAck: z.enum(['INTERNAL_NETWORK', 'AUTHENTICATED', 'TLS']).nullable(),
      }),
    )
    .optional(),
  /** [신규 No.35] 규칙 ≥1 또는 켜진 스위치 ≥1일 때만 채워진다(없으면 키 생략 = 바이트 동일,
   * §12.3 — No.41·No.42·No.43 선례). */
  proactive: z
    .object({
      chatbotsEnabled: z.number().int().nonnegative(),
      rules: z.number().int().nonnegative(),
      enabledRules: z.number().int().nonnegative(),
      counters: z.literal('RULE_DAILY_COUNTS_ONLY'),
      browserStorage: z.literal('SESSION_STORAGE'),
      serverEnabled: z.boolean(),
    })
    .optional(),
  /** [신규 No.21] 발화 묶음 분석이 1건 이상일 때만 채워진다(0건이면 키 생략 = 바이트 동일,
   * deep-clustering-설계.md §13.4 — No.35·No.41~43 선례). */
  utteranceAnalysis: z
    .object({
      analyses: z.number().int().nonnegative(),
      utterances: z.number().int().nonnegative(),
      retentionDays: z.number().int(),
      storesMaskedOnly: z.literal(true),
      originalFileStored: z.literal(false),
      exits: z.array(z.enum(['EMBEDDING', 'AUGMENT_LOCAL'])),
      nameSuggestEnabled: z.boolean(),
      retentionJobEnabled: z.boolean(),
    })
    .optional(),
});
export type GovernanceMapResponse = z.infer<typeof GovernanceMapResponseSchema>;
