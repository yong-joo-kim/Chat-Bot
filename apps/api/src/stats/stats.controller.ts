import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import type { DashboardQuery, DashboardSummary } from '@chat-bot/shared-types';
import { DashboardQuerySchema } from '@chat-bot/shared-types';
import { ZodQueryPipe } from '../common/zod-query.pipe';
import { PermissionGuard } from '../common/auth/permission.guard';
import { RequirePermission } from '../common/auth/require-permission.decorator';
import { StatsService } from './stats.service';

@UseGuards(PermissionGuard)
@Controller('stats')
export class StatsController {
  constructor(private readonly statsService: StatsService) {}

  @Get('dashboard')
  @RequirePermission('chatbot:read')
  getDashboard(@Query(new ZodQueryPipe(DashboardQuerySchema)) query: DashboardQuery): Promise<DashboardSummary> {
    return this.statsService.getDashboard(query);
  }
}
