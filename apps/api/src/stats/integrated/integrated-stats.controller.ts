import { Controller, Get, Query } from '@nestjs/common';
import type {
  IntegratedBreakdown,
  IntegratedDistribution,
  IntegratedDistributionQuery,
  IntegratedGroupOptions,
  IntegratedOverview,
  IntegratedOverviewQuery,
  IntegratedQuestions,
  IntegratedQuestionsQuery,
  IntegratedStatsQuery,
  IntegratedBreakdownQuery,
  IntegratedSummary,
} from '@chat-bot/shared-types';
import {
  IntegratedDistributionQuerySchema,
  IntegratedOverviewQuerySchema,
  IntegratedQuestionsQuerySchema,
  IntegratedStatsQuerySchema,
  IntegratedBreakdownQuerySchema,
} from '@chat-bot/shared-types';
import { ZodQueryPipe } from '../../common/zod-query.pipe';
import { RequirePermission } from '../../common/auth/require-permission.decorator';
import { IntegratedStatsService } from './integrated-stats.service';

/** No.29 그룹·전역 스코프 통합 통계(§8.1) — 7개 중 6개(`GET /stats/intents`는 `StatsController`). */
@Controller('stats/integrated')
export class IntegratedStatsController {
  constructor(private readonly integratedStatsService: IntegratedStatsService) {}

  @Get('overview')
  @RequirePermission('chatbot:read')
  getOverview(@Query(new ZodQueryPipe(IntegratedOverviewQuerySchema)) query: IntegratedOverviewQuery): Promise<IntegratedOverview> {
    return this.integratedStatsService.getOverview(query);
  }

  @Get('summary')
  @RequirePermission('chatbot:read')
  getSummary(@Query(new ZodQueryPipe(IntegratedStatsQuerySchema)) query: IntegratedStatsQuery): Promise<IntegratedSummary> {
    return this.integratedStatsService.getSummary(query);
  }

  @Get('distribution')
  @RequirePermission('chatbot:read')
  getDistribution(@Query(new ZodQueryPipe(IntegratedDistributionQuerySchema)) query: IntegratedDistributionQuery): Promise<IntegratedDistribution> {
    return this.integratedStatsService.getDistribution(query);
  }

  @Get('questions')
  @RequirePermission('chatbot:read')
  getQuestions(@Query(new ZodQueryPipe(IntegratedQuestionsQuerySchema)) query: IntegratedQuestionsQuery): Promise<IntegratedQuestions> {
    return this.integratedStatsService.getQuestions(query);
  }

  @Get('breakdown')
  @RequirePermission('chatbot:read')
  getBreakdown(@Query(new ZodQueryPipe(IntegratedBreakdownQuerySchema)) query: IntegratedBreakdownQuery): Promise<IntegratedBreakdown> {
    return this.integratedStatsService.getBreakdown(query);
  }

  @Get('groups')
  @RequirePermission('chatbot:read')
  getGroupOptions(): Promise<IntegratedGroupOptions> {
    return this.integratedStatsService.getGroupOptions();
  }
}
