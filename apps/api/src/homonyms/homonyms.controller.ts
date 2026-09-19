import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import {
  CreateHomonymDto,
  CreateHomonymSchema,
  HomonymDictionary,
  HomonymListItem,
  HomonymListQuery,
  HomonymListQuerySchema,
  HomonymTestRequestDto,
  HomonymTestRequestSchema,
  Paginated,
  UpdateHomonymDto,
  UpdateHomonymSchema,
} from '@chat-bot/shared-types';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ZodQueryPipe } from '../common/zod-query.pipe';
import { PermissionGuard } from '../common/auth/permission.guard';
import { RequirePermission } from '../common/auth/require-permission.decorator';
import { HomonymsService } from './homonyms.service';

@UseGuards(PermissionGuard)
@Controller('chatbots/:chatbotId/homonyms')
export class HomonymsController {
  constructor(private readonly homonymsService: HomonymsService) {}

  @Post()
  @RequirePermission('dialogue:write')
  create(
    @Param('chatbotId') chatbotId: string,
    @Body(new ZodValidationPipe(CreateHomonymSchema)) dto: CreateHomonymDto,
  ): Promise<HomonymDictionary> {
    return this.homonymsService.create(chatbotId, dto);
  }

  @Get()
  @RequirePermission('dialogue:read')
  list(
    @Param('chatbotId') chatbotId: string,
    @Query(new ZodQueryPipe(HomonymListQuerySchema)) query: HomonymListQuery,
  ): Promise<Paginated<HomonymListItem>> {
    return this.homonymsService.list(chatbotId, query);
  }

  @Post('test')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('dialogue:read')
  test(@Param('chatbotId') chatbotId: string, @Body(new ZodValidationPipe(HomonymTestRequestSchema)) dto: HomonymTestRequestDto) {
    return this.homonymsService.test(chatbotId, dto.text);
  }

  @Get(':id')
  @RequirePermission('dialogue:read')
  findOne(@Param('chatbotId') chatbotId: string, @Param('id') id: string): Promise<HomonymDictionary> {
    return this.homonymsService.findOne(chatbotId, id);
  }

  @Patch(':id')
  @RequirePermission('dialogue:write')
  update(
    @Param('chatbotId') chatbotId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateHomonymSchema)) dto: UpdateHomonymDto,
  ): Promise<HomonymDictionary> {
    return this.homonymsService.update(chatbotId, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('dialogue:write')
  async remove(@Param('chatbotId') chatbotId: string, @Param('id') id: string): Promise<void> {
    await this.homonymsService.remove(chatbotId, id);
  }
}
