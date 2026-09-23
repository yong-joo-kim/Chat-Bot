import { Controller, Get, Query } from '@nestjs/common';
import { DeployScheduleListQuerySchema } from '@chat-bot/shared-types';
import type { DeployScheduleListItem, DeployScheduleListQuery, DeployScheduleMeta, DeployScheduleSummary, Paginated } from '@chat-bot/shared-types';
import { ZodQueryPipe } from '../common/zod-query.pipe';
import { RequirePermission } from '../common/auth/require-permission.decorator';
import { DeployScheduleQueryService } from './deploy-schedule.query.service';

/** [신규 2026-09-23 No.28] 전역 3개 핸들러(§13.1) — 목록·요약·메타. `@Public()` 추가 0건. */
@Controller('deploy-schedules')
export class DeploySchedulesGlobalController {
  constructor(private readonly queryService: DeployScheduleQueryService) {}

  @Get()
  @RequirePermission('chatbot:read')
  list(@Query(new ZodQueryPipe(DeployScheduleListQuerySchema)) query: DeployScheduleListQuery): Promise<Paginated<DeployScheduleListItem>> {
    return this.queryService.list(undefined, query);
  }

  @Get('summary')
  @RequirePermission('chatbot:read')
  summary(): Promise<DeployScheduleSummary> {
    return this.queryService.summary();
  }

  @Get('meta')
  @RequirePermission('chatbot:read')
  meta(): Promise<DeployScheduleMeta> {
    return this.queryService.meta();
  }
}
