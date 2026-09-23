import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import {
  CreateDeployScheduleSchema,
  DeployScheduleListQuerySchema,
  PreviewDeployScheduleSchema,
  ResumeDeployScheduleSchema,
  UpdateDeployScheduleSchema,
} from '@chat-bot/shared-types';
import type {
  CreateDeployScheduleDto,
  DeployScheduleDetail,
  DeployScheduleListItem,
  DeployScheduleListQuery,
  DeployScheduleNotice,
  DeploySchedulePreviewResponse,
  DeployScheduleStateCheck,
  Paginated,
  PreviewDeployScheduleDto,
  ResumeDeployScheduleDto,
  UpdateDeployScheduleDto,
} from '@chat-bot/shared-types';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ZodQueryPipe } from '../common/zod-query.pipe';
import { RequirePermission } from '../common/auth/require-permission.decorator';
import { CurrentUser } from '../common/auth/current-user.decorator';
import type { SessionUser } from '../common/auth/session-context';
import { DeployScheduleService } from './deploy-schedule.service';
import { DeployScheduleQueryService } from './deploy-schedule.query.service';
import { DeploySchedulePreviewService } from './preview/deploy-schedule-preview.service';

/**
 * [신규 2026-09-23 No.28] 챗봇 스코프 10개 핸들러(§13.1). `notice`·`preview`는 `:scheduleId`보다
 * 먼저 선언한다. 가드는 `chatbot:read` 기준선만 두고, 동작별 권한은 서비스가 판정한다(§8.2).
 */
@Controller('chatbots/:chatbotId/deploy-schedules')
export class DeploySchedulesController {
  constructor(
    private readonly service: DeployScheduleService,
    private readonly queryService: DeployScheduleQueryService,
    private readonly previewService: DeploySchedulePreviewService,
  ) {}

  @Get()
  @RequirePermission('chatbot:read')
  list(@Param('chatbotId') chatbotId: string, @Query(new ZodQueryPipe(DeployScheduleListQuerySchema)) query: DeployScheduleListQuery): Promise<Paginated<DeployScheduleListItem>> {
    return this.queryService.list(chatbotId, query);
  }

  @Get('notice')
  @RequirePermission('chatbot:read')
  notice(@Param('chatbotId') chatbotId: string): Promise<DeployScheduleNotice> {
    return this.queryService.notice(chatbotId);
  }

  @Post('preview')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('chatbot:read')
  preview(
    @Param('chatbotId') chatbotId: string,
    @Body(new ZodValidationPipe(PreviewDeployScheduleSchema)) dto: PreviewDeployScheduleDto,
  ): Promise<DeploySchedulePreviewResponse> {
    return this.previewService.preview(chatbotId, dto);
  }

  @Post()
  @RequirePermission('chatbot:read')
  create(
    @Param('chatbotId') chatbotId: string,
    @CurrentUser() user: SessionUser,
    @Body(new ZodValidationPipe(CreateDeployScheduleSchema)) dto: CreateDeployScheduleDto,
  ) {
    return this.service.create(chatbotId, user, dto);
  }

  @Get(':scheduleId')
  @RequirePermission('chatbot:read')
  detail(@Param('chatbotId') chatbotId: string, @Param('scheduleId') scheduleId: string): Promise<DeployScheduleDetail> {
    return this.queryService.detail(chatbotId, scheduleId);
  }

  @Post(':scheduleId/state-check')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('chatbot:read')
  stateCheck(@Param('chatbotId') chatbotId: string, @Param('scheduleId') scheduleId: string): Promise<DeployScheduleStateCheck> {
    return this.queryService.stateCheck(chatbotId, scheduleId);
  }

  @Patch(':scheduleId')
  @RequirePermission('chatbot:read')
  update(
    @Param('chatbotId') chatbotId: string,
    @Param('scheduleId') scheduleId: string,
    @CurrentUser() user: SessionUser,
    @Body(new ZodValidationPipe(UpdateDeployScheduleSchema)) dto: UpdateDeployScheduleDto,
  ): Promise<DeployScheduleDetail> {
    return this.service.update(chatbotId, scheduleId, user, dto);
  }

  @Post(':scheduleId/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('chatbot:read')
  cancel(@Param('chatbotId') chatbotId: string, @Param('scheduleId') scheduleId: string, @CurrentUser() user: SessionUser): Promise<DeployScheduleDetail> {
    return this.service.cancel(chatbotId, scheduleId, user);
  }

  @Post(':scheduleId/resume')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('chatbot:read')
  resume(
    @Param('chatbotId') chatbotId: string,
    @Param('scheduleId') scheduleId: string,
    @CurrentUser() user: SessionUser,
    @Body(new ZodValidationPipe(ResumeDeployScheduleSchema)) dto: ResumeDeployScheduleDto,
  ): Promise<DeployScheduleDetail> {
    return this.service.resume(chatbotId, scheduleId, user, dto);
  }

  @Post(':scheduleId/acknowledge')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('chatbot:read')
  acknowledge(@Param('chatbotId') chatbotId: string, @Param('scheduleId') scheduleId: string, @CurrentUser() user: SessionUser): Promise<DeployScheduleDetail> {
    return this.service.acknowledge(chatbotId, scheduleId, user);
  }
}
