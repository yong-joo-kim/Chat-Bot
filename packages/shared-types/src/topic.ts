import { z } from 'zod';
import { queryBoolean } from './common';
import { DialogueNameSchema } from './dialogue';
import { ChatbotSchema, SlugSchema } from './chatbot';

// `TOPIC_FILTER_COMMON`은 `common.ts`에 정의된다(순환 의존 회피 — `index.ts`의 `export * from './common'`으로
// 이미 공개된다. `dialogue.ts`의 목록 쿼리 파서도 같은 상수를 쓴다).

/**
 * 토픽 시스템(No.22) — `docs/02-spec/topic-system-설계.md` §4.1, ADR-0037.
 * 위젯에는 유입되지 않는다(관리자 전용 스키마). `dialogue.ts`(자산 6종 `topicId` 등)·
 * `dialogue-engine.ts`(설계 점검 토픽 규칙)·`version.ts`(복원 경고 2종)·`audit.ts`(`Topic` 대상)·
 * `common.ts`(오류 코드 4종)는 각 파일에서 확장한다(§4.2).
 */

export const TOPIC_LIMITS = {
  maxPerChatbot: 50,
  nameMax: 40,
  descriptionMax: 200,
  assignMaxIds: 1000,
  boundaryIssuesPerRule: 50,
  impactRefsTop: 20,
  splitListTop: 50,
} as const;

/** 분리 동기 상한(§9.4, 코드 상수 `TOPIC_SPLIT_LIMITS`) — 성능 기준 자산량 기준. */
export const TOPIC_SPLIT_LIMITS = {
  intents: 1000,
  intentExamples: 20000,
  dialogNodes: 500,
  faqs: 2000,
  keywords: 2000,
  homonyms: 1000,
  contexts: 200,
  surveys: 50,
} as const;

export const TopicAssetKind = z.enum(['INTENT', 'KEYWORD', 'HOMONYM', 'CONTEXT', 'NODE', 'FAQ']);
export type TopicAssetKind = z.infer<typeof TopicAssetKind>;

/** 1~40 코드 포인트 · 줄바꿈/탭 금지(EX-TP-5) — 금지어 필터 비대상(EX-TP-6, §25 D-15). */
export const TopicNameSchema = z
  .string()
  .trim()
  .min(1, '토픽 이름을 입력해 주세요.')
  .refine((v) => [...v].length <= TOPIC_LIMITS.nameMax, {
    message: `토픽 이름은 최대 ${TOPIC_LIMITS.nameMax}자까지 입력할 수 있습니다.`,
  })
  .refine((v) => !/[\n\r\t]/.test(v), { message: '토픽 이름에 줄바꿈이나 탭을 넣을 수 없습니다.' });

export const TopicSchema = z.object({
  id: z.string().uuid(),
  chatbotId: z.string().uuid(),
  name: z.string(),
  description: z.string().max(TOPIC_LIMITS.descriptionMax).optional(),
  sortOrder: z.number().int(),
  enabled: z.boolean(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type Topic = z.infer<typeof TopicSchema>;

export const CreateTopicSchema = z.object({
  name: TopicNameSchema,
  description: z.string().max(TOPIC_LIMITS.descriptionMax).optional(),
  enabled: z.boolean().default(true),
});
export type CreateTopicDto = z.infer<typeof CreateTopicSchema>;

/** 활성 전환은 전용 경로(`POST …/enable`·`POST …/disable`)다 — 여기에는 없다. */
export const UpdateTopicSchema = z.object({
  name: TopicNameSchema.optional(),
  description: z.string().max(TOPIC_LIMITS.descriptionMax).nullable().optional(),
});
export type UpdateTopicDto = z.infer<typeof UpdateTopicSchema>;

/** 드래그 없음(canned-responses 선례) — 위/아래 버튼. */
export const MoveTopicSchema = z.object({
  direction: z.enum(['UP', 'DOWN']),
});
export type MoveTopicDto = z.infer<typeof MoveTopicSchema>;

export const DeleteTopicQuerySchema = z.object({
  moveToCommon: queryBoolean(),
});
export type DeleteTopicQuery = z.infer<typeof DeleteTopicQuerySchema>;

export const TopicAssetCountsSchema = z.object({
  intents: z.number().int().nonnegative(),
  keywords: z.number().int().nonnegative(),
  homonyms: z.number().int().nonnegative(),
  contexts: z.number().int().nonnegative(),
  dialogNodes: z.number().int().nonnegative(),
  faqs: z.number().int().nonnegative(),
});
export type TopicAssetCounts = z.infer<typeof TopicAssetCountsSchema>;

export const TopicListItemSchema = TopicSchema.extend({
  counts: TopicAssetCountsSchema,
  /** 이 토픽 자산에서 다른 토픽(공통 제외)으로 나가는 교차 참조 수. */
  outgoingCrossRefs: z.number().int().nonnegative(),
  /** 다른 토픽에서 이 토픽으로 들어오는 교차 참조 수. */
  incomingCrossRefs: z.number().int().nonnegative(),
});
export type TopicListItem = z.infer<typeof TopicListItemSchema>;

export const TopicListResponseSchema = z.object({
  items: z.array(TopicListItemSchema),
  common: z.object({
    counts: TopicAssetCountsSchema,
    outgoingCrossRefs: z.number().int().nonnegative(),
  }),
  limit: z.literal(TOPIC_LIMITS.maxPerChatbot),
});
export type TopicListResponse = z.infer<typeof TopicListResponseSchema>;

/* ------------------------------------------------------------------------------------------------
 * 소속 일괄 지정(§5.2)
 * ---------------------------------------------------------------------------------------------- */

export const TopicAssignRequestSchema = z.object({
  kind: TopicAssetKind,
  ids: z.array(z.string().uuid()).min(1).max(TOPIC_LIMITS.assignMaxIds),
  topicId: z.string().uuid().nullable(),
});
export type TopicAssignRequestDto = z.infer<typeof TopicAssignRequestSchema>;

export const TopicAssignResultSchema = z.object({
  kind: TopicAssetKind,
  requested: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
  unchanged: z.number().int().nonnegative(),
  targetTopicEnabled: z.boolean().nullable(),
});
export type TopicAssignResult = z.infer<typeof TopicAssignResultSchema>;

/* ------------------------------------------------------------------------------------------------
 * 참조 그래프(§7.1)
 * ---------------------------------------------------------------------------------------------- */

export const TopicRefEdge = z.enum([
  'NODE_INTENT',
  'NODE_KEYWORD',
  'NODE_CONTEXT',
  'NODE_MOVE',
  'NODE_BUTTON',
  'NODE_API_BRANCH',
  'NODE_SURVEY_COMPLETE',
  'NODE_OUTPUT_CONTEXT',
  'NODE_SURVEY',
  'NODE_OUTPUT_OTHER',
  'HOMONYM_INTENT',
  'CONTEXT_SLOT_KEYWORD',
  'HANDOFF_END_BUTTON',
]);
export type TopicRefEdge = z.infer<typeof TopicRefEdge>;

export const TopicRefEndpointSchema = z.object({
  kind: z.union([TopicAssetKind, z.literal('SURVEY'), z.literal('HANDOFF_SETTING')]),
  id: z.string(),
  name: z.string(),
  topicId: z.string().uuid().nullable(),
  topicName: z.string(),
  topicEnabled: z.boolean(),
});
export type TopicRefEndpoint = z.infer<typeof TopicRefEndpointSchema>;

export const TopicRefSchema = z.object({
  edge: TopicRefEdge,
  from: TopicRefEndpointSchema,
  to: TopicRefEndpointSchema,
});
export type TopicRef = z.infer<typeof TopicRefSchema>;

/* ------------------------------------------------------------------------------------------------
 * 영향 미리보기(§7.4)
 * ---------------------------------------------------------------------------------------------- */

export const TopicImpactQuerySchema = z.object({
  action: z.enum(['ENABLE', 'DISABLE']),
});
export type TopicImpactQuery = z.infer<typeof TopicImpactQuerySchema>;

export const TopicImpactPreviewSchema = z.object({
  topicId: z.string().uuid(),
  action: z.enum(['ENABLE', 'DISABLE']),
  alreadyInState: z.boolean(),
  entryPoints: z.object({
    dialogNodes: z.number().int().nonnegative(),
    intents: z.number().int().nonnegative(),
    faqs: z.number().int().nonnegative(),
  }),
  brokenRefs: z.object({
    total: z.number().int().nonnegative(),
    items: z.array(TopicRefSchema).max(TOPIC_LIMITS.impactRefsTop),
  }),
  duplicateExamples: z.object({
    total: z.number().int().nonnegative(),
    items: z
      .array(z.object({ example: z.string(), intentId: z.string().uuid(), intentName: z.string(), topicName: z.string() }))
      .max(TOPIC_LIMITS.impactRefsTop),
  }),
  liveEntryPointsAfter: z.number().int().nonnegative(),
  pendingRestoreSchedules: z.number().int().nonnegative(),
});
export type TopicImpactPreview = z.infer<typeof TopicImpactPreviewSchema>;

/* ------------------------------------------------------------------------------------------------
 * 분리(§9)
 * ---------------------------------------------------------------------------------------------- */

export const TopicSplitSelectionSchema = z
  .object({
    topicIds: z.array(z.string().uuid()).max(TOPIC_LIMITS.maxPerChatbot).default([]),
    includeCommon: z.boolean().default(false),
    systemNodeLinks: z.enum(['TRIM', 'FOLLOW']).default('TRIM'),
  })
  .refine((v) => v.topicIds.length > 0 || v.includeCommon, {
    message: '토픽을 1개 이상 선택하거나 공통을 포함해 주세요.',
    path: ['topicIds'],
  });
export type TopicSplitSelection = z.infer<typeof TopicSplitSelectionSchema>;

/** 선택(§9.2) + `CopyChatbotSchema`(`chatbot.ts`)와 같은 대상 필드(§9.7 — `ChatbotCopyTargetService` 공유 규칙과 대칭). */
export const TopicSplitRequestSchema = z
  .object({
    topicIds: z.array(z.string().uuid()).max(TOPIC_LIMITS.maxPerChatbot).default([]),
    includeCommon: z.boolean().default(false),
    systemNodeLinks: z.enum(['TRIM', 'FOLLOW']).default('TRIM'),
    name: DialogueNameSchema.optional(),
    slug: SlugSchema.optional(),
    targetGroupId: z.string().uuid().optional(),
  })
  .refine((v) => v.topicIds.length > 0 || v.includeCommon, {
    message: '토픽을 1개 이상 선택하거나 공통을 포함해 주세요.',
    path: ['topicIds'],
  });
export type TopicSplitRequestDto = z.infer<typeof TopicSplitRequestSchema>;

export const TopicSplitCountsSchema = TopicAssetCountsSchema.extend({
  surveys: z.number().int().nonnegative(),
  intentExamples: z.number().int().nonnegative(),
  nodeIntentLinks: z.number().int().nonnegative(),
  nodeKeywordLinks: z.number().int().nonnegative(),
});
export type TopicSplitCounts = z.infer<typeof TopicSplitCountsSchema>;

export const TopicSplitClosureItemSchema = z.object({
  kind: z.union([TopicAssetKind, z.literal('SURVEY')]),
  id: z.string(),
  name: z.string(),
});
export type TopicSplitClosureItem = z.infer<typeof TopicSplitClosureItemSchema>;

export const TopicSplitTrimmedLinkSchema = z.object({
  nodeId: z.string(),
  nodeName: z.string(),
  edge: TopicRefEdge,
  targetName: z.string(),
  targetTopicName: z.string(),
  /** [신규 — M-2 코드리뷰 대응] "빈 결과" 보정으로 트림 대신 따라가게 된 `followedSystemLinks` 항목에만
   * 존재한다(§9.3). 프런트는 이 값이 있으면 "잘라내면 출력이 없어져 대신 따라갔습니다" 문구를 표시한다. */
  reason: z.literal('TRIM_WOULD_EMPTY').optional(),
});
export type TopicSplitTrimmedLink = z.infer<typeof TopicSplitTrimmedLinkSchema>;

export const NotCopiedKey = z.enum([
  'CHANNELS',
  'ANSWER_SETTING',
  'HANDOFF_SETTING',
  'CANNED_RESPONSES',
  'TEST_CASE_SETS',
  'UNANSWERED_QUESTIONS',
  'AUGMENTATION_SUGGESTIONS',
  'CLASSIFIER',
  'CONVERSATION_LOGS',
  'VERSIONS',
  'DEPLOY_SCHEDULES',
  'EMBEDDING_VECTORS',
  'SURVEY_RESPONSES',
]);
export type NotCopiedKey = z.infer<typeof NotCopiedKey>;

export const TopicSplitPreviewSchema = z.object({
  selected: TopicSplitCountsSchema,
  closureAdded: TopicSplitCountsSchema,
  closureItems: z.object({ total: z.number().int().nonnegative(), items: z.array(TopicSplitClosureItemSchema).max(TOPIC_LIMITS.splitListTop) }),
  systemNodes: z.object({ start: z.boolean(), fallback: z.boolean() }),
  trimmedLinks: z.object({ total: z.number().int().nonnegative(), items: z.array(TopicSplitTrimmedLinkSchema).max(TOPIC_LIMITS.splitListTop) }),
  followedSystemLinks: z.object({ total: z.number().int().nonnegative(), items: z.array(TopicSplitTrimmedLinkSchema).max(TOPIC_LIMITS.splitListTop) }),
  totals: TopicSplitCountsSchema,
  limits: TopicSplitCountsSchema,
  exceeded: z.array(z.string()),
  closureDominates: z.boolean(),
  apiConnectionsKept: z.number().int().nonnegative(),
  notCopied: z.array(NotCopiedKey),
});
export type TopicSplitPreview = z.infer<typeof TopicSplitPreviewSchema>;

export const TopicSplitResultSchema = z.object({
  chatbot: ChatbotSchema,
  totals: TopicSplitCountsSchema,
  closureAdded: TopicSplitCountsSchema,
  trimmedLinks: z.number().int().nonnegative(),
  surveysCopied: z.number().int().nonnegative(),
  capturedAt: z.coerce.date(),
  designCheck: z.object({ error: z.number().int().nonnegative(), warning: z.number().int().nonnegative(), info: z.number().int().nonnegative() }),
  reindexScheduled: z.literal(true),
  notCopied: z.array(NotCopiedKey),
});
export type TopicSplitResult = z.infer<typeof TopicSplitResultSchema>;
