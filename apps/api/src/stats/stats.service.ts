import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { normalizeText } from '@chat-bot/shared-types';
import type {
  DashboardQuery,
  DashboardSummary,
  StatsDistribution,
  StatsDistributionQuery,
  StatsQuery,
  StatsQuestions,
  StatsQuestionsQuery,
  StatsSummary,
} from '@chat-bot/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { ChatbotsService } from '../chatbots/chatbots.service';
import { ApiException } from '../common/api.exception';
import { InvalidPeriodError, resolveDashboardPeriod } from './lib/dashboard-period';
import {
  TOP_QUESTION_CANDIDATE_LIMIT as DASHBOARD_TOP_QUESTION_CANDIDATE_LIMIT,
  aggregateTopQuestions,
  computeResponseRates,
  computeVisitCount,
} from './lib/dashboard-aggregator';
import { buildBuckets, foldDayRows } from './lib/bucket';
import { assembleByChannel, assembleBySource, assembleSummaryBuckets, computeTurnsPerSession } from './lib/summary-assembler';
import { foldByHour, foldByWeekday, foldSessionCountsByBucket, foldSessionCountsByChannel } from './lib/usage-trend';
import { parseGranularityOrThrow, readStatsRangeLimits, resolveStatsPeriodOrThrow, runWithAggregationTimeout } from './stats-request.helpers';

/** 정규화 병합으로 순위가 바뀔 여지를 남기면서도 응답을 예측 가능하게 유지하는 후보 상한(ADR-0004). */
const TOP_QUESTION_CANDIDATE_LIMIT = 500;

interface SessionCountRow {
  distinctSessions: number | bigint | null;
  nullSessions: number | bigint | null;
}

@Injectable()
export class StatsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly chatbotsService: ChatbotsService,
    private readonly config: ConfigService,
  ) {}

  /** No.2 대시보드 집계(FR-2-1~FR-2-14, ADR-0004). ARCHIVED 챗봇도 조회를 허용한다(FR-2-11).
   * ⚠ [No.29] 이 메서드와 원시 SQL(아래 `$queryRaw`)은 한 글자도 바꾸지 않는다(FR-0-90, 설계서 §2.5). */
  async getDashboard(query: DashboardQuery): Promise<DashboardSummary> {
    const exists = await this.chatbotsService.existsById(query.chatbotId);
    if (!exists) {
      throw new ApiException('NOT_FOUND', 404, '요청하신 대상을 찾을 수 없습니다.');
    }

    const period = this.resolvePeriodOrThrow(query.from, query.to);

    const where = {
      chatbotId: query.chatbotId,
      createdAt: { gte: period.periodStart, lte: period.periodEnd },
    };

    const [byAnswered, sessionRows, topQuestionRows] = await runWithAggregationTimeout(
      Promise.all([
        this.prisma.conversationLog.groupBy({
          by: ['isAnswered'],
          where,
          _count: { _all: true },
        }),
        this.prisma.$queryRaw<SessionCountRow[]>`
          SELECT
            COUNT(DISTINCT CASE WHEN "sessionId" IS NOT NULL THEN "sessionId" END) AS "distinctSessions",
            COUNT(CASE WHEN "sessionId" IS NULL THEN 1 END) AS "nullSessions"
          FROM "conversation_logs"
          WHERE "chatbotId" = ${query.chatbotId}
            AND "createdAt" >= ${period.periodStart}
            AND "createdAt" <= ${period.periodEnd}
        `,
        this.prisma.conversationLog.groupBy({
          by: ['userMessage'],
          where,
          _count: { _all: true },
          _max: { createdAt: true },
          orderBy: { _count: { userMessage: 'desc' } },
          take: TOP_QUESTION_CANDIDATE_LIMIT,
        }),
      ]),
    );

    const totalLogCount = byAnswered.reduce((sum, row) => sum + row._count._all, 0);
    const answeredCount = byAnswered.find((row) => row.isAnswered)?._count._all ?? 0;
    const { responseRate, noResponseRate } = computeResponseRates({ answeredCount, totalCount: totalLogCount });

    const sessionRow = sessionRows[0];
    const { visitCount, visitCountBasis } = computeVisitCount({
      distinctSessionCount: Number(sessionRow?.distinctSessions ?? 0),
      nullSessionCount: Number(sessionRow?.nullSessions ?? 0),
    });

    const topQuestions = aggregateTopQuestions(
      topQuestionRows.map((row) => ({
        question: row.userMessage,
        count: row._count._all,
        lastOccurredAt: row._max.createdAt ?? period.periodStart,
      })),
      query.topN,
    );

    return {
      chatbotId: query.chatbotId,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      visitCount,
      visitCountBasis,
      totalLogCount,
      responseRate,
      noResponseRate,
      topQuestions,
    };
  }

  /** No.14 기간 시계열 요약(FR-14-4~19, §7.1~7.2). ARCHIVED 챗봇도 조회를 허용한다(EX-14-10). */
  async getSummary(query: StatsQuery): Promise<StatsSummary> {
    await this.assertChatbotExists(query.chatbotId);
    const granularity = parseGranularityOrThrow(query.granularity);
    const period = resolveStatsPeriodOrThrow(query.from, query.to, granularity, this.readRangeLimits());

    const where = {
      chatbotId: query.chatbotId,
      dayBucket: { gte: period.fromDayBucket, lte: period.toDayBucket },
    };

    const [byDay, sessionRows] = await runWithAggregationTimeout(
      Promise.all([
        this.prisma.conversationLog.groupBy({
          by: ['dayBucket', 'isAnswered', 'blockedByFilter'],
          where,
          _count: { _all: true },
        }),
        this.prisma.conversationLog.groupBy({
          by: ['dayBucket', 'channelType', 'sessionId'],
          where,
          _count: { _all: true },
        }),
      ]),
    );

    const buckets = buildBuckets(period.fromDayBucket, period.toDayBucket, granularity);
    const dayRows = byDay.map((row) => ({
      dayBucket: row.dayBucket,
      isAnswered: row.isAnswered,
      blockedByFilter: row.blockedByFilter,
      count: row._count._all,
    }));
    const folded = foldDayRows(dayRows, granularity);
    const sessionRowsMapped = sessionRows.map((row) => ({
      dayBucket: row.dayBucket,
      channelType: row.channelType,
      sessionId: row.sessionId,
      count: row._count._all,
    }));
    const sessionCountsByBucket = foldSessionCountsByBucket(sessionRowsMapped, granularity);

    // 버킷 조립·총계(FR-0-89) — 챗봇·통합 요약 공용 순수 함수(lib/summary-assembler.ts).
    const { bucketResults, totals: bucketTotals } = assembleSummaryBuckets(buckets, folded, sessionCountsByBucket);

    // 기간 전체 세션수 — 기존 computeVisitCount()를 그대로 재사용해 대시보드와 정의를 한 벌로 유지한다(AC-14A-9).
    const distinctSessionIds = new Set<string>();
    let nullSessionCount = 0;
    for (const row of sessionRowsMapped) {
      if (row.sessionId != null) distinctSessionIds.add(row.sessionId);
      else nullSessionCount += row.count;
    }
    const { visitCount, visitCountBasis } = computeVisitCount({
      distinctSessionCount: distinctSessionIds.size,
      nullSessionCount,
    });
    const turnsPerSession = computeTurnsPerSession(bucketTotals.turnCount, visitCount);

    return {
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      granularity,
      timezone: 'Asia/Seoul',
      totals: {
        ...bucketTotals,
        sessionCount: visitCount,
        visitCountBasis,
        turnsPerSession,
      },
      buckets: bucketResults,
    };
  }

  /** No.14 응답 출처·채널·시간대·요일 분포(FR-14-20~30, §7.3). 단위 개념이 없어 항상 DAY 기본기간을 쓴다. */
  async getDistribution(query: StatsDistributionQuery): Promise<StatsDistribution> {
    await this.assertChatbotExists(query.chatbotId);
    const granularity = 'DAY' as const;
    const period = resolveStatsPeriodOrThrow(query.from, query.to, granularity, this.readRangeLimits());

    const where = {
      chatbotId: query.chatbotId,
      dayBucket: { gte: period.fromDayBucket, lte: period.toDayBucket },
    };

    const [bySourceRows, byHourRows, byWeekdayRows, sessionRows] = await runWithAggregationTimeout(
      Promise.all([
        this.prisma.conversationLog.groupBy({
          by: ['matchedNodeId', 'matchedFaqId', 'isAnswered', 'answeredByRag'],
          where,
          _count: { _all: true },
        }),
        this.prisma.conversationLog.groupBy({
          by: ['hourBucket'],
          where,
          _count: { _all: true },
        }),
        this.prisma.conversationLog.groupBy({
          by: ['dayBucket', 'isAnswered'],
          where,
          _count: { _all: true },
        }),
        this.prisma.conversationLog.groupBy({
          by: ['channelType', 'sessionId'],
          where,
          _count: { _all: true },
        }),
      ]),
    );

    // 출처/채널 비율 조립(FR-0-89) — 챗봇·통합 분포 공용 순수 함수(lib/summary-assembler.ts).
    const bySource = assembleBySource(
      bySourceRows.map((row) => ({
        matchedNodeId: row.matchedNodeId,
        matchedFaqId: row.matchedFaqId,
        isAnswered: row.isAnswered,
        answeredByRag: row.answeredByRag,
        count: row._count._all,
      })),
    );

    const sessionCountsByChannel = foldSessionCountsByChannel(
      sessionRows.map((row) => ({ dayBucket: '', channelType: row.channelType, sessionId: row.sessionId, count: row._count._all })),
    );
    const byChannel = assembleByChannel(sessionCountsByChannel);

    const byHour = foldByHour(byHourRows.map((row) => ({ hour: row.hourBucket, count: row._count._all })));
    const byWeekday = foldByWeekday(byWeekdayRows.map((row) => ({ dayBucket: row.dayBucket, isAnswered: row.isAnswered, count: row._count._all })));

    return {
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      granularity,
      timezone: 'Asia/Seoul',
      bySource,
      byChannel,
      byHour,
      byWeekday,
    };
  }

  /** No.14 질문순위(FR-14-23~27, §7.4). `aggregateTopQuestions`를 시그니처 변경 없이 재사용한다. */
  async getQuestions(query: StatsQuestionsQuery): Promise<StatsQuestions> {
    await this.assertChatbotExists(query.chatbotId);
    const granularity = 'DAY' as const;
    const period = resolveStatsPeriodOrThrow(query.from, query.to, granularity, this.readRangeLimits());

    const where = {
      chatbotId: query.chatbotId,
      dayBucket: { gte: period.fromDayBucket, lte: period.toDayBucket },
    };

    const [topRows, unansweredRows] = await runWithAggregationTimeout(
      Promise.all([
        this.prisma.conversationLog.groupBy({
          by: ['userMessage'],
          where,
          _count: { _all: true },
          _max: { createdAt: true },
          orderBy: { _count: { userMessage: 'desc' } },
          take: DASHBOARD_TOP_QUESTION_CANDIDATE_LIMIT,
        }),
        this.prisma.conversationLog.groupBy({
          by: ['userMessage'],
          where: { ...where, isAnswered: false, blockedByFilter: false },
          _count: { _all: true },
          _max: { createdAt: true },
          orderBy: { _count: { userMessage: 'desc' } },
          take: DASHBOARD_TOP_QUESTION_CANDIDATE_LIMIT,
        }),
      ]),
    );

    const topQuestions = aggregateTopQuestions(
      topRows.map((row) => ({ question: row.userMessage, count: row._count._all, lastOccurredAt: row._max.createdAt ?? period.periodStart })),
      query.topN,
    );
    const topUnanswered = aggregateTopQuestions(
      unansweredRows.map((row) => ({ question: row.userMessage, count: row._count._all, lastOccurredAt: row._max.createdAt ?? period.periodStart })),
      query.topN,
    );

    // FR-14-25 — 학습현황 큐 항목이 있으면 딥링크용 id를 붙인다(정규화 키 1회 조회, N+1 금지).
    const normalizedToQuestion = new Map<string, string>();
    for (const { question } of topUnanswered) {
      normalizedToQuestion.set(normalizeText(question), question);
    }
    let unansweredIdByQuestion = new Map<string, string>();
    if (normalizedToQuestion.size > 0) {
      const matches = await this.prisma.unansweredQuestion.findMany({
        where: { chatbotId: query.chatbotId, questionNormalized: { in: Array.from(normalizedToQuestion.keys()) } },
        select: { id: true, questionNormalized: true },
      });
      unansweredIdByQuestion = new Map(
        matches
          .map((m): [string, string] => [normalizedToQuestion.get(m.questionNormalized) ?? '', m.id])
          .filter(([q]) => q !== ''),
      );
    }

    return {
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      granularity,
      timezone: 'Asia/Seoul',
      topQuestions,
      topUnansweredQuestions: topUnanswered.map((q) => ({ ...q, unansweredQuestionId: unansweredIdByQuestion.get(q.question) })),
      approximated: topRows.length >= DASHBOARD_TOP_QUESTION_CANDIDATE_LIMIT || unansweredRows.length >= DASHBOARD_TOP_QUESTION_CANDIDATE_LIMIT,
      candidateLimit: DASHBOARD_TOP_QUESTION_CANDIDATE_LIMIT,
    };
  }

  private async assertChatbotExists(chatbotId: string): Promise<void> {
    const exists = await this.chatbotsService.existsById(chatbotId);
    if (!exists) {
      throw new ApiException('NOT_FOUND', 404, '요청하신 대상을 찾을 수 없습니다.');
    }
  }

  private readRangeLimits() {
    return readStatsRangeLimits(this.config);
  }

  private resolvePeriodOrThrow(from: Date | undefined, to: Date | undefined) {
    try {
      return resolveDashboardPeriod(from, to, new Date());
    } catch (e) {
      if (e instanceof InvalidPeriodError) {
        throw new ApiException('INVALID_PERIOD', 400, e.message);
      }
      throw e;
    }
  }
}
