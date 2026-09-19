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
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Response } from 'express';
import {
  BulkDeleteDto,
  BulkDeleteSchema,
  CreateKeywordDto,
  CreateKeywordSchema,
  IMPORT_LIMITS,
  ImportCommitRequestDto,
  ImportCommitRequestSchema,
  ImportCommitResult,
  ImportValidateResult,
  KeywordDetail,
  KeywordListItem,
  KeywordListQuery,
  KeywordListQuerySchema,
  Paginated,
  UpdateKeywordDto,
  UpdateKeywordSchema,
} from '@chat-bot/shared-types';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ZodQueryPipe } from '../common/zod-query.pipe';
import { PermissionGuard } from '../common/auth/permission.guard';
import { RequirePermission } from '../common/auth/require-permission.decorator';
import { ApiException } from '../common/api.exception';
import { KeywordsService } from './keywords.service';

@UseGuards(PermissionGuard)
@Controller('chatbots/:chatbotId/keywords')
export class KeywordsController {
  constructor(private readonly keywordsService: KeywordsService) {}

  @Post()
  @RequirePermission('dialogue:write')
  create(
    @Param('chatbotId') chatbotId: string,
    @Body(new ZodValidationPipe(CreateKeywordSchema)) dto: CreateKeywordDto,
  ): Promise<KeywordDetail> {
    return this.keywordsService.create(chatbotId, dto);
  }

  @Get()
  @RequirePermission('dialogue:read')
  list(
    @Param('chatbotId') chatbotId: string,
    @Query(new ZodQueryPipe(KeywordListQuerySchema)) query: KeywordListQuery,
  ): Promise<Paginated<KeywordListItem>> {
    return this.keywordsService.list(chatbotId, query);
  }

  @Post('bulk-delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('dialogue:write')
  async bulkDelete(
    @Param('chatbotId') chatbotId: string,
    @Body(new ZodValidationPipe(BulkDeleteSchema)) dto: BulkDeleteDto,
  ): Promise<void> {
    await this.keywordsService.bulkDelete(chatbotId, dto);
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
    return this.keywordsService.importValidate(chatbotId, file);
  }

  @Post('import/commit')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('dialogue:write')
  importCommit(
    @Param('chatbotId') chatbotId: string,
    @Body(new ZodValidationPipe(ImportCommitRequestSchema)) dto: ImportCommitRequestDto,
  ): Promise<ImportCommitResult> {
    return this.keywordsService.importCommit(chatbotId, dto);
  }

  @Get('import/template')
  @RequirePermission('dialogue:read')
  async importTemplate(@Query('format') format: string | undefined, @Res() res: Response): Promise<void> {
    const { content, filename, mimeType } = await this.keywordsService.importTemplate(format === 'xlsx' ? 'xlsx' : 'csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', mimeType);
    res.send(content);
  }

  @Get('export')
  @RequirePermission('dialogue:read')
  async export(@Param('chatbotId') chatbotId: string, @Res() res: Response): Promise<void> {
    const { content, filename, mimeType } = await this.keywordsService.export(chatbotId);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', mimeType);
    res.send(content);
  }

  @Get(':id')
  @RequirePermission('dialogue:read')
  findOne(@Param('chatbotId') chatbotId: string, @Param('id') id: string): Promise<KeywordDetail> {
    return this.keywordsService.findOne(chatbotId, id);
  }

  @Patch(':id')
  @RequirePermission('dialogue:write')
  update(
    @Param('chatbotId') chatbotId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateKeywordSchema)) dto: UpdateKeywordDto,
  ): Promise<KeywordDetail> {
    return this.keywordsService.update(chatbotId, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('dialogue:write')
  async remove(@Param('chatbotId') chatbotId: string, @Param('id') id: string): Promise<void> {
    await this.keywordsService.remove(chatbotId, id);
  }
}
