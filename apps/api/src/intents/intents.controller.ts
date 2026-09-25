import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Response } from 'express';
import {
  BulkDeleteDto,
  BulkDeleteSchema,
  CreateIntentDto,
  CreateIntentSchema,
  ImportCommitRequestDto,
  ImportCommitRequestSchema,
  ImportCommitResult,
  ImportValidateResult,
  IntentDetail,
  IntentExampleMutationDto,
  IntentExampleMutationSchema,
  IntentListItem,
  IntentListQuery,
  IntentListQuerySchema,
  IntentMutationResult,
  Paginated,
  UpdateIntentDto,
  UpdateIntentSchema,
  IMPORT_LIMITS,
} from '@chat-bot/shared-types';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ZodQueryPipe } from '../common/zod-query.pipe';
import { RequirePermission } from '../common/auth/require-permission.decorator';
import { ApiException } from '../common/api.exception';
import { IntentsService } from './intents.service';

@Controller('chatbots/:chatbotId/intents')
export class IntentsController {
  constructor(private readonly intentsService: IntentsService) {}

  @Post()
  @RequirePermission('dialogue:write')
  create(
    @Param('chatbotId') chatbotId: string,
    @Body(new ZodValidationPipe(CreateIntentSchema)) dto: CreateIntentDto,
  ): Promise<IntentMutationResult> {
    return this.intentsService.create(chatbotId, dto);
  }

  @Get()
  @RequirePermission('dialogue:read')
  list(
    @Param('chatbotId') chatbotId: string,
    @Query(new ZodQueryPipe(IntentListQuerySchema)) query: IntentListQuery,
  ): Promise<Paginated<IntentListItem>> {
    return this.intentsService.list(chatbotId, query);
  }

  @Post('bulk-delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('dialogue:write')
  async bulkDelete(
    @Param('chatbotId') chatbotId: string,
    @Body(new ZodValidationPipe(BulkDeleteSchema)) dto: BulkDeleteDto,
  ): Promise<void> {
    await this.intentsService.bulkDelete(chatbotId, dto);
  }

  @Post('import/validate')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('dialogue:write')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: IMPORT_LIMITS.maxFileBytes, files: 1 } }))
  importValidate(
    @Param('chatbotId') chatbotId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<ImportValidateResult> {
    if (!file) throw new ApiException('IMPORT_FILE_INVALID', 400, '업로드할 파일을 선택해 주세요.');
    return this.intentsService.importValidate(chatbotId, file);
  }

  @Post('import/commit')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('dialogue:write')
  importCommit(
    @Param('chatbotId') chatbotId: string,
    @Body(new ZodValidationPipe(ImportCommitRequestSchema)) dto: ImportCommitRequestDto,
  ): Promise<ImportCommitResult> {
    return this.intentsService.importCommit(chatbotId, dto);
  }

  @Get('import/template')
  @RequirePermission('dialogue:read')
  async importTemplate(@Query('format') format: string | undefined, @Res() res: Response): Promise<void> {
    const { content, filename, mimeType } = await this.intentsService.importTemplate(format === 'xlsx' ? 'xlsx' : 'csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', mimeType);
    res.send(content);
  }

  @Get('export')
  @RequirePermission('dialogue:read')
  async export(@Param('chatbotId') chatbotId: string, @Query('topicIds') topicIds: string | undefined, @Res() res: Response): Promise<void> {
    const parsedTopicIds = topicIds ? topicIds.split(',').map((s) => s.trim()).filter(Boolean) : undefined;
    const { content, filename, mimeType } = await this.intentsService.export(chatbotId, parsedTopicIds);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', mimeType);
    res.send(content);
  }

  @Get(':id')
  @RequirePermission('dialogue:read')
  findOne(@Param('chatbotId') chatbotId: string, @Param('id') id: string): Promise<IntentDetail> {
    return this.intentsService.findOne(chatbotId, id);
  }

  @Patch(':id')
  @RequirePermission('dialogue:write')
  update(
    @Param('chatbotId') chatbotId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateIntentSchema)) dto: UpdateIntentDto,
  ): Promise<IntentMutationResult> {
    return this.intentsService.update(chatbotId, id, dto);
  }

  @Patch(':id/examples')
  @RequirePermission('dialogue:write')
  updateExamples(
    @Param('chatbotId') chatbotId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(IntentExampleMutationSchema)) dto: IntentExampleMutationDto,
  ): Promise<IntentMutationResult> {
    return this.intentsService.updateExamples(chatbotId, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('dialogue:write')
  async remove(@Param('chatbotId') chatbotId: string, @Param('id') id: string): Promise<void> {
    await this.intentsService.remove(chatbotId, id);
  }
}
