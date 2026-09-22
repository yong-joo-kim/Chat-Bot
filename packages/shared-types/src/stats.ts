import { z } from 'zod';

/**
 * No.14 기본 통계 도메인 스키마.
 * `docs/02-spec/stats-learning-설계.md` §4.2, 요구사항 `docs/requirements/stats-learning.md` §4.1 근거.
 * ⚠ No.15(학습현황)의 미응답 큐 스키마는 `learning.ts`로 이동했다(ADR-0019) — import 경로는
 * `index.ts` re-export로 그대로 유지된다.
 */

/** No.14 기본 통계의 원천 데이터 — 대화 로그(원문은 PII 마스킹 후 저장 전제, ADR-0013). */
export const ConversationLogSchema = z.object({
  id: z.string().uuid(),
  chatbotId: z.string().uuid(),
  channelType: z.string(),
  /** 대화 세션 식별자(No.2 접속수 산정 근거, ADR-0001). 대화 처리 Phase에서 채워진다. */
  sessionId: z.string().optional(),
  userMessage: z.string(),
  botResponse: z.string(),
  matchedIntentId: z.string().uuid().optional(),
  /** [신규] 응답 출처 판정(FR-14-20, DD-20). */
  matchedNodeId: z.string().uuid().optional(),
  matchedFaqId: z.string().uuid().optional(),
  isAnswered: z.boolean().default(true),
  /** [신규] 입구 금지어 필터 차단 턴(DD-37). */
  blockedByFilter: z.boolean().default(false),
  /** [신규] KST 일 버킷 `YYYY-MM-DD`, 적재 시점 확정(ADR-0017). */
  dayBucket: z.string().optional(),
  createdAt: z.coerce.date(),
});
export type ConversationLog = z.infer<typeof ConversationLogSchema>;

/** No.2 대시보드 조회 요청(FR-2-5, FR-2-4). ⚠ 변경 금지 — J-4(대시보드 코드/AC 무변경). */
export const DashboardQuerySchema = z.object({
  chatbotId: z.string().uuid(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  topN: z.coerce.number().int().min(1).max(10).default(5),
});
export type DashboardQuery = z.infer<typeof DashboardQuerySchema>;

/** 접속수 산정 기준(ADR-0001) — UI 카드 캡션 문구를 서버 상태에 맞춰 전환하는 데 사용한다. */
export const VisitCountBasis = z.enum(['SESSION', 'LOG_COUNT']);
export type VisitCountBasis = z.infer<typeof VisitCountBasis>;

/** No.2 대시보드 집계 결과. ⚠ 변경 금지 — J-4(FR-14-1, AC-2-1~14). */
export const DashboardSummarySchema = z.object({
  chatbotId: z.string().uuid(),
  periodStart: z.coerce.date(),
  periodEnd: z.coerce.date(),
  visitCount: z.number().int().nonnegative(),
  /** 기간 내 sessionId 보유 로그가 하나라도 있으면 'SESSION', 전혀 없으면 'LOG_COUNT'(ADR-0001). */
  visitCountBasis: VisitCountBasis,
  /** 조회 완료 배지에 사용되는 집계 건수(FR-2-12). */
  totalLogCount: z.number().int().nonnegative(),
  responseRate: z.number().min(0).max(1),
  noResponseRate: z.number().min(0).max(1),
  topQuestions: z.array(z.object({ question: z.string(), count: z.number().int().nonnegative() })),
});
export type DashboardSummary = z.infer<typeof DashboardSummarySchema>;

/* ------------------------------------------------------------------------------------------------
 * No.14 신규 — 기간·단위·버킷 공통 규약(FR-14-4~12, J-3, ADR-0017)
 * ---------------------------------------------------------------------------------------------- */

export const StatsGranularity = z.enum(['DAY', 'WEEK', 'MONTH']);
export type StatsGranularity = z.infer<typeof StatsGranularity>;

/**
 * 응답 출처 판정 결과(FR-14-20). 판정 순서는 `stats/lib/response-source.ts` 순수 함수 1곳(§7.3).
 * `RAG`는 2단계(외부 RAG) 응답 조각이다(J-10, DD-82) — `ConversationLog.answeredByRag`가 유일한 근거.
 */
export const ResponseSource = z.enum(['NODE', 'FAQ', 'RAG', 'OTHER', 'FALLBACK']);
export type ResponseSource = z.infer<typeof ResponseSource>;

export const RESPONSE_SOURCE_LABELS: Record<ResponseSource, string> = {
  NODE: '노드',
  FAQ: 'FAQ',
  RAG: '문서 기반(RAG)',
  OTHER: '기타',
  FALLBACK: '폴백(미응답)',
};

/** 기간·단위 상한/기본값(FR-14-7/8/23). 환경변수로 조정 가능한 서버 기본값의 클라이언트 표기용 사본. */
export const STATS_LIMITS = {
  maxRangeDays: 92,
  maxRangeWeeks: 53,
  maxRangeMonths: 24,
  defaultDays: 30,
  defaultWeeks: 12,
  defaultMonths: 12,
  topNMax: 50,
  topNDefault: 10,
  timezone: 'Asia/Seoul' as const,
};

/**
 * ⚠ `granularity`는 의도적으로 `z.string()`이다(`StatsGranularity` enum이 아니다).
 * `DAY|WEEK|MONTH` 외의 값은 전역 `VALIDATION_FAILED`가 아니라 서비스 계층에서
 * 전용 오류코드 `INVALID_GRANULARITY`(400)로 응답해야 한다(FR-14-4, AC-14A-7).
 */
export const StatsQuerySchema = z.object({
  chatbotId: z.string().uuid(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  granularity: z.string().trim().min(1).optional(),
});
export type StatsQuery = z.infer<typeof StatsQuerySchema>;

export const StatsDistributionQuerySchema = z.object({
  chatbotId: z.string().uuid(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
export type StatsDistributionQuery = z.infer<typeof StatsDistributionQuerySchema>;

export const StatsQuestionsQuerySchema = z.object({
  chatbotId: z.string().uuid(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  topN: z.coerce.number().int().min(1).max(STATS_LIMITS.topNMax).default(STATS_LIMITS.topNDefault),
});
export type StatsQuestionsQuery = z.infer<typeof StatsQuestionsQuerySchema>;

/** 응답이 항상 포함하는 기간 메타(FR-14-12) — 화면이 "무엇을 보고 있는지" 표시할 수 있게 한다. */
export const StatsPeriodMetaSchema = z.object({
  periodStart: z.coerce.date(),
  periodEnd: z.coerce.date(),
  granularity: StatsGranularity,
  timezone: z.literal('Asia/Seoul'),
});
export type StatsPeriodMeta = z.infer<typeof StatsPeriodMetaSchema>;

export const StatsBucketSchema = z.object({
  /** 폴딩 단위 키 — DAY: 'YYYY-MM-DD' / WEEK: 'YYYY-Www' / MONTH: 'YYYY-MM'(FR-14-5/6). */
  key: z.string(),
  /** 사람이 읽는 라벨. 주 버킷은 시작·종료일을 함께 표기한다(FR-14-5). */
  label: z.string(),
  start: z.coerce.date(),
  end: z.coerce.date(),
  turnCount: z.number().int().nonnegative(),
  answeredCount: z.number().int().nonnegative(),
  unansweredCount: z.number().int().nonnegative(),
  blockedCount: z.number().int().nonnegative(),
  responseRate: z.number().min(0).max(1),
  /** ⚠ 버킷 단위 distinct 재계산 값 — 합계 보존 검증 대상이 아니다(DD-61). */
  sessionCount: z.number().int().nonnegative(),
});
export type StatsBucket = z.infer<typeof StatsBucketSchema>;

export const StatsSummarySchema = StatsPeriodMetaSchema.extend({
  totals: z.object({
    turnCount: z.number().int().nonnegative(),
    answeredCount: z.number().int().nonnegative(),
    unansweredCount: z.number().int().nonnegative(),
    blockedCount: z.number().int().nonnegative(),
    responseRate: z.number().min(0).max(1),
    noResponseRate: z.number().min(0).max(1),
    sessionCount: z.number().int().nonnegative(),
    visitCountBasis: VisitCountBasis,
    /** 세션당 평균 턴 수, 소수 첫째 자리(FR-14-14). 세션 0건이면 0(NaN 금지). */
    turnsPerSession: z.number().nonnegative(),
  }),
  buckets: z.array(StatsBucketSchema),
});
export type StatsSummary = z.infer<typeof StatsSummarySchema>;

export const StatsDistributionSchema = StatsPeriodMetaSchema.extend({
  bySource: z.array(z.object({ source: ResponseSource, count: z.number().int().nonnegative(), ratio: z.number().min(0).max(1) })),
  byChannel: z.array(z.object({ channelType: z.string(), sessionCount: z.number().int().nonnegative(), ratio: z.number().min(0).max(1) })),
  /** 항상 24개(0~23시, FR-14-28). */
  byHour: z.array(z.object({ hour: z.number().int().min(0).max(23), turnCount: z.number().int().nonnegative() })),
  /** 항상 7개(0=월~6=일, FR-14-29). */
  byWeekday: z.array(
    z.object({ weekday: z.number().int().min(0).max(6), turnCount: z.number().int().nonnegative(), responseRate: z.number().min(0).max(1) }),
  ),
});
export type StatsDistribution = z.infer<typeof StatsDistributionSchema>;

export const StatsQuestionsSchema = StatsPeriodMetaSchema.extend({
  topQuestions: z.array(z.object({ question: z.string(), count: z.number().int().nonnegative() })),
  topUnansweredQuestions: z.array(
    z.object({ question: z.string(), count: z.number().int().nonnegative(), unansweredQuestionId: z.string().uuid().optional() }),
  ),
  /** 후보 상한(`candidateLimit`)에 따른 근사 여부(FR-0-34, ADR-0004). 프런트가 값을 하드코딩하지 않는다. */
  approximated: z.boolean(),
  candidateLimit: z.number().int().positive(),
});
export type StatsQuestions = z.infer<typeof StatsQuestionsSchema>;
