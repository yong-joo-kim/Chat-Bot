import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatbotStatus } from '@chat-bot/shared-types';
import type {
  IntegratedBreakdown,
  IntegratedBreakdownItem,
  IntegratedDistribution,
  IntegratedDistributionQuery,
  IntegratedGroupOptions,
  IntegratedOverview,
  IntegratedOverviewQuery,
  IntegratedQuestionItem,
  IntegratedQuestions,
  IntegratedQuestionsQuery,
  IntegratedStatsQuery,
  IntegratedBreakdownQuery,
  IntegratedSummary,
  StatsScope,
} from '@chat-bot/shared-types';
import { INTEGRATED_STATS_LIMITS } from '@chat-bot/shared-types';
import { PrismaService } from '../../prisma/prisma.service';
import { ApiException } from '../../common/api.exception';
import { parseGranularityOrThrow, readStatsRangeLimits, resolveStatsPeriodOrThrow, runWithAggregationTimeout } from '../stats-request.helpers';
import type { ResolvedScope } from '../lib/scope-filter';
import { scopeLogWhere } from '../lib/scope-filter';
import { buildBucketDayRanges, buildBuckets, foldDayRows } from '../lib/bucket';
import { assembleBySource, assembleByChannel, assembleSummaryBuckets, computeTurnsPerSession } from '../lib/summary-assembler';
import { foldByHour, foldByWeekday } from '../lib/usage-trend';
import { TOP_QUESTION_CANDIDATE_LIMIT, aggregateTopQuestions, computeResponseRates, computeVisitCount, normalizeQuestion } from '../lib/dashboard-aggregator';
import { attributeTopChatbot } from '../lib/question-attribution';
import { assembleBreakdown } from '../lib/breakdown';
import type { BreakdownSourceRow } from '../lib/breakdown';
import { IntegratedSessionQuery } from './integrated-session.query';

const NOT_FOUND_MESSAGE = '요청하신 대상을 찾을 수 없습니다.';

/**
 * No.29 통합 통계 오케스트레이션(그룹·전역 스코프, `integrated-stats-설계.md` §5). 스코프 판정 →
 * 쿼리 병렬 실행 → 순수 함수 조립. Prisma 쓰기 0건(R-8) — 읽기 전용.
 */
@Injectable()
export class IntegratedStatsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessionQuery: IntegratedSessionQuery,
    private readonly config: ConfigService,
  ) {}

  private readLimits() {
    return readStatsRangeLimits(this.config);
  }

  /** 스코프 판정(FR-I3-1/2) — GROUP이면 존재 확인(보관 그룹도 허용), ALL이면 그룹 조회 없음. */
  private async resolveScope(scope: StatsScope, groupId: string | undefined) {
    if (scope === 'GROUP') {
      const group = await this.prisma.chatbotGroup.findUnique({ where: { id: groupId as string } });
      if (!group) throw new ApiException('NOT_FOUND', 404, NOT_FOUND_MESSAGE);
      const resolved: ResolvedScope = { scope: 'GROUP', groupId: groupId as string };
      return { resolved, group };
    }
    const resolved: ResolvedScope = { scope: 'ALL' };
    return { resolved, group: null as null };
  }

  /** `groupId=''`(백필 미완 센티넬) 로그 잔여 확인 — 스코프와 무관한 전역 값(FR-I2-4). */
  private async checkBackfillPending(): Promise<boolean> {
    const row = await this.prisma.conversationLog.findFirst({ where: { groupId: '' }, select: { id: true } });
    return row !== null;
  }

  private scopeMeta(resolved: ResolvedScope, backfillPending: boolean) {
    return {
      scope: resolved.scope,
      groupId: resolved.scope === 'GROUP' ? resolved.groupId : null,
      backfillPending,
      generatedAt: new Date(),
      timezone: 'Asia/Seoul' as const,
    };
  }

  /** 누적 KPI(기간 없음, J-8, FR-I3-4). */
  async getOverview(query: IntegratedOverviewQuery): Promise<IntegratedOverview> {
    const { resolved, group } = await this.resolveScope(query.scope, query.groupId);
    const where = scopeLogWhere(resolved);
    const chatbotWhere = resolved.scope === 'GROUP' ? { groupId: resolved.groupId } : {};

    const [byAnswered, minDayBucket, sessionRows, chatbotStatusRows, backfillPending] = await runWithAggregationTimeout(
      Promise.all([
        this.prisma.conversationLog.groupBy({ by: ['isAnswered', 'blockedByFilter'], where, _count: { _all: true } }),
        this.prisma.conversationLog.aggregate({ where: { ...where, dayBucket: { not: '' } }, _min: { dayBucket: true } }),
        this.sessionQuery.count({ scope: resolved, groupBy: 'NONE' }),
        this.prisma.chatbot.groupBy({ by: ['status'], where: chatbotWhere, _count: { _all: true } }),
        this.checkBackfillPending(),
      ]),
    );

    let totalTurn = 0;
    let answeredCount = 0;
    let blockedCount = 0;
    for (const row of byAnswered) {
      totalTurn += row._count._all;
      if (row.isAnswered) answeredCount += row._count._all;
      if (row.blockedByFilter) blockedCount += row._count._all;
    }
    const unansweredCount = totalTurn - answeredCount;
    const { responseRate, noResponseRate } = computeResponseRates({ answeredCount, totalCount: totalTurn });

    const sessionRow = sessionRows[0];
    const { visitCount, visitCountBasis } = computeVisitCount({
      distinctSessionCount: sessionRow?.distinctSessions ?? 0,
      nullSessionCount: sessionRow?.nullSessions ?? 0,
    });
    const turnsPerSession = computeTurnsPerSession(totalTurn, visitCount);

    const chatbotCounts = { active: 0, draft: 0, archived: 0 };
    for (const row of chatbotStatusRows) {
      if (row.status === 'ACTIVE') chatbotCounts.active = row._count._all;
      else if (row.status === 'DRAFT') chatbotCounts.draft = row._count._all;
      else if (row.status === 'ARCHIVED') chatbotCounts.archived = row._count._all;
    }

    return {
      ...this.scopeMeta(resolved, backfillPending),
      group: group ? { id: group.id, name: group.name, createdAt: group.createdAt, archivedAt: group.archivedAt } : null,
      totals: {
        turnCount: totalTurn,
        answeredCount,
        unansweredCount,
        blockedCount,
        responseRate,
        noResponseRate,
        sessionCount: visitCount,
        visitCountBasis,
        turnsPerSession,
      },
      firstDayBucket: minDayBucket._min.dayBucket ?? null,
      chatbotCounts,
    };
  }

  /** 기간 요약 + 시계열(No.14 재사용, §5.2/5.4). */
  async getSummary(query: IntegratedStatsQuery): Promise<IntegratedSummary> {
    const { resolved } = await this.resolveScope(query.scope, query.groupId);
    const granularity = parseGranularityOrThrow(query.granularity);
    const period = resolveStatsPeriodOrThrow(query.from, query.to, granularity, this.readLimits());
    const where = { ...scopeLogWhere(resolved), dayBucket: { gte: period.fromDayBucket, lte: period.toDayBucket } };
    const buckets = buildBuckets(period.fromDayBucket, period.toDayBucket, granularity);
    const bucketRanges = buildBucketDayRanges(period.fromDayBucket, period.toDayBucket, granularity);

    const [byDay, bucketSessionRows, periodSessionRows, backfillPending] = await runWithAggregationTimeout(
      Promise.all([
        this.prisma.conversationLog.groupBy({ by: ['dayBucket', 'isAnswered', 'blockedByFilter'], where, _count: { _all: true } }),
        this.sessionQuery.count({
          scope: resolved,
          period: { fromDayBucket: period.fromDayBucket, toDayBucket: period.toDayBucket },
          groupBy: 'BUCKET',
          bucketRanges,
        }),
        this.sessionQuery.count({ scope: resolved, period: { fromDayBucket: period.fromDayBucket, toDayBucket: period.toDayBucket }, groupBy: 'NONE' }),
        this.checkBackfillPending(),
      ]),
    );

    const dayRows = byDay.map((r) => ({ dayBucket: r.dayBucket, isAnswered: r.isAnswered, blockedByFilter: r.blockedByFilter, count: r._count._all }));
    const folded = foldDayRows(dayRows, granularity);
    const sessionCountsByBucket = new Map(bucketSessionRows.map((r) => [r.key as string, r.distinctSessions + r.nullSessions]));

    const { bucketResults, totals: bucketTotals } = assembleSummaryBuckets(buckets, folded, sessionCountsByBucket);

    const periodSessionRow = periodSessionRows[0];
    const { visitCount, visitCountBasis } = computeVisitCount({
      distinctSessionCount: periodSessionRow?.distinctSessions ?? 0,
      nullSessionCount: periodSessionRow?.nullSessions ?? 0,
    });
    const turnsPerSession = computeTurnsPerSession(bucketTotals.turnCount, visitCount);

    return {
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      granularity,
      ...this.scopeMeta(resolved, backfillPending),
      totals: { ...bucketTotals, sessionCount: visitCount, visitCountBasis, turnsPerSession },
      buckets: bucketResults,
    };
  }

  /** 출처·채널·시간대·요일 분포(No.14 재사용). */
  async getDistribution(query: IntegratedDistributionQuery): Promise<IntegratedDistribution> {
    const { resolved } = await this.resolveScope(query.scope, query.groupId);
    const granularity = 'DAY' as const;
    const period = resolveStatsPeriodOrThrow(query.from, query.to, granularity, this.readLimits());
    const where = { ...scopeLogWhere(resolved), dayBucket: { gte: period.fromDayBucket, lte: period.toDayBucket } };

    const [bySourceRows, byHourRows, byWeekdayRows, channelSessionRows, backfillPending] = await runWithAggregationTimeout(
      Promise.all([
        this.prisma.conversationLog.groupBy({ by: ['matchedNodeId', 'matchedFaqId', 'isAnswered', 'answeredByRag'], where, _count: { _all: true } }),
        this.prisma.conversationLog.groupBy({ by: ['hourBucket'], where, _count: { _all: true } }),
        this.prisma.conversationLog.groupBy({ by: ['dayBucket', 'isAnswered'], where, _count: { _all: true } }),
        this.sessionQuery.count({ scope: resolved, period: { fromDayBucket: period.fromDayBucket, toDayBucket: period.toDayBucket }, groupBy: 'CHANNEL' }),
        this.checkBackfillPending(),
      ]),
    );

    const bySource = assembleBySource(
      bySourceRows.map((r) => ({ matchedNodeId: r.matchedNodeId, matchedFaqId: r.matchedFaqId, isAnswered: r.isAnswered, answeredByRag: r.answeredByRag, count: r._count._all })),
    );
    const sessionCountsByChannel = new Map(channelSessionRows.map((r) => [r.key as string, r.distinctSessions + r.nullSessions]));
    const byChannel = assembleByChannel(sessionCountsByChannel);
    const byHour = foldByHour(byHourRows.map((r) => ({ hour: r.hourBucket, count: r._count._all })));
    const byWeekday = foldByWeekday(byWeekdayRows.map((r) => ({ dayBucket: r.dayBucket, isAnswered: r.isAnswered, count: r._count._all })));

    return {
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      granularity,
      ...this.scopeMeta(resolved, backfillPending),
      bySource,
      byChannel,
      byHour,
      byWeekday,
    };
  }

  /** 질문 순위 + 최다 챗봇 귀속(§5.6, P-5). */
  async getQuestions(query: IntegratedQuestionsQuery): Promise<IntegratedQuestions> {
    const { resolved } = await this.resolveScope(query.scope, query.groupId);
    const granularity = 'DAY' as const;
    const period = resolveStatsPeriodOrThrow(query.from, query.to, granularity, this.readLimits());

    let excludeChatbotIds: string[] = [];
    if (!query.includeArchivedChatbots) {
      const archived = await this.prisma.chatbot.findMany({
        where: { status: 'ARCHIVED', ...(resolved.scope === 'GROUP' ? { groupId: resolved.groupId } : {}) },
        select: { id: true },
      });
      excludeChatbotIds = archived.map((a) => a.id);
    }

    const baseWhere = {
      ...scopeLogWhere(resolved),
      dayBucket: { gte: period.fromDayBucket, lte: period.toDayBucket },
      ...(excludeChatbotIds.length > 0 ? { chatbotId: { notIn: excludeChatbotIds } } : {}),
    };

    const [topRows, unansweredRows, backfillPending] = await runWithAggregationTimeout(
      Promise.all([
        this.prisma.conversationLog.groupBy({
          by: ['userMessage'],
          where: baseWhere,
          _count: { _all: true },
          _max: { createdAt: true },
          orderBy: { _count: { userMessage: 'desc' } },
          take: TOP_QUESTION_CANDIDATE_LIMIT,
        }),
        this.prisma.conversationLog.groupBy({
          by: ['userMessage'],
          where: { ...baseWhere, isAnswered: false, blockedByFilter: false },
          _count: { _all: true },
          _max: { createdAt: true },
          orderBy: { _count: { userMessage: 'desc' } },
          take: TOP_QUESTION_CANDIDATE_LIMIT,
        }),
        this.checkBackfillPending(),
      ]),
    );

    const topQuestions = aggregateTopQuestions(
      topRows.map((r) => ({ question: r.userMessage, count: r._count._all, lastOccurredAt: r._max.createdAt ?? period.periodStart })),
      query.topN,
    );
    const topUnanswered = aggregateTopQuestions(
      unansweredRows.map((r) => ({ question: r.userMessage, count: r._count._all, lastOccurredAt: r._max.createdAt ?? period.periodStart })),
      query.topN,
    );

    const questionTexts = new Set([...topQuestions.map((q) => q.question), ...topUnanswered.map((q) => q.question)]);
    let topChatbotByQuestion = new Map<string, { chatbotId: string }>();

    if (questionTexts.size > 0) {
      const variantMessages = Array.from(
        new Set([...topRows, ...unansweredRows].map((r) => r.userMessage).filter((m) => questionTexts.has(normalizeQuestion(m)))),
      );
      if (variantMessages.length > 0) {
        const attributionRows = await this.prisma.conversationLog.groupBy({
          by: ['userMessage', 'chatbotId'],
          where: { ...scopeLogWhere(resolved), dayBucket: { gte: period.fromDayBucket, lte: period.toDayBucket }, userMessage: { in: variantMessages } },
          _count: { _all: true },
          _max: { createdAt: true },
        });
        topChatbotByQuestion = attributeTopChatbot(
          Array.from(questionTexts),
          attributionRows.map((r) => ({ userMessage: r.userMessage, chatbotId: r.chatbotId, count: r._count._all, lastOccurredAt: r._max.createdAt ?? period.periodStart })),
        );
      }
    }

    const chatbotIds = Array.from(new Set(Array.from(topChatbotByQuestion.values()).map((v) => v.chatbotId)));
    const chatbots = chatbotIds.length > 0 ? await this.prisma.chatbot.findMany({ where: { id: { in: chatbotIds } }, select: { id: true, name: true } }) : [];
    const nameById = new Map(chatbots.map((c) => [c.id, c.name]));

    const decorate = (qs: Array<{ question: string; count: number }>): IntegratedQuestionItem[] =>
      qs.map((q) => {
        const top = topChatbotByQuestion.get(q.question);
        return { question: q.question, count: q.count, topChatbotId: top?.chatbotId ?? null, topChatbotName: top ? (nameById.get(top.chatbotId) ?? null) : null };
      });

    return {
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      granularity,
      ...this.scopeMeta(resolved, backfillPending),
      topQuestions: decorate(topQuestions),
      topUnansweredQuestions: decorate(topUnanswered),
      approximated: topRows.length >= TOP_QUESTION_CANDIDATE_LIMIT || unansweredRows.length >= TOP_QUESTION_CANDIDATE_LIMIT,
      candidateLimit: TOP_QUESTION_CANDIDATE_LIMIT,
      includeArchivedChatbots: query.includeArchivedChatbots,
    };
  }

  /** 기여 표 — GROUP=챗봇별 / ALL=그룹별(§5.5). */
  async getBreakdown(query: IntegratedBreakdownQuery): Promise<IntegratedBreakdown> {
    const { resolved } = await this.resolveScope(query.scope, query.groupId);
    const granularity = 'DAY' as const;
    const period = resolveStatsPeriodOrThrow(query.from, query.to, granularity, this.readLimits());
    const backfillPending = await this.checkBackfillPending();

    if (resolved.scope === 'GROUP') {
      return this.getBreakdownForGroup(resolved, period, backfillPending);
    }
    return this.getBreakdownForAll(period, backfillPending);
  }

  private async getBreakdownForGroup(
    resolved: { scope: 'GROUP'; groupId: string },
    period: { fromDayBucket: string; toDayBucket: string; periodStart: Date; periodEnd: Date },
    backfillPending: boolean,
  ): Promise<IntegratedBreakdown> {
    const where = { groupId: resolved.groupId, dayBucket: { gte: period.fromDayBucket, lte: period.toDayBucket } };

    const [byChatbot, sessionRows] = await runWithAggregationTimeout(
      Promise.all([
        this.prisma.conversationLog.groupBy({ by: ['chatbotId', 'isAnswered'], where, _count: { _all: true } }),
        this.sessionQuery.count({ scope: resolved, period: { fromDayBucket: period.fromDayBucket, toDayBucket: period.toDayBucket }, groupBy: 'CHATBOT' }),
      ]),
    );

    const metricsByChatbot = new Map<string, { turnCount: number; answeredCount: number }>();
    for (const row of byChatbot) {
      const m = metricsByChatbot.get(row.chatbotId) ?? { turnCount: 0, answeredCount: 0 };
      m.turnCount += row._count._all;
      if (row.isAnswered) m.answeredCount += row._count._all;
      metricsByChatbot.set(row.chatbotId, m);
    }
    const sessionByChatbot = new Map(sessionRows.map((r) => [r.key as string, r.distinctSessions + r.nullSessions]));

    const contributingIds = Array.from(metricsByChatbot.keys());
    const chatbots = await this.prisma.chatbot.findMany({ where: { OR: [{ id: { in: contributingIds } }, { groupId: resolved.groupId }] } });

    const currentGroupIds = Array.from(new Set(chatbots.map((c) => c.groupId).filter((g) => g !== resolved.groupId)));
    const otherGroups = currentGroupIds.length > 0 ? await this.prisma.chatbotGroup.findMany({ where: { id: { in: currentGroupIds } } }) : [];
    const groupNameById = new Map(otherGroups.map((g) => [g.id, g.name]));

    type Extra = { status: ChatbotStatus; archivedAt: Date | null; currentGroupId: string | null; currentGroupName: string | null };
    const sourceRows: BreakdownSourceRow<Extra>[] = chatbots.map((bot) => {
      const m = metricsByChatbot.get(bot.id) ?? { turnCount: 0, answeredCount: 0 };
      const parsedStatus = ChatbotStatus.safeParse(bot.status);
      const movedAway = bot.groupId !== resolved.groupId;
      return {
        id: bot.id,
        name: bot.name,
        turnCount: m.turnCount,
        answeredCount: m.answeredCount,
        sessionCount: sessionByChatbot.get(bot.id) ?? 0,
        extra: {
          status: parsedStatus.success ? parsedStatus.data : 'DRAFT',
          archivedAt: bot.archivedAt,
          currentGroupId: movedAway ? bot.groupId : null,
          currentGroupName: movedAway ? (groupNameById.get(bot.groupId) ?? null) : null,
        },
      };
    });

    const assembled = assembleBreakdown(sourceRows, { maxRows: INTEGRATED_STATS_LIMITS.breakdownMaxRows });

    const items: IntegratedBreakdownItem[] = assembled.items.map((r) => ({
      kind: 'CHATBOT' as const,
      id: r.id,
      name: r.name,
      status: r.extra.status,
      archivedAt: r.extra.archivedAt,
      currentGroupId: r.extra.currentGroupId,
      currentGroupName: r.extra.currentGroupName,
      turnCount: r.turnCount,
      answeredCount: r.answeredCount,
      unansweredCount: r.unansweredCount,
      sessionCount: r.sessionCount,
      responseRate: r.responseRate,
      share: r.share,
    }));

    const totals = {
      turnCount: sourceRows.reduce((s, r) => s + r.turnCount, 0),
      sessionCount: sourceRows.reduce((s, r) => s + r.sessionCount, 0),
    };

    return {
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      granularity: 'DAY',
      ...this.scopeMeta(resolved, backfillPending),
      items,
      othersRow: assembled.othersRow,
      unassignedRow: null,
      totals,
      shareScale: 10000,
    };
  }

  private async getBreakdownForAll(
    period: { fromDayBucket: string; toDayBucket: string; periodStart: Date; periodEnd: Date },
    backfillPending: boolean,
  ): Promise<IntegratedBreakdown> {
    const resolved: ResolvedScope = { scope: 'ALL' };
    const where = { dayBucket: { gte: period.fromDayBucket, lte: period.toDayBucket } };

    const [byGroup, sessionRows] = await runWithAggregationTimeout(
      Promise.all([
        this.prisma.conversationLog.groupBy({ by: ['groupId', 'isAnswered'], where, _count: { _all: true } }),
        this.sessionQuery.count({ scope: resolved, period: { fromDayBucket: period.fromDayBucket, toDayBucket: period.toDayBucket }, groupBy: 'GROUP' }),
      ]),
    );

    const metricsByGroup = new Map<string, { turnCount: number; answeredCount: number }>();
    let unassignedTurn = 0;
    let unassignedAnswered = 0;
    for (const row of byGroup) {
      if (row.groupId === '') {
        unassignedTurn += row._count._all;
        if (row.isAnswered) unassignedAnswered += row._count._all;
        continue;
      }
      const m = metricsByGroup.get(row.groupId) ?? { turnCount: 0, answeredCount: 0 };
      m.turnCount += row._count._all;
      if (row.isAnswered) m.answeredCount += row._count._all;
      metricsByGroup.set(row.groupId, m);
    }

    const sessionByGroup = new Map<string, number>();
    let unassignedSession = 0;
    for (const r of sessionRows) {
      const s = r.distinctSessions + r.nullSessions;
      if (r.key === '' || r.key === null) unassignedSession += s;
      else sessionByGroup.set(r.key, s);
    }

    const allGroups = await this.prisma.chatbotGroup.findMany(); // 보관 포함 전체
    const knownIds = new Set(allGroups.map((g) => g.id));
    const missingIds = Array.from(metricsByGroup.keys()).filter((id) => !knownIds.has(id));

    type Extra = { createdAt: Date | null; archived: boolean; archivedAt: Date | null; missing: boolean };
    const sourceRows: BreakdownSourceRow<Extra>[] = [];
    for (const g of allGroups) {
      const m = metricsByGroup.get(g.id) ?? { turnCount: 0, answeredCount: 0 };
      sourceRows.push({
        id: g.id,
        name: g.name,
        turnCount: m.turnCount,
        answeredCount: m.answeredCount,
        sessionCount: sessionByGroup.get(g.id) ?? 0,
        extra: { createdAt: g.createdAt, archived: g.archivedAt !== null, archivedAt: g.archivedAt, missing: false },
      });
    }
    for (const id of missingIds) {
      const m = metricsByGroup.get(id)!;
      sourceRows.push({
        id,
        name: `알 수 없는 그룹(${id.slice(0, 8)})`,
        turnCount: m.turnCount,
        answeredCount: m.answeredCount,
        sessionCount: sessionByGroup.get(id) ?? 0,
        extra: { createdAt: null, archived: false, archivedAt: null, missing: true },
      });
    }

    const unassigned = unassignedTurn > 0 || unassignedSession > 0 ? { turnCount: unassignedTurn, answeredCount: unassignedAnswered, sessionCount: unassignedSession } : undefined;
    const assembled = assembleBreakdown(sourceRows, { maxRows: INTEGRATED_STATS_LIMITS.breakdownMaxRows, unassigned });

    const items: IntegratedBreakdownItem[] = assembled.items.map((r) => ({
      kind: 'GROUP' as const,
      id: r.id,
      name: r.name,
      createdAt: r.extra.createdAt,
      archived: r.extra.archived,
      archivedAt: r.extra.archivedAt,
      missing: r.extra.missing,
      turnCount: r.turnCount,
      answeredCount: r.answeredCount,
      unansweredCount: r.unansweredCount,
      sessionCount: r.sessionCount,
      responseRate: r.responseRate,
      share: r.share,
    }));

    const totalTurn = sourceRows.reduce((s, r) => s + r.turnCount, 0) + unassignedTurn;
    const totalSession = sourceRows.reduce((s, r) => s + r.sessionCount, 0) + unassignedSession;

    return {
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      granularity: 'DAY',
      ...this.scopeMeta(resolved, backfillPending),
      items,
      othersRow: assembled.othersRow,
      unassignedRow: assembled.unassignedRow,
      totals: { turnCount: totalTurn, sessionCount: totalSession },
      shareScale: 10000,
    };
  }

  /** 스코프 선택기(§18 D-1) — 보관 그룹 포함, 상한 1,000 + `truncated`. */
  async getGroupOptions(): Promise<IntegratedGroupOptions> {
    const rows = await this.prisma.chatbotGroup.findMany({
      include: { _count: { select: { chatbots: true } } },
      take: INTEGRATED_STATS_LIMITS.groupOptionsMax + 1,
    });
    const truncated = rows.length > INTEGRATED_STATS_LIMITS.groupOptionsMax;
    const sliced = rows.slice(0, INTEGRATED_STATS_LIMITS.groupOptionsMax);

    const active = sliced.filter((r) => r.archivedAt === null).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const archived = sliced.filter((r) => r.archivedAt !== null).sort((a, b) => b.archivedAt!.getTime() - a.archivedAt!.getTime());

    return {
      items: [...active, ...archived].map((r) => ({ id: r.id, name: r.name, createdAt: r.createdAt, archivedAt: r.archivedAt, chatbotCount: r._count.chatbots })),
      truncated,
    };
  }
}
