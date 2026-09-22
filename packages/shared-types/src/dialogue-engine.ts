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
 * 되묻기 대기 상태 — FR-E2-2, DD-27
 * ---------------------------------------------------------------------------------------------- */

export const PendingClarifySchema = z.object({
  homonymId: z.string().uuid(),
  word: z.string().min(1).max(50),
  askedAt: z.coerce.date(),
});
export type PendingClarify = z.infer<typeof PendingClarifySchema>;

/* ------------------------------------------------------------------------------------------------
 * 대화 상태 봉투 — FR-10-3, DD-18(ADR-0009). 클라이언트가 보관하고 매 요청에 실어 보낸다.
 * ---------------------------------------------------------------------------------------------- */

export const CONVERSATION_STATE_VERSION = 1 as const;
export const ConversationStateSchema = z.object({
  version: z.literal(CONVERSATION_STATE_VERSION),
  contextSession: ContextSessionStateSchema.nullable(),
  pendingClarify: PendingClarifySchema.nullable().optional(),
});
export type ConversationState = z.infer<typeof ConversationStateSchema>;

/* ------------------------------------------------------------------------------------------------
 * 버튼 액션 — FR-11-25, FR-W-6. LINK는 클라이언트 전용이라 서버 계약에 없다.
 * ---------------------------------------------------------------------------------------------- */

export const ButtonActionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('MESSAGE'), text: z.string().min(1).max(200) }),
  z.object({ kind: z.literal('NODE'), nodeId: z.string().uuid(), label: z.string().max(40).optional() }),
]);
export type ButtonAction = z.infer<typeof ButtonActionSchema>;

/* ------------------------------------------------------------------------------------------------
 * 봉투 폐기 사유 — §7.4
 * ---------------------------------------------------------------------------------------------- */

export const StateDiscardReason = z.enum([
  'INVALID_SCHEMA',
  'VERSION_MISMATCH',
  'UNKNOWN_CONTEXT',
  'SESSION_EXPIRED',
  'OVERSIZED',
  'UNKNOWN_HOMONYM',
  'CLARIFY_EXPIRED',
]);
export type StateDiscardReason = z.infer<typeof StateDiscardReason>;

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

export const TraceStageEnum = z.enum(['PREPROCESS', 'SESSION', 'HOMONYM', 'NODE', 'FAQ', 'INTENT', 'FALLBACK', 'OUTPUT', 'SEMANTIC']);
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
  // FR-E2-6 — 엔진 보강(버튼 노드 진입점·되묻기 종결·상태 봉투 폐기) 추가 코드
  'NODE_BY_ID',
  'NODE_BY_ID_NOT_FOUND',
  'CLARIFY_RESOLVED',
  'CLARIFY_DISCARDED',
  'STATE_DISCARDED',
  // NLU/RAG 매칭 고도화(ADR-0020) 추가 코드 — 1단계 의미 유사도 판정 결과.
  'SEMANTIC_MATCHED',
  'SEMANTIC_AMBIGUOUS',
  'SEMANTIC_BELOW_THRESHOLD',
  'SEMANTIC_SKIPPED',
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
  /** 되묻기 응답을 반환하는 턴에만 채워진다(FR-E2-2, DD-27). 그 외에는 항상 undefined/null. */
  pendingClarify: PendingClarifySchema.nullable().optional(),
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

/* ------------------------------------------------------------------------------------------------
 * 1단계(NLU 의미 유사도 매칭) 엔진 입력 — J-2, ADR-0020.
 * ⚠ zod 스키마가 아니라 순수 TS 타입이다 — 엔진에 zod를 반입하지 않는다는 기존 규약을 유지한다.
 * `apps/api`(SemanticMatchService)가 턴마다 계산해 `ResolveOptions.semantic`으로 주입한다.
 * 엔진은 이 값을 읽기만 한다(네트워크·시간·난수 없음 — 결정론 유지, FR-0-40).
 * ---------------------------------------------------------------------------------------------- */

export interface SemanticRankedCandidate {
  kind: 'FAQ' | 'INTENT';
  id: string;
  /** 코사인 유사도(0..1). */
  score: number;
  /** 되묻기 버튼에 그대로 쓰이는 원문(질문·대체질문 또는 의도명·예문 중 최고 점수 텍스트). */
  matchedText: string;
}

export interface SemanticMatchInput {
  /** `<model-name>@<rev>|<prefix-rule>|<norm-rule>` 규약 문자열(DD-69). */
  modelId: string;
  /** FAQ id → 최고 유사도(질문·대체질문 중 최댓값). */
  faqScores: ReadonlyMap<string, number>;
  /** 의도 id → 최고 유사도(의도명·예문 중 최댓값). */
  intentScores: ReadonlyMap<string, number>;
  /** 되묻기 후보 구성을 위한 상위 N(점수 내림차순, 결정론적 타이브레이크 포함 — FAQ→INTENT, id asc). */
  ranked: readonly SemanticRankedCandidate[];
  thresholds: { accept: number; low: number; margin: number };
}
