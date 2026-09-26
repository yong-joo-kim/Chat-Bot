import { z } from 'zod';
import { PaginationQuerySchema, csvEnumArray, csvUuidArray, paginated, queryBoolean } from './common';
import { ChannelType } from './channel';
import { ButtonActionSchema } from './dialogue-engine';
import { DialogOutputSchema } from './dialogue';
import { BundleTargetSchema } from './bundle-target';

/**
 * 옴니채널 통합 인박스(No.42) 계약 — `docs/02-spec/omnichannel-inbox-설계.md` §4.1.
 * `common.ts`·`channel.ts`·`conversation.ts`(타입 전용 — 순환 방지를 위해 여기서는 import하지 않는다)만 의존한다.
 */

export const InboxSourceFamily = z.enum(['DEPLOY', 'RECORD', 'SIMULATED']);
export type InboxSourceFamily = z.infer<typeof InboxSourceFamily>;

export const RecordChannel = z.enum(['PHONE', 'EMAIL', 'VISIT', 'OTHER']);
export type RecordChannel = z.infer<typeof RecordChannel>;
export const RECORD_CHANNEL_LABELS: Record<RecordChannel, string> = { PHONE: '전화', EMAIL: '이메일', VISIT: '방문', OTHER: '기타' };

export const RecordDirection = z.enum(['INBOUND', 'OUTBOUND']);
export type RecordDirection = z.infer<typeof RecordDirection>;
export const RecordOutcome = z.enum(['RESOLVED', 'FOLLOW_UP']);
export type RecordOutcome = z.infer<typeof RecordOutcome>;

export const CustomerKind = z.enum(['IDENTIFIED', 'ANONYMOUS', 'TEST']);
export type CustomerKind = z.infer<typeof CustomerKind>;
export const CustomerStatus = z.enum(['ACTIVE', 'MERGED']);
export type CustomerStatus = z.infer<typeof CustomerStatus>;
export const CustomerLinkSource = z.enum(['IDENTITY', 'MANUAL', 'SYSTEM']);
export type CustomerLinkSource = z.infer<typeof CustomerLinkSource>;

export const InboxThreadStatus = z.enum(['OPEN', 'PENDING', 'CLOSED']);
export type InboxThreadStatus = z.infer<typeof InboxThreadStatus>;
export const InboxOpenReason = z.enum(['HANDOFF', 'WARNING', 'RECORD', 'NOTE', 'MANUAL', 'SIMULATION']);
export type InboxOpenReason = z.infer<typeof InboxOpenReason>;
export const InboxEntryKind = z.enum(['NOTE', 'RECORD', 'SIM_USER', 'SIM_BOT', 'SYSTEM']);
export type InboxEntryKind = z.infer<typeof InboxEntryKind>;
export const InboxSystemEvent = z.enum([
  'OPENED',
  'STATUS',
  'ASSIGNEE',
  'TAGS',
  'LINKED',
  'UNLINKED',
  'IDENTITY_BLOCKED',
  'MERGED_IN',
  'MERGE_REVERTED',
  'PROMOTED',
]);
export type InboxSystemEvent = z.infer<typeof InboxSystemEvent>;

export const IdentityFailureReason = z.enum(['MALFORMED', 'SIGNATURE', 'EXPIRED', 'NOT_YET_VALID', 'TTL_TOO_LONG', 'SECRET_MISSING', 'CONFLICT']);
export type IdentityFailureReason = z.infer<typeof IdentityFailureReason>;

export const IdentitySecretStatus = z.enum(['NOT_SET', 'CONFIGURED', 'MISSING', 'WEAK']);
export type IdentitySecretStatus = z.infer<typeof IdentitySecretStatus>;

export const CustomerMergeKind = z.enum(['MANUAL', 'IDENTITY_PROMOTION']);
export type CustomerMergeKind = z.infer<typeof CustomerMergeKind>;

/** ≤40 · 연속 밑줄 금지(`__PREV` 접미와 충돌하지 않게). */
export const IDENTITY_SPACE_REF_PATTERN = /^[A-Z0-9]+(?:_[A-Z0-9]+)*$/;
export const IdentitySpaceRefSchema = z.string().max(40).regex(IDENTITY_SPACE_REF_PATTERN, '대문자·숫자·밑줄(연속 금지)만 사용할 수 있습니다.');

export const INBOX_LIMITS = {
  tagsGlobalMax: 100,
  tagsPerThreadMax: 10,
  tagNameMax: 20,
  noteTextMax: 2000,
  recordTextMax: 4000,
  recordPastDays: 7,
  recordFutureSlackSec: 60,
  snoozeMaxDays: 30,
  listPageSizeMax: 50,
  timelinePageSize: 50,
  sessionTurnsMax: 200,
  /** [코드리뷰 R2 반영 M-6] 타임라인 대화 단위당 상담 메시지 상한(§9.2 item 3 — `sessionTurnsMax`와 같은 방식). */
  handoffMessagesPerSessionMax: 200,
  cardSessionsMax: 200,
  displayNameMax: 40,
  noteEditWindowMinutes: 10,
  simulationMessageMax: 1000,
  identityHeaderMaxBytes: 2048,
  searchResultsMax: 50,
  manualLinkLookbackHours: 24,
  participationCacheTtlMs: 30_000,
  identitySessionCacheMax: 20_000,
  identitySessionCacheTtlMs: 30 * 60_000,
} as const;

/* ── 목록 · 요약 ── */

export const InboxThreadListItemSchema = z.object({
  threadId: z.string().uuid(),
  version: z.number().int(),
  customer: z.object({
    id: z.string().uuid(),
    alias: z.string(),
    displayName: z.string().optional(),
    kind: CustomerKind,
    identityPurged: z.literal(true).optional(),
  }),
  status: InboxThreadStatus,
  snoozeUntil: z.coerce.date().optional(),
  snoozeExpired: z.literal(true).optional(),
  assignee: z.object({ id: z.string(), name: z.string(), active: z.boolean() }).optional(),
  tags: z.array(z.object({ id: z.string().uuid(), name: z.string(), color: z.string() })),
  lastChannel: z.object({ family: InboxSourceFamily, type: z.string(), label: z.string() }).optional(),
  lastChatbot: z.object({ id: z.string().uuid(), name: z.string() }).optional(),
  linkedConversationCount: z.number().int(),
  activeHandoffCount: z.number().int(),
  lastActivityAt: z.coerce.date(),
  lastActivityKind: z.string(),
  lastEntryPreview: z.string().optional(),
  lastEntryPurged: z.literal(true).optional(),
  noParticipatingChatbot: z.literal(true).optional(),
});
export type InboxThreadListItem = z.infer<typeof InboxThreadListItemSchema>;

export const InboxThreadListQuerySchema = PaginationQuerySchema.extend({
  pageSize: z.coerce.number().int().min(1).max(INBOX_LIMITS.listPageSizeMax).default(20),
  status: csvEnumArray(InboxThreadStatus),
  assignee: z.union([z.literal('ME'), z.literal('NONE'), z.string().uuid()]).optional(),
  chatbotIds: csvUuidArray(),
  channelFamily: csvEnumArray(InboxSourceFamily),
  tagIds: csvUuidArray(),
  customerKinds: csvEnumArray(CustomerKind),
  includeTest: queryBoolean().default(false),
  activeHandoff: queryBoolean().default(false),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
export type InboxThreadListQuery = z.infer<typeof InboxThreadListQuerySchema>;

export const InboxThreadListResponseSchema = paginated(InboxThreadListItemSchema).and(
  z.object({
    pollAfterMs: z.number().int().positive(),
    generatedAt: z.coerce.date(),
    participatingChatbots: z.array(z.object({ id: z.string().uuid(), name: z.string() })),
  }),
);
export type InboxThreadListResponse = z.infer<typeof InboxThreadListResponseSchema>;

export const InboxSummaryResponseSchema = z.object({
  open: z.number().int(),
  pending: z.number().int(),
  mine: z.number().int(),
  unassigned: z.number().int(),
  activeHandoff: z.number().int(),
  generatedAt: z.coerce.date(),
});
export type InboxSummaryResponse = z.infer<typeof InboxSummaryResponseSchema>;

export const InboxAssigneeItemSchema = z.object({ id: z.string().uuid(), name: z.string() });
export type InboxAssigneeItem = z.infer<typeof InboxAssigneeItemSchema>;
export const InboxAssigneeListResponseSchema = z.array(InboxAssigneeItemSchema);
export type InboxAssigneeListResponse = z.infer<typeof InboxAssigneeListResponseSchema>;

/* ── 고객 카드 ── */

export const CustomerCardSchema = z.object({
  conversations: z.object({
    total: z.number().int(),
    byChannel: z.array(z.object({ type: z.string(), label: z.string(), count: z.number().int() })),
    byChatbot: z.array(z.object({ id: z.string().uuid(), name: z.string(), count: z.number().int() })),
  }),
  firstActivityAt: z.coerce.date().nullable(),
  lastActivityAt: z.coerce.date().nullable(),
  topMatches: z.array(z.object({ kind: z.enum(['INTENT', 'FAQ']), id: z.string(), name: z.string(), count: z.number().int() })).max(3),
  unansweredTurns: z.number().int(),
  handoffs: z.object({
    count: z.number().int(),
    lastEndReason: z.string().optional(),
    lastAgentName: z.string().optional(),
    lastEndedAt: z.coerce.date().optional(),
  }),
  surveysCompleted: z.number().int(),
  negativeFeedbacks: z.number().int(),
  tags: z.array(z.object({ id: z.string().uuid(), name: z.string(), color: z.string() })),
  latestNote: z.object({ text: z.string(), authorName: z.string(), at: z.coerce.date() }).optional(),
  truncated: z.literal(true).optional(),
});
export type CustomerCard = z.infer<typeof CustomerCardSchema>;

/* ── 타임라인 ── */

export const TimelineConversationUnitSchema = z.object({
  kind: z.literal('CONVERSATION'),
  at: z.coerce.date(),
  chatbot: z.object({ id: z.string().uuid(), name: z.string() }),
  channel: z.object({ family: z.literal('DEPLOY'), type: z.string(), label: z.string() }),
  sessionRef: z.string(),
  sessionAlias: z.string(),
  /** [코드리뷰 R1 반영] 분리 버튼용 — 대상은 `CustomerLink.id`. */
  linkId: z.string().uuid(),
  linkSource: CustomerLinkSource,
  startedAt: z.coerce.date(),
  lastAt: z.coerce.date(),
  turns: z.array(
    z.object({
      at: z.coerce.date(),
      user: z.string(),
      bot: z.string(),
      answered: z.boolean(),
      handoffTurn: z.boolean(),
      blocked: z.boolean(),
      purged: z.literal(true).optional(),
    }),
  ),
  handoffs: z.array(
    z.object({
      handoffId: z.string().uuid(),
      status: z.string(),
      startedAt: z.coerce.date(),
      endedAt: z.coerce.date().optional(),
      endReason: z.string().optional(),
      agentName: z.string(),
      messages: z.array(z.object({ at: z.coerce.date(), sender: z.enum(['USER', 'AGENT', 'SYSTEM']), text: z.string(), purged: z.literal(true).optional() })),
      /** [코드리뷰 R2 반영 M-6] 이 상담의 메시지가 `handoffMessagesPerSessionMax`로 잘렸다. */
      truncated: z.literal(true).optional(),
    }),
  ),
  truncated: z.literal(true).optional(),
});
export type TimelineConversationUnit = z.infer<typeof TimelineConversationUnitSchema>;

export const TimelineEntryUnitSchema = z.object({
  kind: InboxEntryKind,
  at: z.coerce.date(),
  entryId: z.string().uuid(),
  text: z.string(),
  purged: z.literal(true).optional(),
  recordChannel: RecordChannel.optional(),
  direction: RecordDirection.optional(),
  outcome: RecordOutcome.optional(),
  simulated: z.object({ channel: z.string(), channelLabel: z.string(), chatbot: z.object({ id: z.string(), name: z.string() }) }).optional(),
  system: z.object({ event: InboxSystemEvent, data: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])) }).optional(),
  author: z.object({ id: z.string(), name: z.string() }).optional(),
  editedAt: z.coerce.date().optional(),
  editable: z.boolean().optional(),
});
export type TimelineEntryUnit = z.infer<typeof TimelineEntryUnitSchema>;

export const TimelineUnitSchema = z.union([TimelineConversationUnitSchema, TimelineEntryUnitSchema]);
export type TimelineUnit = z.infer<typeof TimelineUnitSchema>;

export const InboxThreadDetailQuerySchema = z.object({ cursor: z.string().optional() });
export type InboxThreadDetailQuery = z.infer<typeof InboxThreadDetailQuerySchema>;

export const InboxThreadDetailSchema = z.object({
  thread: InboxThreadListItemSchema,
  card: CustomerCardSchema,
  timeline: z.object({ units: z.array(TimelineUnitSchema), nextCursor: z.string().nullable() }),
  activeHandoffs: z.array(z.object({ handoffId: z.string().uuid(), chatbotId: z.string().uuid(), chatbotName: z.string(), sessionRef: z.string(), agentName: z.string() })),
  /** [계약 보강] 콘솔의 되돌리기 버튼 사전 판정용 — `OMNI_MERGE_REVERT_HOURS` 설정값(시간). */
  mergeRevertHours: z.number().int(),
});
export type InboxThreadDetail = z.infer<typeof InboxThreadDetailSchema>;

/* ── 요청 스키마 ── */

export const UpdateThreadStateSchema = z
  .object({
    status: InboxThreadStatus,
    snoozeUntil: z.coerce.date().optional(),
    version: z.number().int(),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.snoozeUntil && val.status !== 'PENDING') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'snoozeUntil은 status가 PENDING일 때만 지정할 수 있습니다.', path: ['snoozeUntil'] });
    }
  });
export type UpdateThreadStateDto = z.infer<typeof UpdateThreadStateSchema>;

export const AssignThreadSchema = z.object({ userId: z.string(), version: z.number().int() }).strict();
export type AssignThreadDto = z.infer<typeof AssignThreadSchema>;

export const ReleaseThreadSchema = z.object({ version: z.number().int() }).strict();
export type ReleaseThreadDto = z.infer<typeof ReleaseThreadSchema>;

export const SetThreadTagsSchema = z
  .object({ tagIds: z.array(z.string().uuid()).max(INBOX_LIMITS.tagsPerThreadMax), version: z.number().int() })
  .strict();
export type SetThreadTagsDto = z.infer<typeof SetThreadTagsSchema>;

export const CreateNoteSchema = z.object({ text: z.string().trim().min(1).max(INBOX_LIMITS.noteTextMax) }).strict();
export type CreateNoteDto = z.infer<typeof CreateNoteSchema>;

export const UpdateNoteSchema = z.object({ text: z.string().trim().min(1).max(INBOX_LIMITS.noteTextMax) }).strict();
export type UpdateNoteDto = z.infer<typeof UpdateNoteSchema>;

export const CreateRecordSchema = z
  .object({
    recordChannel: RecordChannel,
    direction: RecordDirection,
    occurredAt: z.coerce.date(),
    text: z.string().trim().min(1).max(INBOX_LIMITS.recordTextMax),
    outcome: RecordOutcome.optional(),
  })
  .strict();
export type CreateRecordDto = z.infer<typeof CreateRecordSchema>;

export const InboxMaskPreviewSchema = z.object({ text: z.string().max(INBOX_LIMITS.recordTextMax) }).strict();
export type InboxMaskPreviewDto = z.infer<typeof InboxMaskPreviewSchema>;
export const InboxMaskPreviewResponseSchema = z.object({ masked: z.string() });
export type InboxMaskPreviewResponse = z.infer<typeof InboxMaskPreviewResponseSchema>;

export const OpenThreadFromSessionSchema = z.object({ chatbotId: z.string().uuid(), sessionRef: z.string().regex(/^[0-9a-f]{16}$/) }).strict();
export type OpenThreadFromSessionDto = z.infer<typeof OpenThreadFromSessionSchema>;
export const OpenThreadFromSessionResponseSchema = z.object({ threadId: z.string().uuid() });
export type OpenThreadFromSessionResponse = z.infer<typeof OpenThreadFromSessionResponseSchema>;

export const CustomerSearchSchema = z
  .object({
    q: z.string().trim().min(1).max(40).optional(),
    memberId: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[\x21-\x7e]+$/, '인쇄 가능한 ASCII 문자만 사용할 수 있습니다.')
      .optional(),
    identitySpaceRef: IdentitySpaceRefSchema.optional(),
    kinds: z.array(CustomerKind).optional(),
    includeTest: z.boolean().optional(),
    activeWithinDays: z.number().int().min(1).max(365).optional(),
    limit: z.number().int().min(1).max(INBOX_LIMITS.searchResultsMax).optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.memberId && !val.identitySpaceRef) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'memberId를 지정하려면 identitySpaceRef도 지정해야 합니다.', path: ['identitySpaceRef'] });
    }
  });
export type CustomerSearchDto = z.infer<typeof CustomerSearchSchema>;

export const CustomerSearchItemSchema = z.object({
  customerId: z.string().uuid(),
  alias: z.string(),
  displayName: z.string().optional(),
  kind: CustomerKind,
  identified: z.boolean(),
  identityPurged: z.literal(true).optional(),
  lastActivityAt: z.coerce.date(),
  threadId: z.string().uuid().optional(),
  threadStatus: InboxThreadStatus.optional(),
  linkedConversationCount: z.number().int(),
});
export type CustomerSearchItem = z.infer<typeof CustomerSearchItemSchema>;

export const CustomerSearchResponseSchema = z.object({
  items: z.array(CustomerSearchItemSchema),
  truncatedScan: z.literal(true).optional(),
});
export type CustomerSearchResponse = z.infer<typeof CustomerSearchResponseSchema>;

export const CreateAnonymousCustomerSchema = z.object({ displayName: z.string().trim().min(1).max(INBOX_LIMITS.displayNameMax).optional() }).strict();
export type CreateAnonymousCustomerDto = z.infer<typeof CreateAnonymousCustomerSchema>;
export const CreateAnonymousCustomerResponseSchema = z.object({ customerId: z.string().uuid(), threadId: z.string().uuid() });
export type CreateAnonymousCustomerResponse = z.infer<typeof CreateAnonymousCustomerResponseSchema>;

export const LinkSessionSchema = z.object({ chatbotId: z.string().uuid(), sessionRef: z.string().regex(/^[0-9a-f]{16}$/) }).strict();
export type LinkSessionDto = z.infer<typeof LinkSessionSchema>;

export const MergeCustomerSchema = z.object({ targetCustomerId: z.string().uuid() }).strict();
export type MergeCustomerDto = z.infer<typeof MergeCustomerSchema>;
export const MergeResultSchema = z.object({
  mergeId: z.string().uuid(),
  movedLinks: z.number().int(),
  movedEntries: z.number().int(),
  movedThread: z.boolean(),
  droppedTags: z.number().int(),
  /** [코드리뷰 R1 반영] 병합 후 대상 고객의 스레드 id(없으면 null) — 프론트 되돌리기·이동 안내용. */
  targetThreadId: z.string().uuid().nullable(),
});
export type MergeResult = z.infer<typeof MergeResultSchema>;

export const RevertMergeResultSchema = z.object({ revertedLinks: z.number().int(), skippedLinks: z.number().int(), revertedEntries: z.number().int() });
export type RevertMergeResult = z.infer<typeof RevertMergeResultSchema>;

export const SessionLinkLookupQuerySchema = z.object({ chatbotId: z.string().uuid(), sessionRef: z.string() });
export type SessionLinkLookupQuery = z.infer<typeof SessionLinkLookupQuerySchema>;
export const SessionLinkLookupResponseSchema = z.union([
  z.object({ participating: z.literal(false) }),
  z.object({ participating: z.literal(true), customer: z.null() }),
  z.object({
    participating: z.literal(true),
    customer: z.object({ id: z.string().uuid(), alias: z.string(), displayName: z.string().optional(), kind: CustomerKind }),
    threadId: z.string().uuid().optional(),
    threadStatus: InboxThreadStatus.optional(),
    cardBrief: z.object({
      conversationCount: z.number().int(),
      lastIntentName: z.string().optional(),
      handoffCount: z.number().int(),
      lastNote: z.string().optional(),
    }),
  }),
]);
export type SessionLinkLookupResponse = z.infer<typeof SessionLinkLookupResponseSchema>;

/**
 * [코드리뷰 R1 반영] 식별 공간 목록 — 참조(REF) + 그 공간을 쓰는 참여 챗봇 목록으로 확장한다(기존
 * `string[]` 계약을 깨는 변경 — 콘솔의 "누가 이 공간을 쓰는지" 표시 요구를 문자열 배열로는 담을
 * 수 없어 하위 호환 대신 형태를 바꿨다. `docs/02-spec/omnichannel-inbox-설계.md` §27 기록).
 */
export const IdentitySpaceItemSchema = z.object({
  ref: z.string(),
  chatbots: z.array(z.object({ id: z.string().uuid(), name: z.string() })),
});
export type IdentitySpaceItem = z.infer<typeof IdentitySpaceItemSchema>;

export const IdentitySpaceListResponseSchema = z.array(IdentitySpaceItemSchema);
export type IdentitySpaceListResponse = z.infer<typeof IdentitySpaceListResponseSchema>;

/* ── 태그 ── */

export const INBOX_TAG_PALETTE = ['RED', 'ORANGE', 'YELLOW', 'GREEN', 'TEAL', 'BLUE', 'PURPLE', 'GRAY'] as const;
export const InboxTagColor = z.enum(INBOX_TAG_PALETTE);
export type InboxTagColor = z.infer<typeof InboxTagColor>;

export const InboxTagCreateSchema = z.object({ name: z.string().trim().min(1).max(INBOX_LIMITS.tagNameMax), color: InboxTagColor }).strict();
export type InboxTagCreateDto = z.infer<typeof InboxTagCreateSchema>;
export const InboxTagUpdateSchema = z.object({ name: z.string().trim().min(1).max(INBOX_LIMITS.tagNameMax), color: InboxTagColor }).strict();
export type InboxTagUpdateDto = z.infer<typeof InboxTagUpdateSchema>;

export const InboxTagItemSchema = z.object({ id: z.string().uuid(), name: z.string(), color: InboxTagColor, usageCount: z.number().int() });
export type InboxTagItem = z.infer<typeof InboxTagItemSchema>;
export const InboxTagListResponseSchema = z.array(InboxTagItemSchema);
export type InboxTagListResponse = z.infer<typeof InboxTagListResponseSchema>;

export const InboxTagDeleteQuerySchema = z.object({ force: queryBoolean().default(false) });
export type InboxTagDeleteQuery = z.infer<typeof InboxTagDeleteQuerySchema>;

/* ── 시험 고객 · 시뮬레이션 ── */

export const CreateTestCustomerSchema = z.object({ label: z.string().trim().min(1).max(40) }).strict();
export type CreateTestCustomerDto = z.infer<typeof CreateTestCustomerSchema>;
export const CreateTestCustomerResponseSchema = z.object({ customerId: z.string().uuid(), threadId: z.string().uuid() });
export type CreateTestCustomerResponse = z.infer<typeof CreateTestCustomerResponseSchema>;

export const SimulateInboxSchema = z
  .object({
    chatbotId: z.string().uuid(),
    simulatedChannel: ChannelType,
    message: z.string().max(INBOX_LIMITS.simulationMessageMax).optional(),
    buttonAction: ButtonActionSchema.optional(),
    state: z.unknown().optional(),
    target: BundleTargetSchema.optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    const hasMessage = val.message !== undefined && val.message.trim().length > 0;
    const hasButton = val.buttonAction !== undefined;
    if (hasMessage === hasButton) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'message 또는 buttonAction 중 정확히 하나를 지정해 주세요.', path: ['message'] });
    }
  });
export type SimulateInboxDto = z.infer<typeof SimulateInboxSchema>;

export const SimulateInboxResponseSchema = z.object({
  outputs: z.array(DialogOutputSchema),
  state: z.unknown(),
  stateReset: z.boolean(),
  entries: z.array(TimelineEntryUnitSchema).max(2),
  degradePreview: z.literal('NOT_DEFINED'),
});
export type SimulateInboxResponse = z.infer<typeof SimulateInboxResponseSchema>;

/* ── 챗봇별 참여 설정 ── */

export const ChatbotInboxSettingsUpdateSchema = z.object({ enabled: z.boolean(), openOnWarning: z.boolean() }).strict();
export type ChatbotInboxSettingsUpdateDto = z.infer<typeof ChatbotInboxSettingsUpdateSchema>;

export const ChatbotInboxIdentityUpdateSchema = z.object({ identitySecretRef: z.union([IdentitySpaceRefSchema, z.null()]) }).strict();
export type ChatbotInboxIdentityUpdateDto = z.infer<typeof ChatbotInboxIdentityUpdateSchema>;

/**
 * [코드리뷰 R1 반영] 7종 사유 키를 항상 채운다(값 없으면 0) — 프론트가 옵셔널 체이닝 없이 7개
 * 막대를 그릴 수 있게 선택 키가 아닌 필수 키로 고정한다.
 */
export const IdentityFailureStatsSchema = z.object({
  MALFORMED: z.number().int(),
  SIGNATURE: z.number().int(),
  EXPIRED: z.number().int(),
  NOT_YET_VALID: z.number().int(),
  TTL_TOO_LONG: z.number().int(),
  SECRET_MISSING: z.number().int(),
  CONFLICT: z.number().int(),
});
export type IdentityFailureStats = z.infer<typeof IdentityFailureStatsSchema>;

export const ChatbotInboxSettingsResponseSchema = z.object({
  chatbotId: z.string().uuid(),
  enabled: z.boolean(),
  openOnWarning: z.boolean(),
  identity: z.object({
    secretRef: z.string().nullable(),
    secretStatus: IdentitySecretStatus,
    customerKeyStatus: z.enum(['CONFIGURED', 'MISSING', 'WEAK']),
    keyFingerprintChanged: z.boolean(),
    stats24h: z.object({
      verified: z.number().int(),
      failures: IdentityFailureStatsSchema,
      scope: z.literal('INSTANCE'),
    }),
  }),
  environmentNotice: z.literal('OUTSIDE_ENVIRONMENT'),
  updatedAt: z.coerce.date().nullable(),
});
export type ChatbotInboxSettingsResponse = z.infer<typeof ChatbotInboxSettingsResponseSchema>;
