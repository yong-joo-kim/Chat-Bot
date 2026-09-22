import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import {
  ChatbotGroupWithCount,
  CopyChatbotGroupDto,
  CopyChatbotGroupSchema,
  CreateChatbotGroupDto,
  CreateChatbotGroupSchema,
  Paginated,
  PaginationQuery,
  PaginationQuerySchema,
  UpdateChatbotGroupDto,
  UpdateChatbotGroupSchema,
} from '@chat-bot/shared-types';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ZodQueryPipe } from '../common/zod-query.pipe';
import { RequirePermission } from '../common/auth/require-permission.decorator';
import { ChatbotGroupsService } from './chatbot-groups.service';

@Controller('chatbot-groups')
export class ChatbotGroupsController {
  constructor(private readonly chatbotGroupsService: ChatbotGroupsService) {}

  @Post()
  @RequirePermission('chatbot:write')
  create(@Body(new ZodValidationPipe(CreateChatbotGroupSchema)) dto: CreateChatbotGroupDto): Promise<ChatbotGroupWithCount> {
    return this.chatbotGroupsService.create(dto);
  }

  @Get()
  @RequirePermission('chatbot:read')
  list(@Query(new ZodQueryPipe(PaginationQuerySchema)) query: PaginationQuery): Promise<Paginated<ChatbotGroupWithCount>> {
    return this.chatbotGroupsService.list(query.page, query.pageSize);
  }

  @Get(':id')
  @RequirePermission('chatbot:read')
  findOne(@Param('id') id: string): Promise<ChatbotGroupWithCount> {
    return this.chatbotGroupsService.findOne(id);
  }

  @Patch(':id')
  @RequirePermission('chatbot:write')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateChatbotGroupSchema)) dto: UpdateChatbotGroupDto,
  ): Promise<ChatbotGroupWithCount> {
    return this.chatbotGroupsService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('chatbot:write')
  async remove(@Param('id') id: string): Promise<void> {
    await this.chatbotGroupsService.remove(id);
  }

  @Post(':id/copy')
  @RequirePermission('chatbot:write')
  copy(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(CopyChatbotGroupSchema)) dto: CopyChatbotGroupDto,
  ): Promise<ChatbotGroupWithCount> {
    return this.chatbotGroupsService.copy(id, dto);
  }
}
