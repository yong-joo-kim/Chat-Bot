import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { IntentStats, IntentStatsQuery } from '@chat-bot/shared-types';
import { PrismaService } from '../../prisma/prisma.service';
import { ChatbotsService } from '../../chatbots/chatbots.service';
import { ApiException } from '../../common/api.exception';
import { readStatsRangeLimits, resolveStatsPeriodOrThrow, runWithAggregationTimeout } from '../stats-request.helpers';
import { foldIntentStats } from '../lib/intent-stats';

const NOT_FOUND_MESSAGE = '요청하신 대상을 찾을 수 없습니다.';

/** No.29 챗봇 스코프 의도별 매칭 통계(J-13, P-6). `ARCHIVED` 챗봇도 조회를 허용한다. */
@Injectable()
export class IntentStatsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly chatbotsService: ChatbotsService,
    private readonly config: ConfigService,
  ) {}

  async getIntentStats(query: IntentStatsQuery): Promise<IntentStats> {
    const exists = await this.chatbotsService.existsById(query.chatbotId);
    if (!exists) throw new ApiException('NOT_FOUND', 404, NOT_FOUND_MESSAGE);

    const granularity = 'DAY' as const;
    const period = resolveStatsPeriodOrThrow(query.from, query.to, granularity, readStatsRangeLimits(this.config));
    const where = { chatbotId: query.chatbotId, dayBucket: { gte: period.fromDayBucket, lte: period.toDayBucket } };

    const rows = await runWithAggregationTimeout(
      this.prisma.conversationLog.groupBy({ by: ['matchedIntentId', 'isAnswered'], where, _count: { _all: true } }),
    );

    const intentIds = Array.from(new Set(rows.map((r) => r.matchedIntentId).filter((id): id is string => id !== null)));
    const names =
      intentIds.length > 0
        ? await this.prisma.intent.findMany({ where: { chatbotId: query.chatbotId, id: { in: intentIds } }, select: { id: true, name: true } })
        : [];

    const folded = foldIntentStats(
      rows.map((r) => ({ matchedIntentId: r.matchedIntentId, isAnswered: r.isAnswered, count: r._count._all })),
      names,
      query.topN,
    );

    return {
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      granularity,
      timezone: 'Asia/Seoul',
      chatbotId: query.chatbotId,
      generatedAt: new Date(),
      ...folded,
    };
  }
}
