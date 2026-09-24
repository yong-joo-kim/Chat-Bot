import { z } from 'zod';
import { queryBoolean } from './common';
import { ChatbotStatus } from './chatbot';

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

/* ------------------------------------------------------------------------------------------------
 * No.29 통합 통계(그룹·전역 스코프) — `docs/02-spec/integrated-stats-설계.md` §8, ADR-0033.
 * 기존 챗봇 스코프(위) 스키마는 한 글자도 바꾸지 않는다(FR-0-90).
 * ---------------------------------------------------------------------------------------------- */

export const StatsScope = z.enum(['ALL', 'GROUP']);
export type StatsScope = z.infer<typeof StatsScope>;

/** 코드 상수(환경변수 아님, FR-0-93) — 기여 표·선택기 상한. */
export const INTEGRATED_STATS_LIMITS = { breakdownMaxRows: 200, groupOptionsMax: 1000 } as const;

const scopeFields = { scope: StatsScope.default('ALL'), groupId: z.string().uuid().optional() };

/**
 * 스코프 규칙(EX-I-2): `scope=GROUP`이면 `groupId` 필수, `scope=ALL`이면 `groupId` 지정 자체를
 * 거부한다(무시가 아니라 400 VALIDATION_FAILED) — 클라이언트가 스코프 전환 후 이전 `groupId`를
 * 실수로 남겨도 조용히 무시되지 않게 한다.
 */
function refineScope<T extends z.ZodRawShape>(shape: T) {
  return z.object(shape).superRefine((val, ctx) => {
    const scope = (val as { scope?: StatsScope }).scope;
    const groupId = (val as { groupId?: string }).groupId;
    if (scope === 'GROUP' && !groupId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['groupId'], message: 'scope=GROUP이면 groupId가 필요합니다.' });
    }
    if (scope === 'ALL' && groupId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['groupId'], message: 'scope=ALL에는 groupId를 지정할 수 없습니다.' });
    }
  });
}

export const IntegratedOverviewQuerySchema = refineScope({ ...scopeFields });
export type IntegratedOverviewQuery = z.infer<typeof IntegratedOverviewQuerySchema>;

export const IntegratedStatsQuerySchema = refineScope({
  ...scopeFields,
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  // ⚠ 의도적으로 z.string()이다(StatsQuerySchema 선례) — INVALID_GRANULARITY 전용 오류코드 규약.
  granularity: z.string().trim().min(1).optional(),
});
export type IntegratedStatsQuery = z.infer<typeof IntegratedStatsQuerySchema>;

export const IntegratedDistributionQuerySchema = refineScope({
  ...scopeFields,
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
export type IntegratedDistributionQuery = z.infer<typeof IntegratedDistributionQuerySchema>;

/** 기여 표는 항상 일 버킷 규칙으로 계산한다 — `granularity`를 받지 않는다(분포와 같은 쿼리). */
export const IntegratedBreakdownQuerySchema = IntegratedDistributionQuerySchema;
export type IntegratedBreakdownQuery = IntegratedDistributionQuery;

export const IntegratedQuestionsQuerySchema = refineScope({
  ...scopeFields,
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  topN: z.coerce.number().int().min(1).max(STATS_LIMITS.topNMax).default(STATS_LIMITS.topNDefault),
  /** 기본 포함(P-5) — 합계에서 보관 챗봇을 빼는 파라미터는 질문 순위에만 존재한다. */
  includeArchivedChatbots: queryBoolean().default(true),
});
export type IntegratedQuestionsQuery = z.infer<typeof IntegratedQuestionsQuerySchema>;

/** 모든 통합 응답 공통 메타(FR-0-95). */
export const IntegratedScopeMetaSchema = z.object({
  scope: StatsScope,
  groupId: z.string().uuid().nullable(),
  /** `groupId=''`(백필 미완 센티넬) 로그가 남아 있으면 true(FR-I2-4). 스코프와 무관한 전역 값. */
  backfillPending: z.boolean(),
  generatedAt: z.coerce.date(),
  timezone: z.literal('Asia/Seoul'),
});
export type IntegratedScopeMeta = z.infer<typeof IntegratedScopeMetaSchema>;

export const IntegratedOverviewSchema = IntegratedScopeMetaSchema.extend({
  /** ALL 스코프면 null. */
  group: z.object({ id: z.string().uuid(), name: z.string(), createdAt: z.coerce.date(), archivedAt: z.coerce.date().nullable() }).nullable(),
  totals: StatsSummarySchema.shape.totals,
  firstDayBucket: z.string().nullable(),
  chatbotCounts: z.object({
    active: z.number().int().nonnegative(),
    draft: z.number().int().nonnegative(),
    archived: z.number().int().nonnegative(),
  }),
});
export type IntegratedOverview = z.infer<typeof IntegratedOverviewSchema>;

export const IntegratedSummarySchema = StatsSummarySchema.merge(IntegratedScopeMetaSchema);
export type IntegratedSummary = z.infer<typeof IntegratedSummarySchema>;

export const IntegratedDistributionSchema = StatsDistributionSchema.merge(IntegratedScopeMetaSchema);
export type IntegratedDistribution = z.infer<typeof IntegratedDistributionSchema>;

export const IntegratedQuestionItemSchema = z.object({
  question: z.string(),
  count: z.number().int().nonnegative(),
  topChatbotId: z.string().uuid().nullable(),
  topChatbotName: z.string().nullable(),
});
export type IntegratedQuestionItem = z.infer<typeof IntegratedQuestionItemSchema>;

export const IntegratedQuestionsSchema = StatsPeriodMetaSchema.merge(IntegratedScopeMetaSchema).extend({
  topQuestions: z.array(IntegratedQuestionItemSchema),
  topUnansweredQuestions: z.array(IntegratedQuestionItemSchema),
  approximated: z.boolean(),
  candidateLimit: z.number().int().positive(),
  includeArchivedChatbots: z.boolean(),
});
export type IntegratedQuestions = z.infer<typeof IntegratedQuestionsSchema>;

const BreakdownMetricsSchema = z.object({
  turnCount: z.number().int().nonnegative(),
  answeredCount: z.number().int().nonnegative(),
  unansweredCount: z.number().int().nonnegative(),
  sessionCount: z.number().int().nonnegative(),
  responseRate: z.number().min(0).max(1),
  share: z.number().min(0).max(1),
});

export const IntegratedBreakdownItemSchema = z.discriminatedUnion('kind', [
  BreakdownMetricsSchema.extend({
    kind: z.literal('CHATBOT'),
    id: z.string().uuid(),
    name: z.string(),
    status: ChatbotStatus,
    archivedAt: z.coerce.date().nullable(),
    /** 현재 소속이 스코프 그룹과 다를 때만(과거에 기여하고 떠난 챗봇, §5.5). */
    currentGroupId: z.string().uuid().nullable(),
    currentGroupName: z.string().nullable(),
  }),
  BreakdownMetricsSchema.extend({
    kind: z.literal('GROUP'),
    id: z.string().uuid(),
    name: z.string().nullable(),
    createdAt: z.coerce.date().nullable(),
    archived: z.boolean(),
    archivedAt: z.coerce.date().nullable(),
    /** 그룹 행이 더는 존재하지 않는 경우(§4.3 극소 경합). */
    missing: z.boolean(),
  }),
]);
export type IntegratedBreakdownItem = z.infer<typeof IntegratedBreakdownItemSchema>;

export const IntegratedBreakdownSchema = StatsPeriodMetaSchema.merge(IntegratedScopeMetaSchema).extend({
  items: z.array(IntegratedBreakdownItemSchema),
  othersRow: BreakdownMetricsSchema.extend({ count: z.number().int().positive() }).nullable(),
  /** `groupId=''` 백필 대기분(ALL 스코프에서만 채워진다). */
  unassignedRow: BreakdownMetricsSchema.nullable(),
  totals: z.object({ turnCount: z.number().int().nonnegative(), sessionCount: z.number().int().nonnegative() }),
  /** 비중 합 검증 단위(AC-I2-6) — 모든 share의 분자 합 = 10000. */
  shareScale: z.literal(10000),
});
export type IntegratedBreakdown = z.infer<typeof IntegratedBreakdownSchema>;

export const IntegratedGroupOptionsSchema = z.object({
  items: z.array(
    z.object({
      id: z.string().uuid(),
      name: z.string(),
      createdAt: z.coerce.date(),
      archivedAt: z.coerce.date().nullable(),
      chatbotCount: z.number().int().nonnegative(),
    }),
  ),
  truncated: z.boolean(),
});
export type IntegratedGroupOptions = z.infer<typeof IntegratedGroupOptionsSchema>;

/* ---------------- 챗봇 스코프 의도별 매칭(J-13, No.29) ---------------- */

export const IntentStatsQuerySchema = z.object({
  chatbotId: z.string().uuid(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  topN: z.coerce.number().int().min(1).max(STATS_LIMITS.topNMax).default(STATS_LIMITS.topNDefault),
});
export type IntentStatsQuery = z.infer<typeof IntentStatsQuerySchema>;

export const IntentStatsItemSchema = z.object({
  intentId: z.string().uuid(),
  /** 삭제된 의도는 null + `deleted:true`(AC-I5-5). */
  name: z.string().nullable(),
  deleted: z.boolean(),
  turnCount: z.number().int().nonnegative(),
  answeredCount: z.number().int().nonnegative(),
  responseRate: z.number().min(0).max(1),
  /** 전체 턴 대비 비중. */
  shareOfAll: z.number().min(0).max(1),
  /** 의도 매칭 턴 대비 비중(기본 표시 분모). */
  shareOfIntentMatched: z.number().min(0).max(1),
});
export type IntentStatsItem = z.infer<typeof IntentStatsItemSchema>;

export const IntentStatsSchema = StatsPeriodMetaSchema.extend({
  chatbotId: z.string().uuid(),
  generatedAt: z.coerce.date(),
  totalTurnCount: z.number().int().nonnegative(),
  matchedTurnCount: z.number().int().nonnegative(),
  unmatchedTurnCount: z.number().int().nonnegative(),
  othersTurnCount: z.number().int().nonnegative(),
  distinctIntentCount: z.number().int().nonnegative(),
  items: z.array(IntentStatsItemSchema),
});
export type IntentStats = z.infer<typeof IntentStatsSchema>;
