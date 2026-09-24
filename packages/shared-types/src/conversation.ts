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
