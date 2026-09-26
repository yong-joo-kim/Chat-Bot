import { z } from 'zod';
import { PaginationQuerySchema, csvEnumArray, paginated } from './common';

export const GovernanceMode = z.enum(['OFF', 'ON']);
export type GovernanceMode = z.infer<typeof GovernanceMode>;

export const PiiMaskModeSchema = z.enum(['PARTIAL', 'FULL']);
export type PiiMaskMode = z.infer<typeof PiiMaskModeSchema>;

export const EgressExitId = z.enum(['EMBEDDING', 'RAG', 'AUGMENT_GEMINI', 'AUGMENT_LOCAL', 'LEGACY_API']);
export type EgressExitId = z.infer<typeof EgressExitId>;

export const EgressDataKind = z.enum(['QUERY_RAW', 'QUESTION_MASKED', 'SEED_MASKED', 'SEED_UNMASKED', 'FORM_SLOT']);
export type EgressDataKind = z.infer<typeof EgressDataKind>;

export const EgressDecision = z.enum(['ALLOWED', 'BLOCKED', 'NOT_CONFIGURED', 'NOT_ENFORCED']);
export type EgressDecision = z.infer<typeof EgressDecision>;

export const EncryptedFieldId = z.enum(['HANDOFF_RAW_TEXT', 'HANDOFF_TEXT', 'SURVEY_TEXT_VALUE']);
export type EncryptedFieldId = z.infer<typeof EncryptedFieldId>;

export const RetentionTargetKind = z.enum([
  'CONVERSATION_TEXT',
  'UNANSWERED_CLOSED',
  'SURVEY_FREE_TEXT',
  'HANDOFF_TEXT',
  'CALL_LOGS',
  'AUDIT_LOGS',
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
        masked: z.enum(['YES', 'NO', 'PER_CONNECTION']),
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
  }),
});
export type GovernanceMapResponse = z.infer<typeof GovernanceMapResponseSchema>;
