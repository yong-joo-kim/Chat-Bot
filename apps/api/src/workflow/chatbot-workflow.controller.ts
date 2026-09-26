import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import {
  CreateWorkflowSubscriptionDto,
  CreateWorkflowSubscriptionSchema,
  Paginated,
  UpdateWorkflowSubscriptionDto,
  UpdateWorkflowSubscriptionSchema,
  WorkflowRunBulkRequestDto,
  WorkflowRunBulkRequestSchema,
  WorkflowRunBulkResult,
  WorkflowRunItem,
  WorkflowRunListQuery,
  WorkflowRunListQuerySchema,
  WorkflowSubscription,
  WorkflowSummaryResponse,
} from '@chat-bot/shared-types';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ZodQueryPipe } from '../common/zod-query.pipe';
import { RequirePermission } from '../common/auth/require-permission.decorator';
import { WorkflowSubscriptionsService } from './subscriptions/workflow-subscriptions.service';
import { WorkflowRunsQueryService } from './runs/workflow-runs-query.service';
import { WorkflowRunOpsService } from './runs/workflow-run-ops.service';
import { WorkflowSummaryService } from './runs/workflow-summary.service';

/**
 * [신규 No.41] 챗봇 스코프 업무 자동화 10 핸들러(§12.1) — 이벤트 구독 CRUD·정지/재개(§14) + 챗봇
 * 실행 이력·요약·재발송·취소(§7.7·§13.4). 구독 조회·이력·요약은 `chatbot:read` AND `dialogue:read`
 * (AGENT 배제), 구독 쓰기·재발송·취소는 `chatbot:write`.
 */
@Controller('chatbots/:chatbotId')
export class ChatbotWorkflowController {
  constructor(
    private readonly subscriptions: WorkflowSubscriptionsService,
    private readonly runsQuery: WorkflowRunsQueryService,
    private readonly runsOps: WorkflowRunOpsService,
    private readonly summary: WorkflowSummaryService,
  ) {}

  @Get('workflow-subscriptions')
  @RequirePermission('chatbot:read', 'dialogue:read')
  listSubscriptions(@Param('chatbotId') chatbotId: string): Promise<{ items: WorkflowSubscription[] }> {
    return this.subscriptions.list(chatbotId);
  }

  @Post('workflow-subscriptions')
  @RequirePermission('chatbot:write')
  createSubscription(
    @Param('chatbotId') chatbotId: string,
    @Body(new ZodValidationPipe(CreateWorkflowSubscriptionSchema)) dto: CreateWorkflowSubscriptionDto,
  ): Promise<WorkflowSubscription> {
    return this.subscriptions.create(chatbotId, dto);
  }

  @Patch('workflow-subscriptions/:subscriptionId')
  @RequirePermission('chatbot:write')
  updateSubscription(
    @Param('chatbotId') chatbotId: string,
    @Param('subscriptionId') subscriptionId: string,
    @Body(new ZodValidationPipe(UpdateWorkflowSubscriptionSchema)) dto: UpdateWorkflowSubscriptionDto,
  ): Promise<WorkflowSubscription> {
    return this.subscriptions.update(chatbotId, subscriptionId, dto);
  }

  @Delete('workflow-subscriptions/:subscriptionId')
  @RequirePermission('chatbot:write')
  async removeSubscription(@Param('chatbotId') chatbotId: string, @Param('subscriptionId') subscriptionId: string): Promise<void> {
    await this.subscriptions.remove(chatbotId, subscriptionId);
  }

  @Post('workflow-subscriptions/:subscriptionId/pause')
  @RequirePermission('chatbot:write')
  pauseSubscription(@Param('chatbotId') chatbotId: string, @Param('subscriptionId') subscriptionId: string): Promise<WorkflowSubscription> {
    return this.subscriptions.pause(chatbotId, subscriptionId);
  }

  @Post('workflow-subscriptions/:subscriptionId/resume')
  @RequirePermission('chatbot:write')
  resumeSubscription(@Param('chatbotId') chatbotId: string, @Param('subscriptionId') subscriptionId: string): Promise<WorkflowSubscription> {
    return this.subscriptions.resume(chatbotId, subscriptionId);
  }

  @Get('workflow-runs')
  @RequirePermission('chatbot:read', 'dialogue:read')
  listRuns(@Param('chatbotId') chatbotId: string, @Query(new ZodQueryPipe(WorkflowRunListQuerySchema)) query: WorkflowRunListQuery): Promise<Paginated<WorkflowRunItem>> {
    return this.runsQuery.list(query, { chatbotId });
  }

  @Get('workflow-runs/summary')
  @RequirePermission('chatbot:read', 'dialogue:read')
  runsSummary(@Param('chatbotId') chatbotId: string, @Query('days') daysParam?: string): Promise<WorkflowSummaryResponse> {
    const days = daysParam === '30' ? 30 : 7;
    return this.summary.summarize(days, { chatbotId });
  }

  @Post('workflow-runs/retry')
  @RequirePermission('chatbot:write')
  retryRuns(@Param('chatbotId') chatbotId: string, @Body(new ZodValidationPipe(WorkflowRunBulkRequestSchema)) dto: WorkflowRunBulkRequestDto): Promise<WorkflowRunBulkResult> {
    return this.runsOps.retry(chatbotId, dto);
  }

  @Post('workflow-runs/cancel')
  @RequirePermission('chatbot:write')
  cancelRuns(@Param('chatbotId') chatbotId: string, @Body(new ZodValidationPipe(WorkflowRunBulkRequestSchema)) dto: WorkflowRunBulkRequestDto): Promise<WorkflowRunBulkResult> {
    return this.runsOps.cancel(chatbotId, dto);
  }
}
