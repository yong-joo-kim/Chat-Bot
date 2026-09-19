import { z } from 'zod';
import { ResourceRefSchema } from './dialogue';
import { DialogOutputSchema, DialogOutputType, DialogNodeType } from './dialogue';
import { IntentSchema, KeywordSchema, HomonymDictionarySchema, DialogNodeSchema, ContextVariableSchema, FaqEntrySchema } from './dialogue';

/**
 * `packages/dialogue-engine` 입출력 계약(FR-E-1, FR-E-2, FR-8-8).
 * `docs/02-spec/dialogue-design-설계.md` §4.4 근거.
 */

/* ------------------------------------------------------------------------------------------------
 * 컨텍스트 세션 상태 — FR-8-8 (stateless 계약, DD-10)
 * ---------------------------------------------------------------------------------------------- */

export const ContextSessionStatus = z.enum(['IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'EXPIRED']);
export type ContextSessionStatus = z.infer<typeof ContextSessionStatus>;

export const ContextSessionStateSchema = z.object({
  contextVariableId: z.string().uuid(),
  currentSlotIndex: z.number().int().min(0),
  /** ⚠ PII 가능(전화번호·이메일). 서버 로그에 원문을 남기지 않는다(NFR-S9, FR-8-16). */
  filledValues: z.record(z.string()),
  retryCount: z.number().int().min(0),
  startedAt: z.coerce.date(),
  lastInteractedAt: z.coerce.date(),
  status: ContextSessionStatus,
});
export type ContextSessionState = z.infer<typeof ContextSessionStateSchema>;

/* ------------------------------------------------------------------------------------------------
 * 엔진 입력 번들 — FR-E-1
 * ---------------------------------------------------------------------------------------------- */

export const DialogueBundleSchema = z.object({
  intents: z.array(IntentSchema),
  keywords: z.array(KeywordSchema),
  homonyms: z.array(HomonymDictionarySchema),
  dialogNodes: z.array(DialogNodeSchema),
  contexts: z.array(ContextVariableSchema),
  faqs: z.array(FaqEntrySchema),
});
export type DialogueBundle = z.infer<typeof DialogueBundleSchema>;

/* ------------------------------------------------------------------------------------------------
 * trace — FR-E-8
 * ---------------------------------------------------------------------------------------------- */

export const TraceStageEnum = z.enum(['PREPROCESS', 'SESSION', 'HOMONYM', 'NODE', 'FAQ', 'INTENT', 'FALLBACK', 'OUTPUT']);
export type TraceStage = z.infer<typeof TraceStageEnum>;

export const TraceCodeEnum = z.enum([
  'EMPTY_INPUT',
  'INPUT_TRUNCATED',
  'SESSION_ADVANCED',
  'SESSION_RETRY',
  'SESSION_CANCELLED',
  'SESSION_EXPIRED',
  'SESSION_COMPLETED',
  'SESSION_DEFINITION_CHANGED',
  'HOMONYM_RESOLVED',
  'HOMONYM_AMBIGUOUS',
  'HOMONYM_IGNORED',
  'NODE_MATCHED',
  'NODE_SKIPPED_DISABLED',
  'NODE_CONDITION_FAILED',
  'NODE_TIEBREAK',
  'FAQ_MATCHED',
  'FAQ_DEFERRED',
  'INTENT_MATCHED',
  'INTENT_ONLY',
  'FALLBACK_NODE',
  'FALLBACK_FAQ',
  'FALLBACK_DEFAULT',
  'HOP_LIMIT_EXCEEDED',
  'BROKEN_REFERENCE',
  'UNSUPPORTED_OUTPUT',
  'PAYLOAD_INVALID',
  'EMPTY_OUTPUT',
]);
export type TraceCode = z.infer<typeof TraceCodeEnum>;

export const TraceStepSchema = z.object({
  stage: TraceStageEnum,
  code: TraceCodeEnum,
  targetId: z.string().optional(),
  targetName: z.string().optional(),
  score: z.number().optional(),
  message: z.string().optional(),
});
export type TraceStep = z.infer<typeof TraceStepSchema>;

/* ------------------------------------------------------------------------------------------------
 * 동음이의어 판정 결과 — FR-7-11
 * ---------------------------------------------------------------------------------------------- */

export const HomonymResolutionSchema = z.object({
  word: z.string(),
  status: z.enum(['RESOLVED', 'AMBIGUOUS', 'IGNORED']),
  meaningLabel: z.string().optional(),
  intentId: z.string().uuid().optional(),
  matchedHints: z.array(z.string()).default([]),
});
export type HomonymResolution = z.infer<typeof HomonymResolutionSchema>;

/* ------------------------------------------------------------------------------------------------
 * resolveResponse 결과 — FR-E-2
 * ---------------------------------------------------------------------------------------------- */

export const DialogueResolutionSchema = z.object({
  input: z.string(),
  normalizedInput: z.string(),
  matchedNodeId: z.string().uuid().optional(),
  matchedIntentId: z.string().uuid().optional(),
  matchedFaqId: z.string().uuid().optional(),
  homonymResolution: HomonymResolutionSchema.optional(),
  outputs: z.array(DialogOutputSchema),
  nextSession: ContextSessionStateSchema.nullable(),
  unsupportedOutputs: z.array(DialogOutputType),
  trace: z.array(TraceStepSchema),
});
export type DialogueResolution = z.infer<typeof DialogueResolutionSchema>;

/* ------------------------------------------------------------------------------------------------
 * 설계 점검 — FR-5-16~18
 * ---------------------------------------------------------------------------------------------- */

export const DesignIssueSeverity = z.enum(['ERROR', 'WARNING', 'INFO']);
export type DesignIssueSeverity = z.infer<typeof DesignIssueSeverity>;

export const DesignIssueCode = z.enum([
  'EMPTY_OUTPUT',
  'BROKEN_REFERENCE',
  'MOVE_CYCLE',
  'DUPLICATE_CONDITION',
  'ORPHAN_NODE',
  'NO_FALLBACK_NODE',
  'EMPTY_EXAMPLE_INTENT',
  'UNSUPPORTED_OUTPUT',
]);
export type DesignIssueCode = z.infer<typeof DesignIssueCode>;

export const DesignIssueSchema = z.object({
  code: DesignIssueCode,
  severity: DesignIssueSeverity,
  resourceType: z.enum(['NODE', 'INTENT', 'KEYWORD', 'CONTEXT', 'FAQ', 'CHATBOT']),
  resourceId: z.string().optional(),
  resourceName: z.string().optional(),
  path: z.array(z.string()).optional(),
  message: z.string(),
});
export type DesignIssue = z.infer<typeof DesignIssueSchema>;

export const DesignValidationReportSchema = z.object({
  issues: z.array(DesignIssueSchema),
  summary: z.object({
    error: z.number().int().nonnegative(),
    warning: z.number().int().nonnegative(),
    info: z.number().int().nonnegative(),
  }),
  checkedAt: z.coerce.date(),
});
export type DesignValidationReport = z.infer<typeof DesignValidationReportSchema>;

/* ------------------------------------------------------------------------------------------------
 * 흐름 요약 — FR-5-19
 * ---------------------------------------------------------------------------------------------- */

export interface FlowNode {
  nodeId: string;
  name: string;
  nodeType: DialogNodeType;
  via: 'ROOT' | 'DIALOG_MOVE' | 'BUTTON_NODE';
  repeated: boolean;
  children: FlowNode[];
}

export const FlowNodeSchema: z.ZodType<FlowNode> = z.lazy(() =>
  z.object({
    nodeId: z.string(),
    name: z.string(),
    nodeType: DialogNodeType,
    via: z.enum(['ROOT', 'DIALOG_MOVE', 'BUTTON_NODE']),
    repeated: z.boolean(),
    children: z.array(FlowNodeSchema),
  }),
);

export const FlowTreeSchema = z.object({
  roots: z.array(FlowNodeSchema),
  orphanNodes: z.array(ResourceRefSchema),
});
export type FlowTree = z.infer<typeof FlowTreeSchema>;
