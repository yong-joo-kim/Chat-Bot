import { z } from 'zod';
import { PaginationQuerySchema, csvEnumArray, paginated, queryBoolean } from './common';

/**
 * 하이브리드 CS(No.24) 관리자·공개 계약 — `hybrid-cs-설계.md` §4.1, ADR-0036.
 * 위젯은 이 파일을 참조하지 않는다(vanilla TS·zod 비번들 — 헤더/기능 문자열은
 * `apps/widget/src/constants/handoff.ts`에 복제하고 시험으로 동일성을 단언한다).
 */

export const HandoffStatus = z.enum(['CONNECTING', 'CONNECTED', 'ENDED']);
export type HandoffStatus = z.infer<typeof HandoffStatus>;

export const HandoffEndReason = z.enum(['AGENT_ENDED', 'USER_IDLE', 'AGENT_NO_REPLY', 'NOT_DELIVERED', 'CHANNEL_CLOSED']);
export type HandoffEndReason = z.infer<typeof HandoffEndReason>;

/** `USER_IDLE`은 실제로는 "양쪽 모두 10분간 침묵"이다(D-9) — 라벨은 그 의미로 고정한다. */
export const HANDOFF_END_REASON_LABELS: Record<HandoffEndReason, string> = {
  AGENT_ENDED: '상담원이 종료',
  USER_IDLE: '응답 없음으로 종료',
  AGENT_NO_REPLY: '상담원 무응답으로 종료',
  NOT_DELIVERED: '연결되지 않아 종료',
  CHANNEL_CLOSED: '채널 종료',
};

export const HandoffClientMode = z.enum(['MODERN', 'LEGACY']);
export type HandoffClientMode = z.infer<typeof HandoffClientMode>;

export const AlertLevel = z.enum(['NORMAL', 'CAUTION', 'WARNING']);
export type AlertLevel = z.infer<typeof AlertLevel>;

export const ALERT_LEVEL_LABELS: Record<AlertLevel, string> = {
  NORMAL: '정상',
  CAUTION: '주의',
  WARNING: '경고',
};

export const UnansweredReason = z.enum(['FALLBACK', 'API_NOTICE']);
export type UnansweredReason = z.infer<typeof UnansweredReason>;

export const UNANSWERED_REASON_LABELS: Record<UnansweredReason, string> = {
  FALLBACK: '답변 못함',
  API_NOTICE: '연동 실패',
};

export const HANDOFF_LIMITS = {
  cannedPerChatbot: 200,
  messageMax: 1000,
  noticeMax: 200,
  buttonLabelMax: 40,
  takeoverReasonMax: 200,
  liveListPageSize: 50,
  liveListRowCap: 20_000,
  transcriptPage: 200,
  historyMaxDays: 92,
  cannedTitleMax: 50,
  cannedBodyMax: 1000,
  cannedCategoryMax: 30,
  cannedShortcutMax: 20,
} as const;

/* ------------------------------------------------------------------------------------------------
 * 상담 연계 설정 (1:1, `ChatbotHandoffSetting`) — §3.1 · §17.1 ⑱⑲
 * ---------------------------------------------------------------------------------------------- */

export const HandoffSettingsSchema = z.object({
  chatbotId: z.string(),
  enabled: z.boolean(),
  /** 끈 시점에 활성 상담이 있으면 true — 서버가 관리한다(요청 바디에 없음). */
  draining: z.boolean(),
  cautionThreshold: z.number().int().min(1).max(10),
  warningThreshold: z.number().int().min(1).max(10),
  activeWindowMinutes: z.number().int().min(5).max(60),
  userIdleMinutes: z.number().int().min(3).max(60),
  agentNoReplyMinutes: z.number().int().min(1).max(30),
  connectNotice: z.string().max(HANDOFF_LIMITS.noticeMax),
  endNotice: z.string().max(HANDOFF_LIMITS.noticeMax),
  failNotice: z.string().max(HANDOFF_LIMITS.noticeMax),
  endButtonLabel: z.string().max(HANDOFF_LIMITS.buttonLabelMax).nullable(),
  endButtonNodeId: z.string().uuid().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type HandoffSettings = z.infer<typeof HandoffSettingsSchema>;

/** PUT 전체 교체(`ChatbotAnswerSetting` 규약) — `draining`은 서버 전용이라 요청에 없다. */
export const UpdateHandoffSettingsSchema = z
  .object({
    enabled: z.boolean(),
    cautionThreshold: z.number().int().min(1).max(10),
    warningThreshold: z.number().int().min(1).max(10),
    activeWindowMinutes: z.number().int().min(5).max(60),
    userIdleMinutes: z.number().int().min(3).max(60),
    agentNoReplyMinutes: z.number().int().min(1).max(30),
    connectNotice: z.string().trim().min(1).max(HANDOFF_LIMITS.noticeMax),
    endNotice: z.string().trim().min(1).max(HANDOFF_LIMITS.noticeMax),
    failNotice: z.string().trim().min(1).max(HANDOFF_LIMITS.noticeMax),
    endButtonLabel: z.string().trim().min(1).max(HANDOFF_LIMITS.buttonLabelMax).optional(),
    endButtonNodeId: z.string().uuid().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.warningThreshold <= val.cautionThreshold) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: '경고 임계값은 주의 임계값보다 커야 합니다.', path: ['warningThreshold'] });
    }
    const hasLabel = val.endButtonLabel !== undefined;
    const hasNode = val.endButtonNodeId !== undefined;
    if (hasLabel !== hasNode) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: '종료 후 버튼은 라벨과 노드를 함께 지정하거나 둘 다 비워야 합니다.', path: ['endButtonNodeId'] });
    }
  });
export type UpdateHandoffSettingsDto = z.infer<typeof UpdateHandoffSettingsSchema>;

/* ------------------------------------------------------------------------------------------------
 * 세션 식별자 — 관리자 경로는 `sessionRef`(챗봇별 해시 16자)만 쓴다(P-5).
 * ---------------------------------------------------------------------------------------------- */

export const SessionRefParamSchema = z.string().regex(/^[0-9a-f]{16,64}$/);

/* ------------------------------------------------------------------------------------------------
 * 진행 중 목록 (FR-CS2-*) — §10
 * ---------------------------------------------------------------------------------------------- */

export const LiveSessionListQuerySchema = z.object({
  alert: csvEnumArray(AlertLevel),
  handoff: z.enum(['NONE', 'ACTIVE', 'ENDED']).optional(),
  channel: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(HANDOFF_LIMITS.liveListPageSize),
});
export type LiveSessionListQuery = z.infer<typeof LiveSessionListQuerySchema>;

export const LiveSessionHandoffBriefSchema = z.object({
  id: z.string().uuid(),
  status: HandoffStatus,
  assignedUserName: z.string(),
  isMine: z.boolean(),
  clientMode: HandoffClientMode.optional(),
  unverifiedAttemptCount: z.number().int().nonnegative(),
  idleSeconds: z.number().int().nonnegative(),
});

/** ⚠ `sessionId` 키가 없다 — 타입으로 봉인한다(P-5, §18 H-17). */
export const LiveSessionRowSchema = z.object({
  sessionRef: z.string(),
  alias: z.string(),
  channelType: z.string(),
  firstAt: z.coerce.date(),
  lastAt: z.coerce.date(),
  turnCount: z.number().int().nonnegative(),
  consecutiveUnanswered: z.number().int().nonnegative(),
  windowUnanswered: z.number().int().nonnegative(),
  blockedCount: z.number().int().nonnegative(),
  alertLevel: AlertLevel,
  lastUserText: z.string(),
  /** [신규 No.45] 마지막 사용자 발화(`lastUserText`)가 보존기간 경과로 소거된 행일 때만(true) — ui-spec §3.7. */
  lastUserTextPurged: z.literal(true).optional(),
  lastUnansweredReason: UnansweredReason.optional(),
  handoff: LiveSessionHandoffBriefSchema.optional(),
  handoffSupported: z.boolean(),
});
export type LiveSessionRow = z.infer<typeof LiveSessionRowSchema>;

export const LiveSessionListResponseSchema = paginated(LiveSessionRowSchema).and(
  z.object({
    summary: z.object({
      live: z.number().int().nonnegative(),
      warning: z.number().int().nonnegative(),
      caution: z.number().int().nonnegative(),
      handoffActive: z.number().int().nonnegative(),
    }),
    truncated: z.boolean(),
    windowMinutes: z.number().int().positive(),
    handoffEnabled: z.boolean(),
    generatedAt: z.coerce.date(),
  }),
);
export type LiveSessionListResponse = z.infer<typeof LiveSessionListResponseSchema>;

/* ------------------------------------------------------------------------------------------------
 * 대화 보기 (FR-CS3-*) — §11. 원문 노출 출구는 이 응답 1개뿐이다.
 * ---------------------------------------------------------------------------------------------- */

export const TranscriptQuerySchema = z.object({
  cursor: z.string().optional(),
  includeRaw: queryBoolean(),
});
export type TranscriptQuery = z.infer<typeof TranscriptQuerySchema>;

export const TranscriptAnsweredBySchema = z.object({
  kind: z.enum(['NODE', 'FAQ', 'RAG']),
  name: z.string().optional(),
});

export const TranscriptBotTurnSchema = z.object({
  kind: z.literal('BOT_TURN'),
  logId: z.string(),
  at: z.coerce.date(),
  userText: z.string(),
  botText: z.string(),
  isAnswered: z.boolean(),
  blocked: z.boolean(),
  answeredBy: TranscriptAnsweredBySchema.optional(),
  unansweredReason: UnansweredReason.optional(),
  /** [신규 No.45] 보존기간 경과로 소거된 행일 때만(true). */
  purged: z.literal(true).optional(),
});

/** ★ `rawText`는 이 스키마에서만 등장한다(§9.3) — 키가 아예 없으면 직렬화되지 않는다(optional). */
export const TranscriptHandoffEntrySchema = z.object({
  kind: z.literal('HANDOFF'),
  messageId: z.string(),
  handoffId: z.string(),
  seq: z.number().int().positive(),
  at: z.coerce.date(),
  sender: z.enum(['USER', 'AGENT', 'SYSTEM']),
  systemKind: z.enum(['CONNECTED', 'ENDED', 'FAILED']).optional(),
  text: z.string(),
  rawText: z.string().optional(),
  senderName: z.string().optional(),
  /** [신규 No.45] 보존기간 경과로 소거된 행일 때만(true). */
  purged: z.literal(true).optional(),
});

export const TranscriptEntrySchema = z.discriminatedUnion('kind', [TranscriptBotTurnSchema, TranscriptHandoffEntrySchema]);
export type TranscriptEntry = z.infer<typeof TranscriptEntrySchema>;

export const HandoffBriefSchema = z.object({
  id: z.string().uuid(),
  alias: z.string(),
  status: HandoffStatus,
  endReason: HandoffEndReason.nullable(),
  clientMode: HandoffClientMode.nullable(),
  assignedUserName: z.string(),
  /** [코드리뷰 1회차 반영] `assignedUserId === 요청자.id` — 서버가 계산해 채운다(관리자 응답에
   * 전체 `sessionId`는 없지만 "내 상담인지"는 담당자 UI 판정에 필요하다). */
  isMine: z.boolean(),
  /** [코드리뷰 2회차 M-2] 상담 설정의 "종료 후 이동 버튼" 라벨 스냅샷 — 설정에 없으면 null.
   * Brief에 있어야 2초 폴링(진행 중 목록·대화 보기)에서도 제공된다(Detail은 Brief를 extend하므로
   * 중복 정의하지 않는다). */
  endButtonLabel: z.string().nullable(),
  startedAt: z.coerce.date(),
  connectedAt: z.coerce.date().nullable(),
  endedAt: z.coerce.date().nullable(),
  userMessageCount: z.number().int().nonnegative(),
  agentMessageCount: z.number().int().nonnegative(),
  unverifiedAttemptCount: z.number().int().nonnegative(),
});
export type HandoffBrief = z.infer<typeof HandoffBriefSchema>;

export const HandoffDetailSchema = HandoffBriefSchema.extend({
  channelType: z.string(),
  startedByName: z.string(),
  alertLevelAtStart: AlertLevel,
  consecutiveUnansweredAtStart: z.number().int().nonnegative(),
  firstAgentReplyAt: z.coerce.date().nullable(),
});
export type HandoffDetail = z.infer<typeof HandoffDetailSchema>;

/** [코드리뷰 1회차 반영] 개입(intervene) 응답 전용 — 관찰 창 밖에서 개입해 전달이 다음 사용자
 * 발화까지 보류되면 true다(EX-CS-3). `HandoffDetailSchema`에 넣지 않는다 — 전송·종료·인수
 * 응답에는 의미가 없는 필드다. */
export const InterveneHandoffResponseSchema = HandoffDetailSchema.extend({
  watchWindowMissed: z.boolean(),
});
export type InterveneHandoffResponse = z.infer<typeof InterveneHandoffResponseSchema>;

export const TranscriptResponseSchema = z.object({
  entries: z.array(TranscriptEntrySchema),
  nextCursor: z.string().nullable(),
  handoff: HandoffBriefSchema.nullable(),
  rawVisible: z.boolean(),
  blockedDuringHandoff: z.number().int().nonnegative(),
});
export type TranscriptResponse = z.infer<typeof TranscriptResponseSchema>;

/* ------------------------------------------------------------------------------------------------
 * 응답힌트 (P-10) — §12
 * ---------------------------------------------------------------------------------------------- */

export const HintAnswerItemSchema = z.object({
  kind: z.enum(['FAQ', 'INTENT']),
  refName: z.string(),
  text: z.string(),
  score: z.number(),
});
export type HintAnswerItem = z.infer<typeof HintAnswerItemSchema>;

export const HintCannedItemSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  body: z.string(),
  category: z.string().nullable().optional(),
  score: z.number(),
});
export type HintCannedItem = z.infer<typeof HintCannedItemSchema>;

export const HintResponseSchema = z.object({
  source: z.object({ key: z.string(), text: z.string() }).nullable(),
  mode: z.enum(['SEMANTIC', 'LEXICAL']),
  answers: z.array(HintAnswerItemSchema).max(3),
  canned: z.array(HintCannedItemSchema).max(3),
});
export type HintResponse = z.infer<typeof HintResponseSchema>;

/* ------------------------------------------------------------------------------------------------
 * 개입 동작 — 전송·종료·인수·마스킹 미리보기 (§17.1 ⑤~⑧)
 * ---------------------------------------------------------------------------------------------- */

export const SendAgentMessageSchema = z.object({ text: z.string().trim().min(1).max(HANDOFF_LIMITS.messageMax) });
export type SendAgentMessageDto = z.infer<typeof SendAgentMessageSchema>;

export const SendAgentMessageResponseSchema = z.object({
  seq: z.number().int().positive(),
  text: z.string(),
  masked: z.boolean(),
});
export type SendAgentMessageResponse = z.infer<typeof SendAgentMessageResponseSchema>;

export const TakeoverHandoffSchema = z.object({ reason: z.string().trim().min(1).max(HANDOFF_LIMITS.takeoverReasonMax) });
export type TakeoverHandoffDto = z.infer<typeof TakeoverHandoffSchema>;

export const MaskPreviewRequestSchema = z.object({ text: z.string().trim().min(1).max(HANDOFF_LIMITS.messageMax) });
export type MaskPreviewRequestDto = z.infer<typeof MaskPreviewRequestSchema>;

export const MaskPreviewResponseSchema = z.object({ maskedText: z.string(), changed: z.boolean() });
export type MaskPreviewResponse = z.infer<typeof MaskPreviewResponseSchema>;

/* ------------------------------------------------------------------------------------------------
 * 상담 이력 · 요약 (P-15) — §13
 * ---------------------------------------------------------------------------------------------- */

const DayBucketSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const HandoffHistoryQuerySchema = PaginationQuerySchema.extend({
  from: DayBucketSchema,
  to: DayBucketSchema,
  status: HandoffStatus.optional(),
  assignedUserId: z.string().uuid().optional(),
  endReason: HandoffEndReason.optional(),
});
export type HandoffHistoryQuery = z.infer<typeof HandoffHistoryQuerySchema>;

export const HandoffHistoryItemSchema = z.object({
  id: z.string().uuid(),
  alias: z.string(),
  /** [코드리뷰 R1 반영 — No.42 연계] computeSessionRef 결과(16 hex) — sessionId 자체는 아니다(H-17 불변). */
  sessionRef: z.string(),
  startedAt: z.coerce.date(),
  connectedAt: z.coerce.date().nullable(),
  endedAt: z.coerce.date().nullable(),
  assignedUserName: z.string(),
  endReason: HandoffEndReason.nullable(),
  userMessageCount: z.number().int().nonnegative(),
  agentMessageCount: z.number().int().nonnegative(),
  firstResponseSec: z.number().nonnegative().nullable(),
  alertLevelAtStart: AlertLevel,
  clientMode: HandoffClientMode.nullable(),
});
export type HandoffHistoryItem = z.infer<typeof HandoffHistoryItemSchema>;

export const HandoffSummaryResponseSchema = z.object({
  count: z.number().int().nonnegative(),
  connectedCount: z.number().int().nonnegative(),
  avgFirstResponseSec: z.number().nonnegative().nullable(),
  firstResponseSamples: z.number().int().nonnegative(),
  avgDurationSec: z.number().nonnegative().nullable(),
  durationSamples: z.number().int().nonnegative(),
  endReasonCounts: z.record(z.string(), z.number().int().nonnegative()),
});
export type HandoffSummaryResponse = z.infer<typeof HandoffSummaryResponseSchema>;

export const HandoffHistoryDetailResponseSchema = z.object({
  handoff: HandoffHistoryItemSchema,
  entries: z.array(TranscriptEntrySchema),
});
export type HandoffHistoryDetailResponse = z.infer<typeof HandoffHistoryDetailResponseSchema>;

/* ------------------------------------------------------------------------------------------------
 * 자주 쓰는 문장 (P-11) — §12.3 · §17.1 ⑬~⑰
 * ---------------------------------------------------------------------------------------------- */

export const CannedResponseSchema = z.object({
  id: z.string().uuid(),
  chatbotId: z.string(),
  title: z.string(),
  body: z.string(),
  category: z.string().nullable(),
  shortcut: z.string().nullable(),
  sortOrder: z.number().int(),
  enabled: z.boolean(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type CannedResponse = z.infer<typeof CannedResponseSchema>;

const CannedShortcutSchema = z
  .string()
  .trim()
  .max(HANDOFF_LIMITS.cannedShortcutMax)
  .regex(/^[A-Za-z0-9가-힣_-]+$/, '영문/숫자/한글/밑줄/하이픈만 사용할 수 있습니다.');

export const CreateCannedResponseSchema = z.object({
  title: z.string().trim().min(1).max(HANDOFF_LIMITS.cannedTitleMax),
  body: z.string().trim().min(1).max(HANDOFF_LIMITS.cannedBodyMax),
  category: z.string().trim().min(1).max(HANDOFF_LIMITS.cannedCategoryMax).optional(),
  shortcut: CannedShortcutSchema.optional(),
  enabled: z.boolean().default(true),
});
export type CreateCannedResponseDto = z.infer<typeof CreateCannedResponseSchema>;

export const UpdateCannedResponseSchema = z.object({
  title: z.string().trim().min(1).max(HANDOFF_LIMITS.cannedTitleMax).optional(),
  body: z.string().trim().min(1).max(HANDOFF_LIMITS.cannedBodyMax).optional(),
  category: z.string().trim().min(1).max(HANDOFF_LIMITS.cannedCategoryMax).nullable().optional(),
  shortcut: CannedShortcutSchema.nullable().optional(),
  enabled: z.boolean().optional(),
});
export type UpdateCannedResponseDto = z.infer<typeof UpdateCannedResponseSchema>;

export const MoveCannedResponseSchema = z.object({ direction: z.enum(['UP', 'DOWN']) });
export type MoveCannedResponseDto = z.infer<typeof MoveCannedResponseSchema>;

export const CannedResponseListQuerySchema = z.object({
  q: z.string().trim().min(1).max(100).optional(),
  category: z.string().trim().min(1).max(HANDOFF_LIMITS.cannedCategoryMax).optional(),
  enabled: queryBoolean(),
});
export type CannedResponseListQuery = z.infer<typeof CannedResponseListQuerySchema>;

/* ------------------------------------------------------------------------------------------------
 * 상담 콘솔 — 챗봇 선택기 (§17.1 ⑳)
 * ---------------------------------------------------------------------------------------------- */

export const HandoffConsoleChatbotItemSchema = z.object({
  chatbotId: z.string(),
  name: z.string(),
  status: z.string(),
  handoffEnabled: z.boolean(),
  activeHandoffCount: z.number().int().nonnegative(),
});
export type HandoffConsoleChatbotItem = z.infer<typeof HandoffConsoleChatbotItemSchema>;

export const HandoffConsoleResponseSchema = z.object({
  items: z.array(HandoffConsoleChatbotItemSchema),
  myActiveCount: z.number().int().nonnegative(),
});
export type HandoffConsoleResponse = z.infer<typeof HandoffConsoleResponseSchema>;
