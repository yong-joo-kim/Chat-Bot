import { Controller, Get, Query } from '@nestjs/common';
import type {
  DashboardQuery,
  DashboardSummary,
  IntentStats,
  IntentStatsQuery,
  StatsDistribution,
  StatsDistributionQuery,
  StatsQuery,
  StatsQuestions,
  StatsQuestionsQuery,
  StatsSummary,
} from '@chat-bot/shared-types';
import {
  DashboardQuerySchema,
  IntentStatsQuerySchema,
  StatsDistributionQuerySchema,
  StatsQuerySchema,
  StatsQuestionsQuerySchema,
} from '@chat-bot/shared-types';
import { ZodQueryPipe } from '../common/zod-query.pipe';
import { RequirePermission } from '../common/auth/require-permission.decorator';
import { StatsService } from './stats.service';
import { IntentStatsService } from './intents/intent-stats.service';

/** No.14 기본 통계 + No.2 대시보드(변경 없음) + No.29 챗봇 스코프 의도별 매칭. 전부 `chatbot:read`, 읽기 전용(FR-0-35). */
@Controller('stats')
export class StatsController {
  constructor(
    private readonly statsService: StatsService,
    private readonly intentStatsService: IntentStatsService,
  ) {}

  @Get('dashboard')
  @RequirePermission('chatbot:read')
  getDashboard(@Query(new ZodQueryPipe(DashboardQuerySchema)) query: DashboardQuery): Promise<DashboardSummary> {
    return this.statsService.getDashboard(query);
  }

  @Get('summary')
  @RequirePermission('chatbot:read')
  getSummary(@Query(new ZodQueryPipe(StatsQuerySchema)) query: StatsQuery): Promise<StatsSummary> {
    return this.statsService.getSummary(query);
  }

  @Get('distribution')
  @RequirePermission('chatbot:read')
  getDistribution(@Query(new ZodQueryPipe(StatsDistributionQuerySchema)) query: StatsDistributionQuery): Promise<StatsDistribution> {
    return this.statsService.getDistribution(query);
  }

  @Get('questions')
  @RequirePermission('chatbot:read')
  getQuestions(@Query(new ZodQueryPipe(StatsQuestionsQuerySchema)) query: StatsQuestionsQuery): Promise<StatsQuestions> {
    return this.statsService.getQuestions(query);
  }

  /** [신규 No.29] 챗봇 스코프 의도별 매칭(J-13, P-6). */
  @Get('intents')
  @RequirePermission('chatbot:read')
  getIntentStats(@Query(new ZodQueryPipe(IntentStatsQuerySchema)) query: IntentStatsQuery): Promise<IntentStats> {
    return this.intentStatsService.getIntentStats(query);
  }
}
