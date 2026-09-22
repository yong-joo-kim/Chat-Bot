import { Controller, Get, Query } from '@nestjs/common';
import type { DashboardQuery, DashboardSummary } from '@chat-bot/shared-types';
import { DashboardQuerySchema } from '@chat-bot/shared-types';
import { ZodQueryPipe } from '../common/zod-query.pipe';
import { RequirePermission } from '../common/auth/require-permission.decorator';
import { StatsService } from './stats.service';

@Controller('stats')
export class StatsController {
  constructor(private readonly statsService: StatsService) {}

  @Get('dashboard')
  @RequirePermission('chatbot:read')
  getDashboard(@Query(new ZodQueryPipe(DashboardQuerySchema)) query: DashboardQuery): Promise<DashboardSummary> {
    return this.statsService.getDashboard(query);
  }
}
