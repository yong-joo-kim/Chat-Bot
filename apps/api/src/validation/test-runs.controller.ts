import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import {
  PinTestRunRequestSchema,
  StartTestRunRequestSchema,
  TestRunComparisonQuerySchema,
  TestRunListQuerySchema,
  TestRunResultListQuerySchema,
  type Paginated,
  type PinTestRunRequestDto,
  type StartTestRunRequestDto,
  type StartTestRunResponse,
  type TestRun,
  type TestRunComparison,
  type TestRunComparisonQuery,
  type TestRunListQuery,
  type TestRunResult,
  type TestRunResultListQuery,
} from '@chat-bot/shared-types';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ZodQueryPipe } from '../common/zod-query.pipe';
import { RequirePermission } from '../common/auth/require-permission.decorator';
import { TestRunService } from './test-run.service';
import { TestRunCompareService } from './compare/test-run-compare.service';

/**
 * 실행 생성(202)·조회·취소·고정·비교·내보내기(§9). ⚠ `test-runs/compare`는 `test-runs/:runId`보다
 * **먼저 선언**한다 — 그렇지 않으면 `compare`가 `:runId` 파라미터로 흡수된다.
 */
@Controller('chatbots/:chatbotId')
export class TestRunsController {
  constructor(
    private readonly testRunService: TestRunService,
    private readonly compareService: TestRunCompareService,
  ) {}

  @Post('test-sets/:setId/runs')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermission('simulation:write')
  start(
    @Param('chatbotId') chatbotId: string,
    @Param('setId') setId: string,
    @Body(new ZodValidationPipe(StartTestRunRequestSchema)) dto: StartTestRunRequestDto,
  ): Promise<StartTestRunResponse> {
    return this.testRunService.start(chatbotId, setId, dto);
  }

  @Get('test-runs')
  @RequirePermission('simulation:read')
  list(@Param('chatbotId') chatbotId: string, @Query(new ZodQueryPipe(TestRunListQuerySchema)) query: TestRunListQuery): Promise<Paginated<TestRun>> {
    return this.testRunService.list(chatbotId, query);
  }

  @Get('test-runs/compare')
  @RequirePermission('simulation:read')
  compare(
    @Param('chatbotId') chatbotId: string,
    @Query(new ZodQueryPipe(TestRunComparisonQuerySchema)) query: TestRunComparisonQuery,
  ): Promise<TestRunComparison> {
    return this.compareService.compare(chatbotId, query);
  }

  @Get('test-runs/:runId')
  @RequirePermission('simulation:read')
  getOne(@Param('chatbotId') chatbotId: string, @Param('runId') runId: string): Promise<TestRun> {
    return this.testRunService.getOne(chatbotId, runId);
  }

  @Get('test-runs/:runId/results')
  @RequirePermission('simulation:read')
  listResults(
    @Param('chatbotId') chatbotId: string,
    @Param('runId') runId: string,
    @Query(new ZodQueryPipe(TestRunResultListQuerySchema)) query: TestRunResultListQuery,
  ): Promise<Paginated<TestRunResult>> {
    return this.testRunService.listResults(chatbotId, runId, query);
  }

  @Post('test-runs/:runId/cancel')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('simulation:write')
  async cancel(@Param('chatbotId') chatbotId: string, @Param('runId') runId: string): Promise<void> {
    await this.testRunService.cancel(chatbotId, runId);
  }

  @Post('test-runs/:runId/pin')
  @RequirePermission('simulation:write')
  pin(
    @Param('chatbotId') chatbotId: string,
    @Param('runId') runId: string,
    @Body(new ZodValidationPipe(PinTestRunRequestSchema)) dto: PinTestRunRequestDto,
  ): Promise<TestRun> {
    return this.testRunService.pin(chatbotId, runId, dto);
  }

  @Get('test-runs/:runId/export')
  @RequirePermission('simulation:read')
  async export(@Param('chatbotId') chatbotId: string, @Param('runId') runId: string, @Res() res: Response): Promise<void> {
    const { content, filename, mimeType } = await this.testRunService.export(chatbotId, runId);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', mimeType);
    res.send(content);
  }
}
