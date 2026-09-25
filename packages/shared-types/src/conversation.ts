import { z } from 'zod';
import {
  CreateContextSchema,
  CreateDialogNodeSchema,
  CreateFaqSchema,
  CreateHomonymSchema,
  CreateIntentSchema,
  CreateKeywordSchema,
  DialogOutputSchema,
} from './dialogue';
import { ButtonActionSchema, ConversationStateSchema, DialogueResolutionSchema, StateDiscardReason } from './dialogue-engine';
import { ChatbotSkinSchema } from './chatbot';
import { ThresholdPreviewCandidateSchema } from './answering';
import { SimulateApiMode, SimulateMockResponseSchema, ApiStepViewSchema } from './legacy-api';
import { queryBoolean } from './common';
import { FeedbackRating } from './feedback';
import { BundleTargetSchema, ResolvedBundleTargetSchema } from './bundle-target';

/** [신규 No.22] 답한 자산의 토픽(§6.5) — 관리자 API(시뮬레이터·비교) 전용. 공개 응답에는 존재하지 않는다. */
export const SimulatedAnsweredTopicSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  enabled: z.boolean(),
});
export type SimulatedAnsweredTopic = z.infer<typeof SimulatedAnsweredTopicSchema>;

/**
 * 대화 1턴 처리(시뮬레이션/비교/공개 대화) 계약 — `quality-channel-설계.md` §4.2.
 * 의존 방향: `conversation.ts → {dialogue-engine.ts, dialogue.ts, chatbot.ts, common.ts}` 단방향.
 */

/* ------------------------------------------------------------------------------------------------
 * 오버레이(FR-10-18~24) — 저장하지 않은 편집 상태를 저장본에 덧씌워 테스트한다.
 * ---------------------------------------------------------------------------------------------- */

export const OVERLAY_LIMITS = { perKind: 20, bodyBytes: 1_048_576 } as const;
export const COMPARE_LIMITS = { messages: 20, messageLength: 1000 } as const;

/** 신규 항목은 `draft-` 접두 임시 id를 쓴다(FR-10-19 ②). 기존 항목 교체는 실제 uuid를 쓴다. */
const OverlayIdSchema = z
  .string()
  .refine((v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v) || v.startsWith('draft-'), {
    message: '식별자는 UUID이거나 draft- 접두 임시 id여야 합니다.',
  });

export const OverlayIntentSchema = z.object({ id: OverlayIdSchema }).and(CreateIntentSchema);
export const OverlayKeywordSchema = z.object({ id: OverlayIdSchema }).and(CreateKeywordSchema);
export const OverlayHomonymSchema = z.object({ id: OverlayIdSchema }).and(CreateHomonymSchema);
export const OverlayContextSchema = z.object({ id: OverlayIdSchema }).and(CreateContextSchema);
export const OverlayFaqSchema = z.object({ id: OverlayIdSchema }).and(CreateFaqSchema);
export const OverlayDialogNodeSchema = z.object({ id: OverlayIdSchema }).and(CreateDialogNodeSchema);

export const DialogueOverlayDeletedIdsSchema = z.object({
  dialogNodes: z.array(z.string()).max(OVERLAY_LIMITS.perKind).optional(),
  intents: z.array(z.string()).max(OVERLAY_LIMITS.perKind).optional(),
  keywords: z.array(z.string()).max(OVERLAY_LIMITS.perKind).optional(),
  homonyms: z.array(z.string()).max(OVERLAY_LIMITS.perKind).optional(),
  contexts: z.array(z.string()).max(OVERLAY_LIMITS.perKind).optional(),
  faqs: z.array(z.string()).max(OVERLAY_LIMITS.perKind).optional(),
});

export const DialogueOverlaySchema = z.object({
  dialogNodes: z.array(OverlayDialogNodeSchema).max(OVERLAY_LIMITS.perKind).optional(),
  intents: z.array(OverlayIntentSchema).max(OVERLAY_LIMITS.perKind).optional(),
  keywords: z.array(OverlayKeywordSchema).max(OVERLAY_LIMITS.perKind).optional(),
  homonyms: z.array(OverlayHomonymSchema).max(OVERLAY_LIMITS.perKind).optional(),
  contexts: z.array(OverlayContextSchema).max(OVERLAY_LIMITS.perKind).optional(),
  faqs: z.array(OverlayFaqSchema).max(OVERLAY_LIMITS.perKind).optional(),
  deletedIds: DialogueOverlayDeletedIdsSchema.optional(),
});
export type DialogueOverlay = z.infer<typeof DialogueOverlaySchema>;

export function isOverlayEmpty(overlay: DialogueOverlay): boolean {
  const kinds = ['dialogNodes', 'intents', 'keywords', 'homonyms', 'contexts', 'faqs'] as const;
  const hasItems = kinds.some((k) => (overlay[k]?.length ?? 0) > 0);
  const hasDeletes = kinds.some((k) => (overlay.deletedIds?.[k]?.length ?? 0) > 0);
  return !hasItems && !hasDeletes;
}

/* ------------------------------------------------------------------------------------------------
 * No.10 실시간 테스트/미리보기 — FR-10-1~24
 * ---------------------------------------------------------------------------------------------- */

export const SimulateRequestSchema = z
  .object({
    message: z.string().max(1000).optional(),
    buttonAction: ButtonActionSchema.optional(),
    // ⚠ `ConversationStateSchema`로 엄격 검증하지 않는다 — 봉투 검증 실패는 400이 아니라
    // "폐기 + 새 대화"로 처리해야 한다(FR-10-4 ①). 실제 재검증은 엔진의
    // `sanitizeConversationState`(`resolveTurn` 내부)가 전담한다.
    state: z.unknown().optional(),
    overlay: DialogueOverlaySchema.optional(),
    /** [신규] 명시적으로 켤 때만 2단계(RAG)를 실행한다(FR-N2-3). 기본 false — 외부 호출·비용을 무심코 소모하지 않는다. */
    useRag: z.boolean().default(false),
    /** [No.26 신설] 외부 API 호출 모드. 조건 불충족 시 서비스가 MOCK으로 격하한다(§6.2). */
    apiMode: SimulateApiMode.default('MOCK'),
    /** [No.26 신설] MOCK 모드의 응답 원천. 미지정 시 연결의 첫 번째 샘플을 쓴다. */
    mockResponse: SimulateMockResponseSchema.optional(),
    /** [No.27 신설] 켜면 DRAFT·마감·기간 밖 설문도 진행한다(§5.1). 저장은 0건(P-14). 기본 false. */
    surveyPreview: z.boolean().default(false),
    /** [신규 No.22] 켜면 `getCachedUnfiltered()`로 비활성 토픽 자산도 후보에 포함한다(P-13). TC 실행에는 없다. */
    includeInactiveTopics: z.boolean().default(false),
    /** [신규 No.40] 대상 선택(§12.1) — 미지정 = 초안(DRAFT, 기존과 동일). STAGING/PROD/VERSION은
     * 환경 분리 모드가 켜진 챗봇에서만 유효하다. */
    target: BundleTargetSchema.optional(),
  })
  .superRefine((val, ctx) => {
    const hasMessage = val.message !== undefined && val.message.trim().length > 0;
    const hasButton = val.buttonAction !== undefined;
    if (hasMessage === hasButton) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'message 또는 buttonAction 중 정확히 하나를 지정해 주세요.',
        path: ['message'],
      });
    }
    // [신규 No.40 — AC-EN6-2] 오버레이는 초안 전용이다 — 비초안 대상과 함께 쓸 수 없다.
    const hasOverlay = val.overlay !== undefined && !isOverlayEmpty(val.overlay);
    if (hasOverlay && val.target !== undefined && val.target.kind !== 'DRAFT') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '오버레이는 초안 대상에서만 사용할 수 있습니다.',
        path: ['target'],
      });
    }
  });
export type SimulateRequestDto = z.infer<typeof SimulateRequestSchema>;

export const AssetCountsSchema = z.object({
  dialogNodes: z.number().int().nonnegative(),
  intents: z.number().int().nonnegative(),
  keywords: z.number().int().nonnegative(),
  homonyms: z.number().int().nonnegative(),
  contexts: z.number().int().nonnegative(),
  faqs: z.number().int().nonnegative(),
});
export type AssetCounts = z.infer<typeof AssetCountsSchema>;

/** [신규] 시뮬레이터 결과 패널의 매칭 근거(FR-N3-10). 관리자 API에만 노출한다(공개 API 금지 — NFR-S1). */
export const MatchTraceSchema = z.object({
  band: z.enum(['CONFIRMED', 'AMBIGUOUS', 'FAILED', 'SKIPPED']),
  top3: z.array(ThresholdPreviewCandidateSchema).max(3),
  ragUsed: z.boolean(),
  ragLatencyMs: z.number().nonnegative().optional(),
  ragSourceCount: z.number().int().nonnegative().optional(),
});
export type MatchTrace = z.infer<typeof MatchTraceSchema>;

/** [No.27 신설] 시뮬레이터 결과 패널의 설문 진행 요약(FR-SV9-3) — 판정 값 필드가 없다(원문 재노출 경로 0). */
export const SurveyStepViewSchema = z.object({
  surveyId: z.string().uuid(),
  surveyName: z.string(),
  questionIndex: z.number().int().nonnegative().optional(),
  questionCount: z.number().int().nonnegative(),
  outcomes: z.array(z.enum(['STARTED', 'ANSWERED', 'RETRY', 'SKIPPED_QUESTION', 'COMPLETED', 'ABANDONED', 'NOT_STARTED'])),
  reason: z.string().optional(),
  preview: z.boolean(),
  saved: z.literal(false),
});
export type SurveyStepView = z.infer<typeof SurveyStepViewSchema>;

export const SimulateResponseSchema = DialogueResolutionSchema.extend({
  state: ConversationStateSchema,
  stateDiscarded: z.array(StateDiscardReason),
  matchedNodeName: z.string().optional(),
  matchedIntentName: z.string().optional(),
  matchedFaqQuestion: z.string().optional(),
  elapsedMs: z.number().nonnegative(),
  resolvedAt: z.coerce.date(),
  assetCounts: AssetCountsSchema,
  overlayApplied: z.boolean(),
  /** [신규] 1단계 top3 점수·구간 판정 + 2단계 사용 여부(FR-N3-10). `semanticEnabled`가 꺼져 있으면 undefined. */
  matchTrace: MatchTraceSchema.optional(),
  /** [No.26 신설] 외부 API 호출이 있었던 턴에만 존재한다(§6.2). */
  apiStep: ApiStepViewSchema.optional(),
  /** [No.27 신설] 이번 턴에 설문 세션이 관여했을 때만 존재한다(FR-SV9-3). 판정 값은 담지 않는다. */
  surveyStep: SurveyStepViewSchema.optional(),
  /** [신규 No.22] 답한 자산의 topicId가 있을 때만 채워진다(공통 답변·토픽 없는 챗봇 = undefined, §6.5). */
  answeredTopic: SimulatedAnsweredTopicSchema.optional(),
  /** [신규 No.40] 비초안 대상일 때만 채워진다(§12.1). */
  target: ResolvedBundleTargetSchema.optional(),
});
export type SimulateResponse = z.infer<typeof SimulateResponseSchema>;

/* ------------------------------------------------------------------------------------------------
 * No.10 비교 실행(J-1) — FR-10-25~31, DD-32
 * ---------------------------------------------------------------------------------------------- */

export const CompareRequestSchema = z.object({
  messages: z.array(z.string().min(1).max(COMPARE_LIMITS.messageLength)).min(1).max(COMPARE_LIMITS.messages),
  overlay: DialogueOverlaySchema,
  // state 필드와 동일한 이유로 엄격 검증하지 않는다(FR-10-4 ①, DD-32).
  initialState: z.unknown().optional(),
  /** [신규 No.22] §6.5 — 단건과 같은 의미. */
  includeInactiveTopics: z.boolean().default(false),
});
export type CompareRequestDto = z.infer<typeof CompareRequestSchema>;

export const CompareTurnResultSchema = z.object({
  outputs: z.array(DialogOutputSchema),
  matchedNodeId: z.string().uuid().optional(),
  matchedNodeName: z.string().optional(),
  matchedIntentId: z.string().uuid().optional(),
  matchedFaqId: z.string().uuid().optional(),
  unsupportedOutputs: z.array(z.string()),
  trace: DialogueResolutionSchema.shape.trace,
  /** [신규 No.22] 답한 자산의 topicId가 있을 때만 채워진다(§6.5). */
  answeredTopic: SimulatedAnsweredTopicSchema.optional(),
});
export type CompareTurnResult = z.infer<typeof CompareTurnResultSchema>;

export const CompareDiffSchema = z.object({
  status: z.enum(['SAME', 'DIFFERENT']),
  outputsChanged: z.boolean(),
  matchChanged: z.boolean(),
});
export type CompareDiff = z.infer<typeof CompareDiffSchema>;

export const CompareResponseSchema = z.object({
  turns: z.array(
    z.object({
      index: z.number().int().nonnegative(),
      message: z.string(),
      a: CompareTurnResultSchema,
      b: CompareTurnResultSchema,
      diff: CompareDiffSchema,
    }),
  ),
  summary: z.object({
    total: z.number().int().nonnegative(),
    same: z.number().int().nonnegative(),
    different: z.number().int().nonnegative(),
  }),
  elapsedMs: z.number().nonnegative(),
  resolvedAt: z.coerce.date(),
});
export type CompareResponse = z.infer<typeof CompareResponseSchema>;

/* ------------------------------------------------------------------------------------------------
 * No.11 공개 대화 API — FR-11-14~16, FR-0-18(내부 식별자·trace 미포함)
 * ---------------------------------------------------------------------------------------------- */

export const PublicChatbotConfigSchema = z.object({
  slug: z.string(),
  name: z.string(),
  avatarUrl: z.string().optional(),
  skin: ChatbotSkinSchema,
  greetingMessage: z.string().optional(),
  quickReplies: z.array(z.string()),
  launcherPosition: z.enum(['RIGHT', 'LEFT']),
  showLauncher: z.boolean(),
});
export type PublicChatbotConfig = z.infer<typeof PublicChatbotConfigSchema>;

export const PublicMessageRequestSchema = z
  .object({
    sessionId: z.string().uuid(),
    message: z.string().min(1).max(1000).optional(),
    buttonAction: ButtonActionSchema.optional(),
    // ⚠ state.ts와 동일한 이유로 엄격 검증하지 않는다(FR-11-26 → FR-10-4 규칙 상속).
    state: z.unknown().optional(),
    /** [신규 No.24] 위젯 기능 선언(ADR-0036 §2) — `'handoff-v1'`이 없으면 구버전 취급(편승 격하). */
    features: z.array(z.string().min(1).max(32)).max(5).optional(),
  })
  .superRefine((val, ctx) => {
    const hasMessage = val.message !== undefined && val.message.trim().length > 0;
    const hasButton = val.buttonAction !== undefined;
    if (hasMessage === hasButton) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'message 또는 buttonAction 중 정확히 하나를 지정해 주세요.',
        path: ['message'],
      });
    }
  });
export type PublicMessageRequestDto = z.infer<typeof PublicMessageRequestSchema>;

/**
 * [신규 No.24] 상담 상태 조각(ADR-0036 §2·§5.1) — `PublicMessageResponseSchema.handoff`와 상담
 * 폴링 응답(`HandoffPollResponseSchema`)이 함께 쓴다. `PublicMessageResponseSchema`보다 먼저
 * 선언해야 한다(같은 모듈 평가 순서 — 참조 시점에 이미 초기화되어 있어야 한다).
 */
export const PublicHandoffStateSchema = z.object({
  status: z.enum(['NONE', 'CONNECTED', 'ENDED']),
  /** 이 응답에서 1회만 실린다(§6.2) — 서버 로그·감사·오류 응답 어디에도 없다. */
  token: z.string().optional(),
  pollAfterMs: z.number().int().nonnegative().optional(),
  watch: z
    .object({
      windowMs: z.number().int().positive(),
      pollAfterMs: z.number().int().positive(),
      trigger: z.enum(['NOW', 'IF_PENDING_FAILS']),
    })
    .optional(),
});
export type PublicHandoffState = z.infer<typeof PublicHandoffStateSchema>;

/**
 * [신규 No.44] 위젯이 `POST …/messages` 요청 본문 `features`에 싣는 기능 선언 문자열(ADR-0038 §1).
 * `PublicMessageResponseSchema`보다 먼저 선언해야 한다(같은 모듈 평가 순서 — `PublicHandoffStateSchema` 선례).
 */
export const WIDGET_FEATURE_FEEDBACK_V1 = 'feedback-v1';

/** 응답에 싣는 평가 가능 표식 — 키 자체가 없으면(§6.2) 바이트 동일(FR-FB2-2). */
export const PublicFeedbackOfferSchema = z.object({ rateable: z.literal(true) });
export type PublicFeedbackOffer = z.infer<typeof PublicFeedbackOfferSchema>;

/** `stateReset`이 유일하게 허용된 "내부 사정" 노출이다. 폐기 사유는 내부 구조를 드러내므로 제외한다(FR-0-18). */
export const PublicMessageResponseSchema = z.object({
  messageId: z.string().uuid(),
  outputs: z.array(DialogOutputSchema),
  state: ConversationStateSchema,
  stateReset: z.boolean(),
  /**
   * [신규] 2단계(외부 RAG)로 넘어간 턴에만 존재한다(ADR-0023, FR-N2-33). `id`는 `messageId`와 동일한
   * 값이다(로그 1건 규약과 자연히 맞물린다, DD-81). 이 필드가 없는 턴의 응답은 **바이트 단위로 현행과
   * 동일**하다(AC-N2-16) — 하위호환을 지키는 유일한 신규 필드다.
   */
  pendingAnswer: z
    .object({
      id: z.string().uuid(),
      /** 위젯이 최초 폴링 전 대기할 시간(ms, 기본 1200). */
      pollAfterMs: z.number().int().positive(),
      expiresAt: z.coerce.date(),
    })
    .optional(),
  /** [신규 No.24] 상담 켜진 챗봇의 미응답·보류·상담 턴에만 존재한다(ADR-0036 §2·§5.1). 없으면
   * 바이트 단위로 현행과 동일하다(`pendingAnswer` 선례). */
  handoff: PublicHandoffStateSchema.optional(),
  /** [신규 No.44] 평가 가능 턴에만 존재한다(ADR-0038 §1). 없으면 바이트 단위로 현행과 동일 —
   * **마지막 키**(조건부 전개로만 채운다, §6.2). */
  feedback: PublicFeedbackOfferSchema.optional(),
});
export type PublicMessageResponse = z.infer<typeof PublicMessageResponseSchema>;

/* ------------------------------------------------------------------------------------------------
 * 보류 답변 폴링 — `GET /public/chatbots/:slug/messages/:messageId`(`@Public()` 6번째, ADR-0023).
 * ---------------------------------------------------------------------------------------------- */

export const PendingAnswerSourceSchema = z.object({
  fileName: z.string(),
  sectionTitle: z.string().optional(),
  page: z.number().int().positive().optional(),
});
export type PendingAnswerSource = z.infer<typeof PendingAnswerSourceSchema>;

/** 내부 식별자·`trace`·점수를 노출하지 않는다(ADR-0011 상속). */
export const PendingAnswerPollResponseSchema = z.object({
  status: z.enum(['PENDING', 'READY', 'FAILED', 'EXPIRED']),
  outputs: z.array(DialogOutputSchema).optional(),
  sources: z.array(PendingAnswerSourceSchema).optional(),
});
export type PendingAnswerPollResponse = z.infer<typeof PendingAnswerPollResponseSchema>;

/* ------------------------------------------------------------------------------------------------
 * 하이브리드 CS(No.24) — 상담 전용 짧은 폴링. `GET /public/chatbots/:slug/handoff`(`@Public()` 7번째,
 * ADR-0036 §2·§7). 세션·토큰은 헤더로만 전달한다(URL·본문 금지 — §6.1).
 * ---------------------------------------------------------------------------------------------- */

/** 위젯이 `POST …/messages` 요청 본문 `features`에 싣는 기능 선언 문자열. */
export const WIDGET_FEATURE_HANDOFF_V1 = 'handoff-v1';
export const HANDOFF_SESSION_HEADER = 'x-cb-session-id';
export const HANDOFF_TOKEN_HEADER = 'x-cb-handoff-token';

/* ------------------------------------------------------------------------------------------------
 * 피드백 기반 개선 루프(No.44) — 공개 평가 API 계약. `PUT /public/chatbots/:slug/messages/:messageId/feedback`
 * (`@Public()` 8번째, ADR-0038 §2). `feedback-loop-설계.md` §4.2·§7.
 * ---------------------------------------------------------------------------------------------- */

export const PublicFeedbackRequestSchema = z.object({
  sessionId: z.string().uuid(),
  rating: FeedbackRating,
});
export type PublicFeedbackRequestDto = z.infer<typeof PublicFeedbackRequestSchema>;

export const PublicFeedbackResponseSchema = z.object({
  rating: FeedbackRating,
});
export type PublicFeedbackResponse = z.infer<typeof PublicFeedbackResponseSchema>;

export const HandoffPollQuerySchema = z.object({
  after: z.coerce.number().int().min(0).default(0),
  /** 새로고침 복구 — 자기 USER 메시지(마스킹본)도 함께 반환한다(FR-CS9-7). */
  restore: queryBoolean(),
});
export type HandoffPollQuery = z.infer<typeof HandoffPollQuerySchema>;

export const HandoffPollMessageSchema = z.object({
  seq: z.number().int().positive(),
  /** `USER`는 `restore=true`일 때만 실린다. */
  sender: z.enum(['USER', 'AGENT', 'SYSTEM']),
  /** ★ 항상 마스킹본이다 — `rawText` 키는 이 스키마에 타입상 존재하지 않는다(§9.7). */
  text: z.string(),
  sentAt: z.coerce.date(),
  action: z.object({ kind: z.literal('NODE'), nodeId: z.string().uuid(), label: z.string() }).optional(),
});
export type HandoffPollMessage = z.infer<typeof HandoffPollMessageSchema>;

export const HandoffPollResponseSchema = z.object({
  status: z.enum(['NONE', 'CONNECTED', 'ENDED']),
  token: z.string().optional(),
  messages: z.array(HandoffPollMessageSchema),
  /** 이번 응답이 훑은 최대 seq(내부 SYSTEM 포함 — 재요청 방지). */
  cursor: z.number().int().min(0),
  /** `null` = 폴링 중단(`ENDED`). */
  pollAfterMs: z.number().int().positive().nullable(),
});
export type HandoffPollResponse = z.infer<typeof HandoffPollResponseSchema>;
