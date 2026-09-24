import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import {
  CannedResponse,
  CannedResponseListQuery,
  CannedResponseListQuerySchema,
  HandoffDetail,
  HandoffHistoryDetailResponse,
  HandoffHistoryItem,
  HandoffHistoryQuery,
  HandoffHistoryQuerySchema,
  HandoffSummaryResponse,
  MaskPreviewRequestDto,
  MaskPreviewRequestSchema,
  MaskPreviewResponse,
  Paginated,
  SendAgentMessageDto,
  SendAgentMessageResponse,
  SendAgentMessageSchema,
  TakeoverHandoffDto,
  TakeoverHandoffSchema,
} from '@chat-bot/shared-types';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RequirePermission } from '../common/auth/require-permission.decorator';
import { CurrentUser } from '../common/auth/current-user.decorator';
import type { SessionUser } from '../common/auth/session-context';
import { HandoffActionsService } from './handoff-actions.service';
import { HandoffHistoryService } from './handoff-history.service';
import { CannedResponsesService } from '../canned-responses/canned-responses.service';

/**
 * 상담 동작·이력(§17.1 ⑤~⑫). ⚠ 정적 세그먼트(`summary`·`canned-responses`·`mask-preview`)를
 * `:handoffId`보다 **먼저** 선언한다(Nest 라우트 매칭 순서).
 */
@Controller('chatbots/:chatbotId/handoffs')
export class HandoffsController {
  constructor(
    private readonly actions: HandoffActionsService,
    private readonly history: HandoffHistoryService,
    private readonly canned: CannedResponsesService,
  ) {}

  @Get('summary')
  @RequirePermission('cs:read')
  summary(@Param('chatbotId') chatbotId: string, @Query(new ZodValidationPipe(HandoffHistoryQuerySchema)) query: HandoffHistoryQuery): Promise<HandoffSummaryResponse> {
    return this.history.summary(chatbotId, query);
  }

  @Get('canned-responses')
  @RequirePermission('cs:read')
  searchCanned(@Param('chatbotId') chatbotId: string, @Query(new ZodValidationPipe(CannedResponseListQuerySchema)) query: CannedResponseListQuery): Promise<{ items: CannedResponse[] }> {
    return this.canned.search(chatbotId, query).then((items) => ({ items }));
  }

  @Post('mask-preview')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('cs:write')
  maskPreview(@Body(new ZodValidationPipe(MaskPreviewRequestSchema)) dto: MaskPreviewRequestDto): Promise<MaskPreviewResponse> {
    return this.actions.maskPreview(dto.text);
  }

  @Get()
  @RequirePermission('cs:read')
  list(@Param('chatbotId') chatbotId: string, @Query(new ZodValidationPipe(HandoffHistoryQuerySchema)) query: HandoffHistoryQuery): Promise<Paginated<HandoffHistoryItem>> {
    return this.history.list(chatbotId, query);
  }

  @Get(':handoffId')
  @RequirePermission('cs:read')
  detail(@Param('chatbotId') chatbotId: string, @Param('handoffId') handoffId: string): Promise<HandoffHistoryDetailResponse> {
    return this.history.detail(chatbotId, handoffId);
  }

  @Post(':handoffId/messages')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('cs:write')
  sendMessage(
    @Param('chatbotId') chatbotId: string,
    @Param('handoffId') handoffId: string,
    @Body(new ZodValidationPipe(SendAgentMessageSchema)) dto: SendAgentMessageDto,
    @CurrentUser() user: SessionUser,
  ): Promise<SendAgentMessageResponse> {
    return this.actions.sendMessage(chatbotId, handoffId, user, dto.text);
  }

  @Post(':handoffId/end')
  @RequirePermission('cs:write')
  end(@Param('chatbotId') chatbotId: string, @Param('handoffId') handoffId: string, @CurrentUser() user: SessionUser): Promise<HandoffDetail> {
    return this.actions.end(chatbotId, handoffId, user);
  }

  @Post(':handoffId/takeover')
  @RequirePermission('cs:write')
  takeover(
    @Param('chatbotId') chatbotId: string,
    @Param('handoffId') handoffId: string,
    @Body(new ZodValidationPipe(TakeoverHandoffSchema)) dto: TakeoverHandoffDto,
    @CurrentUser() user: SessionUser,
  ): Promise<HandoffDetail> {
    return this.actions.takeover(chatbotId, handoffId, user, dto.reason);
  }
}
