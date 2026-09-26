import { Controller, Get, Query } from '@nestjs/common';
import { Paginated, WorkflowRunItem, WorkflowRunListQuery, WorkflowRunListQuerySchema, WorkflowSummaryResponse } from '@chat-bot/shared-types';
import { ZodQueryPipe } from '../../common/zod-query.pipe';
import { RequirePermission } from '../../common/auth/require-permission.decorator';
import { WorkflowRunsQueryService } from './workflow-runs-query.service';
import { WorkflowSummaryService } from './workflow-summary.service';

/** [신규 No.41] 업무 자동화 전역 실행 이력·요약(§12.1). */
@Controller('workflow-runs')
export class WorkflowRunsController {
  constructor(
    private readonly queryService: WorkflowRunsQueryService,
    private readonly summaryService: WorkflowSummaryService,
  ) {}

  @Get()
  @RequirePermission('security:read')
  list(@Query(new ZodQueryPipe(WorkflowRunListQuerySchema)) query: WorkflowRunListQuery): Promise<Paginated<WorkflowRunItem>> {
    return this.queryService.list(query);
  }

  @Get('summary')
  @RequirePermission('security:read')
  summary(@Query('days') daysParam?: string): Promise<WorkflowSummaryResponse> {
    const days = daysParam === '30' ? 30 : 7;
    return this.summaryService.summarize(days);
  }
}
