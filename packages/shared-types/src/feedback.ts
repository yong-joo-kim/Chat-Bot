import { z } from 'zod';

/**
 * 피드백 기반 개선 루프(No.44) 도메인 스키마 — `docs/02-spec/feedback-loop-설계.md` §4.1, ADR-0038 근거.
 * 위젯은 이 파일을 import하지 않는다(vanilla·의존성 0 — `constants/feedback.ts`가 값만 복제한다).
 */

export const FeedbackRating = z.enum(['UP', 'DOWN']);
export type FeedbackRating = z.infer<typeof FeedbackRating>;

export const FeedbackTargetKind = z.enum(['NODE', 'FAQ', 'INTENT', 'RAG', 'FALLBACK', 'API_NOTICE', 'OTHER']);
export type FeedbackTargetKind = z.infer<typeof FeedbackTargetKind>;

export const FEEDBACK_TARGET_KIND_LABELS: Record<FeedbackTargetKind, string> = {
  NODE: '노드',
  FAQ: 'FAQ',
  INTENT: '의도',
  RAG: '문서 답변',
  FALLBACK: '답변 못함(폴백)',
  API_NOTICE: '연동 안내',
  OTHER: '기타',
};

export const NegativeFeedbackSkipCode = z.enum(['ALREADY_UNANSWERED', 'API_NOTICE', 'BUTTON_NODE', 'EMPTY', 'TOO_LONG', 'LIMIT_REACHED']);
export type NegativeFeedbackSkipCode = z.infer<typeof NegativeFeedbackSkipCode>;

export const FeedbackQueueOutcome = z.enum(['CLAIMED', 'QUEUED', 'SKIPPED', 'FAILED']);
export type FeedbackQueueOutcome = z.infer<typeof FeedbackQueueOutcome>;

export const FEEDBACK_LIMITS = {
  changeWindowHours: 24,
  maxChanges: 5,
  maxPendingNegativeFeedback: 2000,
  lowSampleThreshold: 30,
  topTargetsMax: 20,
  topTargetsDefault: 10,
} as const;

/**
 * 답변 대상 판정 1벌(원장 적재·큐 표시·통계·콘솔 공용). `classifyResponseSource()`(stats/lib/response-source.ts)와
 * 같은 우선순위에 API_NOTICE(최우선)·INTENT(노드·FAQ 없이 의도만)를 더한 확장이다 — 폴백 노드는
 * isAnswered=false라 FALLBACK이다.
 */
export function classifyFeedbackTarget(row: {
  isAnswered: boolean;
  apiNotice: boolean;
  answeredByRag: boolean;
  matchedNodeId: string | null;
  matchedFaqId: string | null;
  matchedIntentId: string | null;
}): { kind: FeedbackTargetKind; id: string | null } {
  if (row.apiNotice) return { kind: 'API_NOTICE', id: null };
  if (!row.isAnswered) return { kind: 'FALLBACK', id: null };
  if (row.matchedNodeId) return { kind: 'NODE', id: row.matchedNodeId };
  if (row.matchedFaqId) return { kind: 'FAQ', id: row.matchedFaqId };
  if (row.answeredByRag) return { kind: 'RAG', id: null };
  if (row.matchedIntentId) return { kind: 'INTENT', id: row.matchedIntentId };
  return { kind: 'OTHER', id: null };
}

/* ------------------------------------------------------------------------------------------------
 * 공개 평가 API 요청/응답은 `conversation.ts`에 둔다(§4.2 — 공개 대화 계약과 같은 파일).
 * ---------------------------------------------------------------------------------------------- */

/* ------------------------------------------------------------------------------------------------
 * "직접 수정 완료" 전이 — `POST …/unanswered-questions/:id/mark-addressed`(§11.3)
 * ---------------------------------------------------------------------------------------------- */

/** 학습현황 큐 항목의 답변 대상 참조(요약본) — 상세·목록·통계가 공용으로 쓴다. */
export const FeedbackTargetRefSchema = z.object({
  kind: FeedbackTargetKind,
  id: z.string().uuid().optional(),
  name: z.string().optional(),
  deleted: z.boolean(),
});
export type FeedbackTargetRef = z.infer<typeof FeedbackTargetRefSchema>;

/* ------------------------------------------------------------------------------------------------
 * 만족도 통계 — `GET /stats/feedback`(§12)
 * ---------------------------------------------------------------------------------------------- */

export const FeedbackStatsQuerySchema = z.object({
  chatbotId: z.string().uuid(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  topN: z.coerce.number().int().min(1).max(FEEDBACK_LIMITS.topTargetsMax).default(FEEDBACK_LIMITS.topTargetsDefault),
});
export type FeedbackStatsQuery = z.infer<typeof FeedbackStatsQuerySchema>;

/** 분모 0 → null("—" 표시). */
const RateSchema = z.number().min(0).max(1).nullable();

export const FeedbackStatsBucketSchema = z.object({
  dayBucket: z.string(),
  upCount: z.number().int().nonnegative(),
  downCount: z.number().int().nonnegative(),
  offeredCount: z.number().int().nonnegative(),
  positiveRate: RateSchema,
});
export type FeedbackStatsBucket = z.infer<typeof FeedbackStatsBucketSchema>;

export const FeedbackStatsTopTargetSchema = z.object({
  kind: FeedbackTargetKind,
  targetId: z.string().uuid().optional(),
  name: z.string().optional(),
  deleted: z.boolean(),
  downCount: z.number().int().nonnegative(),
  upCount: z.number().int().nonnegative(),
});
export type FeedbackStatsTopTarget = z.infer<typeof FeedbackStatsTopTargetSchema>;

export const FeedbackStatsSchema = z.object({
  periodStart: z.coerce.date(),
  periodEnd: z.coerce.date(),
  granularity: z.literal('DAY'),
  timezone: z.string(),
  chatbotId: z.string().uuid(),
  generatedAt: z.coerce.date(),
  totals: z.object({
    upCount: z.number().int().nonnegative(),
    downCount: z.number().int().nonnegative(),
    ratedCount: z.number().int().nonnegative(),
    /** 이 기간에 평가 버튼을 제공한 턴 수(참여율의 정확한 분모, ADR-0038 §1). */
    offeredCount: z.number().int().nonnegative(),
    positiveRate: RateSchema,
    /** 하한값으로 해석한다(§24 알려진 제한 1). */
    participationRate: RateSchema,
    lowSample: z.boolean(),
  }),
  buckets: z.array(FeedbackStatsBucketSchema),
  topNegativeTargets: z.array(FeedbackStatsTopTargetSchema),
  lowSampleThreshold: z.number().int(),
});
export type FeedbackStats = z.infer<typeof FeedbackStatsSchema>;
