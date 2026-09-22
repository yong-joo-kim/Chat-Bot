import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import {
  ContextListItem,
  ContextListQuery,
  ContextListQuerySchema,
  ContextVariable,
  CreateContextDto,
  CreateContextSchema,
  Paginated,
  UpdateContextDto,
  UpdateContextSchema,
} from '@chat-bot/shared-types';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ZodQueryPipe } from '../common/zod-query.pipe';
import { RequirePermission } from '../common/auth/require-permission.decorator';
import { ContextsService } from './contexts.service';

@Controller('chatbots/:chatbotId/contexts')
export class ContextsController {
  constructor(private readonly contextsService: ContextsService) {}

  @Post()
  @RequirePermission('dialogue:write')
  create(
    @Param('chatbotId') chatbotId: string,
    @Body(new ZodValidationPipe(CreateContextSchema)) dto: CreateContextDto,
  ): Promise<ContextVariable> {
    return this.contextsService.create(chatbotId, dto);
  }

  @Get()
  @RequirePermission('dialogue:read')
  list(
    @Param('chatbotId') chatbotId: string,
    @Query(new ZodQueryPipe(ContextListQuerySchema)) query: ContextListQuery,
  ): Promise<Paginated<ContextListItem>> {
    return this.contextsService.list(chatbotId, query);
  }

  @Get(':id')
  @RequirePermission('dialogue:read')
  findOne(@Param('chatbotId') chatbotId: string, @Param('id') id: string): Promise<ContextVariable> {
    return this.contextsService.findOne(chatbotId, id);
  }

  @Patch(':id')
  @RequirePermission('dialogue:write')
  update(
    @Param('chatbotId') chatbotId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateContextSchema)) dto: UpdateContextDto,
  ): Promise<ContextVariable> {
    return this.contextsService.update(chatbotId, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('dialogue:write')
  async remove(@Param('chatbotId') chatbotId: string, @Param('id') id: string): Promise<void> {
    await this.contextsService.remove(chatbotId, id);
  }
}
