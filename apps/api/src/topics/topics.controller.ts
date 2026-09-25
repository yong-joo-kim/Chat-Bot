import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import {
  CreateTopicDto,
  CreateTopicSchema,
  DeleteTopicQuery,
  DeleteTopicQuerySchema,
  MoveTopicDto,
  MoveTopicSchema,
  Topic,
  TopicImpactPreview,
  TopicImpactQuery,
  TopicImpactQuerySchema,
  TopicListResponse,
  TopicSplitPreview,
  TopicSplitRequestDto,
  TopicSplitRequestSchema,
  TopicSplitResult,
  TopicSplitSelection,
  TopicSplitSelectionSchema,
  UpdateTopicDto,
  UpdateTopicSchema,
} from '@chat-bot/shared-types';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ZodQueryPipe } from '../common/zod-query.pipe';
import { RequirePermission } from '../common/auth/require-permission.decorator';
import { TopicsService } from './topics.service';
import { TopicReadService } from './topic-read.service';
import { TopicSplitService } from './topic-split.service';

/**
 * [신규 No.22] `topic-system-설계.md` §16.1 — 정적 세그먼트(`split/preview`·`split`)를 `:topicId`
 * 핸들러보다 먼저 선언한다(라우트 매칭 순서).
 */
@Controller('chatbots/:chatbotId/topics')
export class TopicsController {
  constructor(
    private readonly topicsService: TopicsService,
    private readonly readService: TopicReadService,
    private readonly splitService: TopicSplitService,
  ) {}

  @Get()
  @RequirePermission('dialogue:read')
  list(@Param('chatbotId') chatbotId: string): Promise<TopicListResponse> {
    return this.readService.list(chatbotId);
  }

  @Post()
  @RequirePermission('dialogue:write')
  create(@Param('chatbotId') chatbotId: string, @Body(new ZodValidationPipe(CreateTopicSchema)) dto: CreateTopicDto): Promise<Topic> {
    return this.topicsService.create(chatbotId, dto);
  }

  @Post('split/preview')
  @RequirePermission('dialogue:read', 'chatbot:write')
  splitPreview(
    @Param('chatbotId') chatbotId: string,
    @Body(new ZodValidationPipe(TopicSplitSelectionSchema)) dto: TopicSplitSelection,
  ): Promise<TopicSplitPreview> {
    return this.splitService.preview(chatbotId, dto);
  }

  @Post('split')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('dialogue:read', 'chatbot:write')
  split(
    @Param('chatbotId') chatbotId: string,
    @Body(new ZodValidationPipe(TopicSplitRequestSchema)) dto: TopicSplitRequestDto,
  ): Promise<TopicSplitResult> {
    return this.splitService.split(chatbotId, dto);
  }

  @Get(':topicId/impact')
  @RequirePermission('dialogue:read')
  impact(
    @Param('chatbotId') chatbotId: string,
    @Param('topicId') topicId: string,
    @Query(new ZodQueryPipe(TopicImpactQuerySchema)) query: TopicImpactQuery,
  ): Promise<TopicImpactPreview> {
    return this.readService.impact(chatbotId, topicId, query);
  }

  @Patch(':topicId')
  @RequirePermission('dialogue:write')
  update(
    @Param('chatbotId') chatbotId: string,
    @Param('topicId') topicId: string,
    @Body(new ZodValidationPipe(UpdateTopicSchema)) dto: UpdateTopicDto,
  ): Promise<Topic> {
    return this.topicsService.update(chatbotId, topicId, dto);
  }

  @Delete(':topicId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('dialogue:write')
  async remove(
    @Param('chatbotId') chatbotId: string,
    @Param('topicId') topicId: string,
    @Query(new ZodQueryPipe(DeleteTopicQuerySchema)) query: DeleteTopicQuery,
  ): Promise<void> {
    await this.topicsService.remove(chatbotId, topicId, query);
  }

  @Post(':topicId/move')
  @RequirePermission('dialogue:write')
  async move(
    @Param('chatbotId') chatbotId: string,
    @Param('topicId') topicId: string,
    @Body(new ZodValidationPipe(MoveTopicSchema)) dto: MoveTopicDto,
  ): Promise<{ items: Topic[] }> {
    const items = await this.topicsService.move(chatbotId, topicId, dto);
    return { items };
  }

  @Post(':topicId/enable')
  @RequirePermission('dialogue:write')
  enable(@Param('chatbotId') chatbotId: string, @Param('topicId') topicId: string): Promise<Topic> {
    return this.topicsService.enable(chatbotId, topicId);
  }

  @Post(':topicId/disable')
  @RequirePermission('dialogue:write')
  disable(@Param('chatbotId') chatbotId: string, @Param('topicId') topicId: string): Promise<Topic> {
    return this.topicsService.disable(chatbotId, topicId);
  }
}
