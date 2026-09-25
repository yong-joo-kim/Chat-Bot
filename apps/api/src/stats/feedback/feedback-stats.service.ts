import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FEEDBACK_LIMITS } from '@chat-bot/shared-types';
import type { FeedbackStats, FeedbackStatsQuery, FeedbackStatsTopTarget, FeedbackTargetKind } from '@chat-bot/shared-types';
import { PrismaService } from '../../prisma/prisma.service';
import { ChatbotsService } from '../../chatbots/chatbots.service';
import { ApiException } from '../../common/api.exception';
import { readStatsRangeLimits, resolveStatsPeriodOrThrow, runWithAggregationTimeout } from '../stats-request.helpers';
import { foldFeedbackStats } from '../lib/feedback-stats';
import type { FeedbackStatsTopTargetRaw } from '../lib/feedback-stats';

/**
 * 만족도 통계(No.44) — `GET /stats/feedback`(ADR-0038 §7). 읽기 전용 · 원시 SQL 0(R-7 불변) ·
 * `stats/**` 쓰기 0(R-8) · 대시보드(`getDashboard`) 무변경.
 */
@Injectable()
export class FeedbackStatsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly chatbotsService: ChatbotsService,
    private readonly config: ConfigService,
  ) {}

  async getFeedbackStats(query: FeedbackStatsQuery): Promise<FeedbackStats> {
    const exists = await this.chatbotsService.existsById(query.chatbotId);
    if (!exists) {
      throw new ApiException('NOT_FOUND', 404, '요청하신 대상을 찾을 수 없습니다.');
    }

    const granularity = 'DAY' as const;
    const period = resolveStatsPeriodOrThrow(query.from, query.to, granularity, readStatsRangeLimits(this.config));

    const [ratingByDay, offeredByDay, targetRatingRows] = await runWithAggregationTimeout(
      Promise.all([
        this.prisma.messageFeedback.groupBy({
          by: ['turnDayBucket', 'rating'],
          where: { chatbotId: query.chatbotId, turnDayBucket: { gte: period.fromDayBucket, lte: period.toDayBucket } },
          _count: { _all: true },
        }),
        this.prisma.conversationLog.groupBy({
          by: ['dayBucket'],
          where: { chatbotId: query.chatbotId, dayBucket: { gte: period.fromDayBucket, lte: period.toDayBucket }, feedbackOffered: true },
          _count: { _all: true },
        }),
        this.prisma.messageFeedback.groupBy({
          by: ['targetKind', 'targetId', 'rating'],
          where: { chatbotId: query.chatbotId, turnDayBucket: { gte: period.fromDayBucket, lte: period.toDayBucket } },
          _count: { _all: true },
        }),
      ]),
    );

    const folded = foldFeedbackStats({
      fromDayBucket: period.fromDayBucket,
      toDayBucket: period.toDayBucket,
      ratingByDay: ratingByDay.map((r) => ({ turnDayBucket: r.turnDayBucket, rating: r.rating, count: r._count._all })),
      offeredByDay: offeredByDay.map((r) => ({ dayBucket: r.dayBucket, count: r._count._all })),
      targetRatingRows: targetRatingRows.map((r) => ({ targetKind: r.targetKind, targetId: r.targetId, rating: r.rating, count: r._count._all })),
      topN: query.topN,
      lowSampleThreshold: FEEDBACK_LIMITS.lowSampleThreshold,
    });

    const topNegativeTargets = await this.resolveTargetNames(folded.topNegativeTargetsRaw);

    return {
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      granularity: 'DAY',
      timezone: 'Asia/Seoul',
      chatbotId: query.chatbotId,
      generatedAt: new Date(),
      totals: folded.totals,
      buckets: folded.buckets,
      topNegativeTargets,
      lowSampleThreshold: FEEDBACK_LIMITS.lowSampleThreshold,
    };
  }

  /** 이름 해석(존재 확인) — 대상 유형별 최대 1쿼리씩(§12.2 4~6). */
  private async resolveTargetNames(raw: FeedbackStatsTopTargetRaw[]): Promise<FeedbackStatsTopTarget[]> {
    const idsByKind = (kind: FeedbackTargetKind): string[] => raw.filter((r) => r.kind === kind && r.targetId).map((r) => r.targetId as string);
    const intentIds = idsByKind('INTENT');
    const faqIds = idsByKind('FAQ');
    const nodeIds = idsByKind('NODE');

    const [intents, faqs, nodes] = await Promise.all([
      intentIds.length > 0 ? this.prisma.intent.findMany({ where: { id: { in: intentIds } }, select: { id: true, name: true } }) : Promise.resolve([]),
      faqIds.length > 0 ? this.prisma.faqEntry.findMany({ where: { id: { in: faqIds } }, select: { id: true, question: true } }) : Promise.resolve([]),
      nodeIds.length > 0 ? this.prisma.dialogNode.findMany({ where: { id: { in: nodeIds } }, select: { id: true, name: true } }) : Promise.resolve([]),
    ]);
    const intentNameById = new Map(intents.map((i) => [i.id, i.name]));
    const faqNameById = new Map(faqs.map((f) => [f.id, f.question]));
    const nodeNameById = new Map(nodes.map((n) => [n.id, n.name]));

    return raw.map((r) => {
      const name =
        r.kind === 'INTENT'
          ? intentNameById.get(r.targetId ?? '')
          : r.kind === 'FAQ'
            ? faqNameById.get(r.targetId ?? '')
            : r.kind === 'NODE'
              ? nodeNameById.get(r.targetId ?? '')
              : undefined;
      return {
        kind: r.kind,
        targetId: r.targetId,
        name,
        deleted: !!r.targetId && name == null,
        downCount: r.downCount,
        upCount: r.upCount,
      };
    });
  }
}
