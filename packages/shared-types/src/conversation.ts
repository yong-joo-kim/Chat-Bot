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
});
export type PublicMessageResponse = z.infer<typeof PublicMessageResponseSchema>;
