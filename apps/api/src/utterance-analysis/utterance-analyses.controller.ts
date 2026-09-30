import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Res, UploadedFile, UseFilters, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Response } from 'express';
import {
  AnalyzedUtteranceListQuerySchema,
  ClusterRenameRequestSchema,
  IMPORT_LIMITS,
  UtteranceAnalysisListQuerySchema,
  UtteranceApplyRequestSchema,
  UtteranceTemplateQuerySchema,
  type AnalyzedUtterance,
  type AnalyzedUtteranceListQuery,
  type ClusterRenameRequest,
  type Paginated,
  type StartUtteranceAnalysisResponse,
  type UtteranceAnalysisCapability,
  type UtteranceAnalysisDetail,
  type UtteranceAnalysisListItem,
  type UtteranceAnalysisListQuery,
  type UtteranceApplyPreviewResponse,
  type UtteranceApplyRequest,
  type UtteranceApplyResponse,
  type UtteranceCluster,
  type UtterancePreviewResponse,
  type UtteranceTemplateQuery,
} from '@chat-bot/shared-types';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ZodQueryPipe } from '../common/zod-query.pipe';
import { RequirePermission } from '../common/auth/require-permission.decorator';
import { AuditView } from '../audit-logs/access/audit-view.decorator';
import { UtteranceAnalysisService } from './utterance-analysis.service';
import { UtteranceApplyService } from './apply/utterance-apply.service';
import { UtteranceAnalysisExportService } from './export/utterance-analysis-export.service';
import { UtteranceAnalysisEnabledGuard } from './utterance-analysis-enabled.guard';
import { UtteranceUploadTooLargeFilter } from './upload/upload-too-large.filter';
import type { UploadedUtteranceFile } from './upload/utterance-upload.parser';

/** multer 메모리 저장 · 5MB · 파일 1 · 필드 2(설계서 §12) — 버퍼는 핸들러가 파싱 후 참조를 놓는다(DC-8). */
const UPLOAD_OPTIONS = { storage: memoryStorage(), limits: { fileSize: IMPORT_LIMITS.maxFileBytes, files: 1, fields: 2 } };

/**
 * 발화 묶음 분석(No.21 — 설계서 §12 · 13 핸들러). 권한은 신규 0 — 조회·다운로드 `dialogue:read`, 요청·수정·반영·
 * 취소·삭제 `dialogue:write`. `@Public()` 0.
 * ⚠ `template`·`capability`·`preview`는 `:analysisId`보다 **먼저 선언**한다(경로 충돌 방지).
 * `UTTERANCE_ANALYSIS_ENABLED=false` → 전부 `404`(가드).
 */
@Controller('chatbots/:chatbotId/utterance-analyses')
@UseGuards(UtteranceAnalysisEnabledGuard)
@UseFilters(UtteranceUploadTooLargeFilter)
export class UtteranceAnalysesController {
  constructor(
    private readonly service: UtteranceAnalysisService,
    private readonly applyService: UtteranceApplyService,
    private readonly exportService: UtteranceAnalysisExportService,
  ) {}

  @Get('template')
  @RequirePermission('dialogue:read')
  async template(
    @Param('chatbotId') chatbotId: string,
    @Query(new ZodQueryPipe(UtteranceTemplateQuerySchema)) query: UtteranceTemplateQuery,
    @Res() res: Response,
  ): Promise<void> {
    const file = await this.exportService.template(chatbotId, query.format);
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    res.setHeader('Content-Type', file.mimeType);
    res.send(file.buffer);
  }

  @Get('capability')
  @RequirePermission('dialogue:read')
  capability(@Param('chatbotId') chatbotId: string): Promise<UtteranceAnalysisCapability> {
    return this.service.capability(chatbotId);
  }

  @Post('preview')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('dialogue:write')
  @UseInterceptors(FileInterceptor('file', UPLOAD_OPTIONS))
  preview(
    @Param('chatbotId') chatbotId: string,
    @UploadedFile() file: UploadedUtteranceFile | undefined,
    @Query() query: unknown,
  ): Promise<UtterancePreviewResponse> {
    return this.service.preview(chatbotId, file, query);
  }

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermission('dialogue:write')
  @UseInterceptors(FileInterceptor('file', UPLOAD_OPTIONS))
  create(
    @Param('chatbotId') chatbotId: string,
    @UploadedFile() file: UploadedUtteranceFile | undefined,
    @Body('conditions') conditions: unknown,
  ): Promise<StartUtteranceAnalysisResponse> {
    return this.service.create(chatbotId, file, conditions);
  }

  @Get()
  @RequirePermission('dialogue:read')
  list(
    @Param('chatbotId') chatbotId: string,
    @Query(new ZodQueryPipe(UtteranceAnalysisListQuerySchema)) query: UtteranceAnalysisListQuery,
  ): Promise<Paginated<UtteranceAnalysisListItem>> {
    return this.service.list(chatbotId, query);
  }

  @Get(':analysisId')
  @RequirePermission('dialogue:read')
  detail(@Param('chatbotId') chatbotId: string, @Param('analysisId') analysisId: string): Promise<UtteranceAnalysisDetail> {
    return this.service.getDetail(chatbotId, analysisId);
  }

  @Get(':analysisId/utterances')
  @RequirePermission('dialogue:read')
  @AuditView({ targetType: 'UtteranceAnalysis', idParam: 'analysisId', chatbotParam: 'chatbotId' })
  listUtterances(
    @Param('chatbotId') chatbotId: string,
    @Param('analysisId') analysisId: string,
    @Query(new ZodQueryPipe(AnalyzedUtteranceListQuerySchema)) query: AnalyzedUtteranceListQuery,
  ): Promise<Paginated<AnalyzedUtterance>> {
    return this.service.listUtterances(chatbotId, analysisId, query);
  }

  @Patch(':analysisId/clusters/:clusterId')
  @RequirePermission('dialogue:write')
  renameCluster(
    @Param('chatbotId') chatbotId: string,
    @Param('analysisId') analysisId: string,
    @Param('clusterId') clusterId: string,
    @Body(new ZodValidationPipe(ClusterRenameRequestSchema)) dto: ClusterRenameRequest,
  ): Promise<UtteranceCluster> {
    return this.service.renameCluster(chatbotId, analysisId, clusterId, dto);
  }

  @Get(':analysisId/export')
  @RequirePermission('dialogue:read')
  async export(@Param('chatbotId') chatbotId: string, @Param('analysisId') analysisId: string, @Res() res: Response): Promise<void> {
    const file = await this.exportService.export(chatbotId, analysisId);
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    res.setHeader('Content-Type', file.mimeType);
    res.send(file.buffer);
  }

  @Post(':analysisId/apply/preview')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('dialogue:write')
  applyPreview(
    @Param('chatbotId') chatbotId: string,
    @Param('analysisId') analysisId: string,
    @Body(new ZodValidationPipe(UtteranceApplyRequestSchema)) dto: UtteranceApplyRequest,
  ): Promise<UtteranceApplyPreviewResponse> {
    return this.applyService.preview(chatbotId, analysisId, dto);
  }

  @Post(':analysisId/apply')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('dialogue:write')
  apply(
    @Param('chatbotId') chatbotId: string,
    @Param('analysisId') analysisId: string,
    @Body(new ZodValidationPipe(UtteranceApplyRequestSchema)) dto: UtteranceApplyRequest,
  ): Promise<UtteranceApplyResponse> {
    return this.applyService.apply(chatbotId, analysisId, dto);
  }

  @Post(':analysisId/cancel')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('dialogue:write')
  async cancel(@Param('chatbotId') chatbotId: string, @Param('analysisId') analysisId: string): Promise<void> {
    await this.service.cancel(chatbotId, analysisId);
  }

  @Delete(':analysisId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('dialogue:write')
  async remove(@Param('chatbotId') chatbotId: string, @Param('analysisId') analysisId: string): Promise<void> {
    await this.service.remove(chatbotId, analysisId);
  }
}
