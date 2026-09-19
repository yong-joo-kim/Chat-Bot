import { Injectable } from '@nestjs/common';
import type { DashboardQuery, DashboardSummary } from '@chat-bot/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { ChatbotsService } from '../chatbots/chatbots.service';
import { ApiException } from '../common/api.exception';
import { InvalidPeriodError, resolveDashboardPeriod } from './lib/dashboard-period';
import { aggregateTopQuestions, computeResponseRates, computeVisitCount } from './lib/dashboard-aggregator';

/** 정규화 병합으로 순위가 바뀔 여지를 남기면서도 응답을 예측 가능하게 유지하는 후보 상한(ADR-0004). */
const TOP_QUESTION_CANDIDATE_LIMIT = 500;
/** 집계 전체 타임아웃(EX-2-5). 초과 시 캐시된 과거 결과를 대신 반환하지 않는다. */
const AGGREGATION_TIMEOUT_MS = 5000;

interface SessionCountRow {
  distinctSessions: number | bigint | null;
  nullSessions: number | bigint | null;
}

@Injectable()
export class StatsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly chatbotsService: ChatbotsService,
  ) {}

  /** No.2 대시보드 집계(FR-2-1~FR-2-14, ADR-0004). ARCHIVED 챗봇도 조회를 허용한다(FR-2-11). */
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

    const [byAnswered, sessionRows, topQuestionRows] = await this.withTimeout(
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

  private async withTimeout<T>(promise: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('AGGREGATION_TIMEOUT')), AGGREGATION_TIMEOUT_MS);
    });
    try {
      return await Promise.race([promise, timeout]);
    } catch (e) {
      if (e instanceof Error && e.message === 'AGGREGATION_TIMEOUT') {
        throw new ApiException(
          'AGGREGATION_TIMEOUT',
          503,
          '지금은 통계를 불러올 수 없습니다. 잠시 후 다시 시도해 주세요.',
        );
      }
      throw e;
    } finally {
      clearTimeout(timer!);
    }
  }
}
