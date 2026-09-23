import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Response } from 'express';
import {
  BulkDisableTestCasesSchema,
  CreateTestCaseSchema,
  ImportCommitRequestSchema,
  TestCaseListQuerySchema,
  UpdateTestCaseSchema,
  IMPORT_LIMITS,
  type BulkDisableTestCasesDto,
  type CreateTestCaseDto,
  type ImportCommitRequestDto,
  type ImportCommitResult,
  type ImportValidateResult,
  type Paginated,
  type TestCase,
  type TestCaseListQuery,
  type UpdateTestCaseDto,
} from '@chat-bot/shared-types';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ZodQueryPipe } from '../common/zod-query.pipe';
import { RequirePermission } from '../common/auth/require-permission.decorator';
import { ApiException } from '../common/api.exception';
import { TestCaseService } from './test-case.service';
import { TestCaseImportService } from './import/test-case-import.service';
import type { UploadedFile as TestCaseUploadedFile } from './import/test-case-import.service';

/**
 * TC CRUD·일괄 비활성·대량 업로드·내보내기(FR-V1-2~15, §9). ⚠ `bulk-disable`·`import/*`·`export`는
 * `:caseId`보다 **먼저 선언**한다.
 */
@Controller('chatbots/:chatbotId/test-sets/:setId/cases')
export class TestCasesController {
  constructor(
    private readonly testCaseService: TestCaseService,
    private readonly importService: TestCaseImportService,
  ) {}

  @Get()
  @RequirePermission('simulation:read')
  list(
    @Param('chatbotId') chatbotId: string,
    @Param('setId') setId: string,
    @Query(new ZodQueryPipe(TestCaseListQuerySchema)) query: TestCaseListQuery,
  ): Promise<Paginated<TestCase>> {
    return this.testCaseService.list(chatbotId, setId, query);
  }

  @Post()
  @RequirePermission('simulation:write')
  create(
    @Param('chatbotId') chatbotId: string,
    @Param('setId') setId: string,
    @Body(new ZodValidationPipe(CreateTestCaseSchema)) dto: CreateTestCaseDto,
  ): Promise<TestCase> {
    return this.testCaseService.create(chatbotId, setId, dto);
  }

  @Post('bulk-disable')
  @RequirePermission('simulation:write')
  bulkDisable(
    @Param('chatbotId') chatbotId: string,
    @Param('setId') setId: string,
    @Body(new ZodValidationPipe(BulkDisableTestCasesSchema)) dto: BulkDisableTestCasesDto,
  ): Promise<{ updated: number }> {
    return this.testCaseService.bulkDisable(chatbotId, setId, dto);
  }

  @Post('import/validate')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('simulation:write')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: IMPORT_LIMITS.maxFileBytes, files: 1 } }))
  importValidate(
    @Param('chatbotId') chatbotId: string,
    @Param('setId') setId: string,
    @UploadedFile() file: TestCaseUploadedFile | undefined,
  ): Promise<ImportValidateResult> {
    if (!file) throw new ApiException('IMPORT_FILE_INVALID', 400, '업로드할 파일을 선택해 주세요.');
    return this.importService.validate(chatbotId, setId, file);
  }

  @Post('import/commit')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('simulation:write')
  importCommit(
    @Param('chatbotId') chatbotId: string,
    @Param('setId') setId: string,
    @Body(new ZodValidationPipe(ImportCommitRequestSchema)) dto: ImportCommitRequestDto,
  ): Promise<ImportCommitResult> {
    return this.importService.commit(chatbotId, setId, dto);
  }

  @Get('export')
  @RequirePermission('simulation:read')
  async export(@Param('chatbotId') chatbotId: string, @Param('setId') setId: string, @Res() res: Response): Promise<void> {
    const { content, filename, mimeType } = await this.testCaseService.export(chatbotId, setId);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', mimeType);
    res.send(content);
  }

  @Patch(':caseId')
  @RequirePermission('simulation:write')
  update(
    @Param('chatbotId') chatbotId: string,
    @Param('setId') setId: string,
    @Param('caseId') caseId: string,
    @Body(new ZodValidationPipe(UpdateTestCaseSchema)) dto: UpdateTestCaseDto,
  ): Promise<TestCase> {
    return this.testCaseService.update(chatbotId, setId, caseId, dto);
  }

  @Delete(':caseId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('simulation:write')
  async remove(@Param('chatbotId') chatbotId: string, @Param('setId') setId: string, @Param('caseId') caseId: string): Promise<void> {
    await this.testCaseService.remove(chatbotId, setId, caseId);
  }
}
