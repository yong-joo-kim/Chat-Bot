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
  CreateFaqDto,
  CreateFaqSchema,
  FaqEntry,
  FaqListQuery,
  FaqListQuerySchema,
  FaqListResponse,
  FaqPublicSuggestion,
  FaqSuggestQuery,
  FaqSuggestQuerySchema,
  FaqSuggestion,
  IMPORT_LIMITS,
  ImportCommitRequestDto,
  ImportCommitRequestSchema,
  ImportCommitResult,
  ImportValidateResult,
  UpdateFaqDto,
  UpdateFaqSchema,
} from '@chat-bot/shared-types';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ZodQueryPipe } from '../common/zod-query.pipe';
import { RequirePermission } from '../common/auth/require-permission.decorator';
import { ApiException } from '../common/api.exception';
import { FaqsService } from './faqs.service';

@Controller('chatbots/:chatbotId/faqs')
export class FaqsController {
  constructor(private readonly faqsService: FaqsService) {}

  @Post()
  @RequirePermission('dialogue:write')
  create(@Param('chatbotId') chatbotId: string, @Body(new ZodValidationPipe(CreateFaqSchema)) dto: CreateFaqDto): Promise<FaqEntry> {
    return this.faqsService.create(chatbotId, dto);
  }

  @Get()
  @RequirePermission('dialogue:read')
  list(
    @Param('chatbotId') chatbotId: string,
    @Query(new ZodQueryPipe(FaqListQuerySchema)) query: FaqListQuery,
  ): Promise<FaqListResponse> {
    return this.faqsService.list(chatbotId, query);
  }

  @Get('suggest')
  @RequirePermission('dialogue:read')
  suggest(
    @Param('chatbotId') chatbotId: string,
    @Query(new ZodQueryPipe(FaqSuggestQuerySchema)) query: FaqSuggestQuery,
  ): Promise<FaqSuggestion[] | FaqPublicSuggestion[]> {
    return this.faqsService.suggest(chatbotId, query);
  }

  @Post('bulk-delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('dialogue:write')
  async bulkDelete(@Param('chatbotId') chatbotId: string, @Body(new ZodValidationPipe(BulkDeleteSchema)) dto: BulkDeleteDto): Promise<void> {
    await this.faqsService.bulkDelete(chatbotId, dto);
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
    return this.faqsService.importValidate(chatbotId, file);
  }

  @Post('import/commit')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('dialogue:write')
  importCommit(
    @Param('chatbotId') chatbotId: string,
    @Body(new ZodValidationPipe(ImportCommitRequestSchema)) dto: ImportCommitRequestDto,
  ): Promise<ImportCommitResult> {
    return this.faqsService.importCommit(chatbotId, dto);
  }

  @Get('import/template')
  @RequirePermission('dialogue:read')
  async importTemplate(@Query('format') format: string | undefined, @Res() res: Response): Promise<void> {
    const { content, filename, mimeType } = await this.faqsService.importTemplate(format === 'xlsx' ? 'xlsx' : 'csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', mimeType);
    res.send(content);
  }

  @Get('export')
  @RequirePermission('dialogue:read')
  async export(@Param('chatbotId') chatbotId: string, @Query('topicIds') topicIds: string | undefined, @Res() res: Response): Promise<void> {
    const parsedTopicIds = topicIds ? topicIds.split(',').map((s) => s.trim()).filter(Boolean) : undefined;
    const { content, filename, mimeType } = await this.faqsService.export(chatbotId, parsedTopicIds);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', mimeType);
    res.send(content);
  }

  @Get(':id')
  @RequirePermission('dialogue:read')
  findOne(@Param('chatbotId') chatbotId: string, @Param('id') id: string): Promise<FaqEntry> {
    return this.faqsService.findOne(chatbotId, id);
  }

  @Patch(':id')
  @RequirePermission('dialogue:write')
  update(
    @Param('chatbotId') chatbotId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateFaqSchema)) dto: UpdateFaqDto,
  ): Promise<FaqEntry> {
    return this.faqsService.update(chatbotId, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('dialogue:write')
  async remove(@Param('chatbotId') chatbotId: string, @Param('id') id: string): Promise<void> {
    await this.faqsService.remove(chatbotId, id);
  }
}
