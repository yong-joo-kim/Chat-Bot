import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import {
  CreateTestCaseSetSchema,
  TestCaseSetListQuerySchema,
  UpdateTestCaseSetSchema,
  type CreateTestCaseSetDto,
  type Paginated,
  type TestCaseSet,
  type TestCaseSetListQuery,
  type UpdateTestCaseSetDto,
} from '@chat-bot/shared-types';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ZodQueryPipe } from '../common/zod-query.pipe';
import { RequirePermission } from '../common/auth/require-permission.decorator';
import { TestSetService } from './test-set.service';

/**
 * TC 세트 CRUD + 템플릿 다운로드(FR-V1-1, §9). ⚠ `template`은 `:setId`보다 **먼저 선언**한다 —
 * 그렇지 않으면 `template`이 `:setId` 파라미터로 흡수된다.
 */
@Controller('chatbots/:chatbotId/test-sets')
export class TestSetsController {
  constructor(private readonly testSetService: TestSetService) {}

  @Get()
  @RequirePermission('simulation:read')
  list(@Param('chatbotId') chatbotId: string, @Query(new ZodQueryPipe(TestCaseSetListQuerySchema)) query: TestCaseSetListQuery): Promise<Paginated<TestCaseSet>> {
    return this.testSetService.list(chatbotId, query);
  }

  @Post()
  @RequirePermission('simulation:write')
  create(@Param('chatbotId') chatbotId: string, @Body(new ZodValidationPipe(CreateTestCaseSetSchema)) dto: CreateTestCaseSetDto): Promise<TestCaseSet> {
    return this.testSetService.create(chatbotId, dto);
  }

  @Get('template')
  @RequirePermission('simulation:read')
  async template(@Query('format') format: string | undefined, @Res() res: Response): Promise<void> {
    const { content, filename, mimeType } = await this.testSetService.template(format === 'xlsx' ? 'xlsx' : 'csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', mimeType);
    res.send(content);
  }

  @Patch(':setId')
  @RequirePermission('simulation:write')
  update(
    @Param('chatbotId') chatbotId: string,
    @Param('setId') setId: string,
    @Body(new ZodValidationPipe(UpdateTestCaseSetSchema)) dto: UpdateTestCaseSetDto,
  ): Promise<TestCaseSet> {
    return this.testSetService.update(chatbotId, setId, dto);
  }

  @Delete(':setId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('simulation:write')
  async remove(@Param('chatbotId') chatbotId: string, @Param('setId') setId: string): Promise<void> {
    await this.testSetService.remove(chatbotId, setId);
  }
}
