import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import {
  KbApproveIngestSchema,
  KbDocumentListQuerySchema,
  KbRunCreateSchema,
  KbSourceCreateSchema,
  KbSourceUpdateSchema,
  PaginationQuerySchema,
} from '@chat-bot/shared-types';
import type {
  KbApproveIngestDto,
  KbDocumentListQuery,
  KbDocumentListResponse,
  KbMetaResponse,
  KbRunCreateDto,
  KbRunListResponse,
  KbRunView,
  KbSourceCreateDto,
  KbSourceListResponse,
  KbSourceResponse,
  KbSourceUpdateDto,
  PaginationQuery,
} from '@chat-bot/shared-types';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RequirePermission } from '../common/auth/require-permission.decorator';
import { CurrentUser } from '../common/auth/current-user.decorator';
import type { SessionUser } from '../common/auth/session-context';
import { KbSyncEnabledGuard } from './kb-sync-enabled.guard';
import { KbSourcesService } from './kb-sources.service';
import { KbRunsService } from './kb-runs.service';
import { KbStatusService } from './kb-status.service';

/** [신규 No.43] `/kb-sources` — 소스·실행·문서(§11). `meta`는 `:id`보다 먼저 선언한다. */
@Controller('kb-sources')
@UseGuards(KbSyncEnabledGuard)
export class KbSourcesController {
  constructor(
    private readonly sourcesService: KbSourcesService,
    private readonly runsService: KbRunsService,
    private readonly statusService: KbStatusService,
  ) {}

  @Get()
  @RequirePermission('security:read')
  async list(@Query(new ZodValidationPipe(PaginationQuerySchema)) query: PaginationQuery): Promise<KbSourceListResponse> {
    return this.sourcesService.list(query.page, query.pageSize);
  }

  @Get('meta')
  @RequirePermission('security:read')
  async meta(): Promise<KbMetaResponse> {
    return this.statusService.meta();
  }

  @Post()
  @RequirePermission('security:write')
  @HttpCode(HttpStatus.CREATED)
  async create(@Body(new ZodValidationPipe(KbSourceCreateSchema)) dto: KbSourceCreateDto, @CurrentUser() user: SessionUser): Promise<KbSourceResponse> {
    return this.sourcesService.create(dto, user.id);
  }

  @Get(':id')
  @RequirePermission('security:read')
  async findOne(@Param('id') id: string): Promise<KbSourceResponse> {
    return this.sourcesService.findOne(id);
  }

  @Patch(':id')
  @RequirePermission('security:write')
  async update(@Param('id') id: string, @Body(new ZodValidationPipe(KbSourceUpdateSchema)) dto: KbSourceUpdateDto, @CurrentUser() user: SessionUser): Promise<KbSourceResponse> {
    return this.sourcesService.update(id, dto, user.id);
  }

  @Delete(':id')
  @RequirePermission('security:write')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string): Promise<void> {
    await this.sourcesService.remove(id);
  }

  @Post(':id/runs')
  @RequirePermission('security:write')
  @HttpCode(HttpStatus.ACCEPTED)
  async createRun(@Param('id') id: string, @Body(new ZodValidationPipe(KbRunCreateSchema)) dto: KbRunCreateDto, @CurrentUser() user: SessionUser): Promise<{ runId: string }> {
    return this.runsService.createRun(id, dto, user.id);
  }

  @Post(':id/approve-ingest')
  @RequirePermission('security:write')
  @HttpCode(HttpStatus.ACCEPTED)
  async approveIngest(@Param('id') id: string, @Body(new ZodValidationPipe(KbApproveIngestSchema)) dto: KbApproveIngestDto, @CurrentUser() user: SessionUser): Promise<{ runId: string }> {
    return this.runsService.approveIngest(id, dto, user.id);
  }

  @Post(':id/runs/:runId/cancel')
  @RequirePermission('security:write')
  @HttpCode(HttpStatus.OK)
  async cancelRun(@Param('id') id: string, @Param('runId') runId: string, @CurrentUser() user: SessionUser): Promise<{ ok: true }> {
    await this.runsService.cancelRun(id, runId, user.id);
    return { ok: true };
  }

  @Get(':id/runs')
  @RequirePermission('security:read')
  async listRuns(@Param('id') id: string, @Query(new ZodValidationPipe(PaginationQuerySchema)) query: PaginationQuery): Promise<KbRunListResponse> {
    return this.runsService.listRuns(id, query.page, query.pageSize);
  }

  @Get(':id/runs/:runId')
  @RequirePermission('security:read')
  async getRun(@Param('id') id: string, @Param('runId') runId: string): Promise<KbRunView> {
    return this.runsService.getRun(id, runId);
  }

  @Get(':id/documents')
  @RequirePermission('security:read')
  async listDocuments(@Param('id') id: string, @Query(new ZodValidationPipe(KbDocumentListQuerySchema)) query: KbDocumentListQuery): Promise<KbDocumentListResponse> {
    return this.runsService.listDocuments(id, query);
  }
}
