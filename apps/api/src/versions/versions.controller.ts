import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import {
  ChatbotVersionListQuerySchema,
  CreateChatbotVersionSchema,
  RestoreRequestSchema,
  UpdateChatbotVersionSchema,
  VersionContentQuerySchema,
  VersionDiffQuerySchema,
  type ChatbotVersionDetail,
  type ChatbotVersionListItem,
  type ChatbotVersionListQuery,
  type CreateChatbotVersionDto,
  type CreateChatbotVersionResponse,
  type Paginated,
  type RestorePreviewResponse,
  type RestoreRequestDto,
  type RestoreResponse,
  type UpdateChatbotVersionDto,
  type VersionAssetKind,
  type VersionAuditCount,
  type VersionContentPage,
  type VersionContentQuery,
  type VersionCurrentStatus,
  type VersionDiffItemDetail,
  type VersionDiffQuery,
  type VersionDiffResponse,
} from '@chat-bot/shared-types';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ZodQueryPipe } from '../common/zod-query.pipe';
import { RequirePermission } from '../common/auth/require-permission.decorator';
import { VersionService } from './version.service';
import { VersionDiffService } from './diff/version-diff.service';
import { VersionRestoreService } from './restore/version-restore.service';

/** 12개 핸들러(§10.1). `current`는 반드시 `:versionId`보다 먼저 선언한다. */
@Controller('chatbots/:chatbotId/versions')
export class VersionsController {
  constructor(
    private readonly versionService: VersionService,
    private readonly diffService: VersionDiffService,
    private readonly restoreService: VersionRestoreService,
  ) {}

  @Get()
  @RequirePermission('dialogue:read')
  list(
    @Param('chatbotId') chatbotId: string,
    @Query(new ZodQueryPipe(ChatbotVersionListQuerySchema)) query: ChatbotVersionListQuery,
  ): Promise<Paginated<ChatbotVersionListItem>> {
    return this.versionService.list(chatbotId, query);
  }

  /** 201(신규 생성) / 200(직전과 동일 — 생성 생략, AC-H1-2) — 응답 형태에 따라 상태 코드가 갈린다(§10.1). */
  @Post()
  @RequirePermission('dialogue:write')
  async create(
    @Param('chatbotId') chatbotId: string,
    @Body(new ZodValidationPipe(CreateChatbotVersionSchema)) dto: CreateChatbotVersionDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CreateChatbotVersionResponse> {
    const result = await this.versionService.create(chatbotId, dto);
    res.status(result.unchanged ? HttpStatus.OK : HttpStatus.CREATED);
    return result;
  }

  @Get('current')
  @RequirePermission('dialogue:read')
  current(@Param('chatbotId') chatbotId: string): Promise<VersionCurrentStatus> {
    return this.versionService.current(chatbotId);
  }

  @Get(':versionId')
  @RequirePermission('dialogue:read')
  detail(@Param('chatbotId') chatbotId: string, @Param('versionId') versionId: string): Promise<ChatbotVersionDetail> {
    return this.versionService.detail(chatbotId, versionId);
  }

  @Get(':versionId/content')
  @RequirePermission('dialogue:read')
  content(
    @Param('chatbotId') chatbotId: string,
    @Param('versionId') versionId: string,
    @Query(new ZodQueryPipe(VersionContentQuerySchema)) query: VersionContentQuery,
  ): Promise<VersionContentPage> {
    return this.versionService.content(chatbotId, versionId, query);
  }

  @Patch(':versionId')
  @RequirePermission('dialogue:write')
  update(
    @Param('chatbotId') chatbotId: string,
    @Param('versionId') versionId: string,
    @Body(new ZodValidationPipe(UpdateChatbotVersionSchema)) dto: UpdateChatbotVersionDto,
  ): Promise<ChatbotVersionDetail> {
    return this.versionService.update(chatbotId, versionId, dto);
  }

  @Delete(':versionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('dialogue:write')
  async remove(@Param('chatbotId') chatbotId: string, @Param('versionId') versionId: string): Promise<void> {
    await this.versionService.remove(chatbotId, versionId);
  }

  @Get(':versionId/diff')
  @RequirePermission('dialogue:read')
  diff(
    @Param('chatbotId') chatbotId: string,
    @Param('versionId') versionId: string,
    @Query(new ZodQueryPipe(VersionDiffQuerySchema)) query: VersionDiffQuery,
  ): Promise<VersionDiffResponse> {
    return this.diffService.diff(chatbotId, versionId, query);
  }

  @Get(':versionId/diff/items/:kind/:itemId')
  @RequirePermission('dialogue:read')
  diffItemDetail(
    @Param('chatbotId') chatbotId: string,
    @Param('versionId') versionId: string,
    @Param('kind') kind: string,
    @Param('itemId') itemId: string,
    @Query('against') against: string,
  ): Promise<VersionDiffItemDetail> {
    return this.diffService.diffItemDetail(chatbotId, versionId, kind as VersionAssetKind, itemId, against);
  }

  @Get(':versionId/audit-count')
  @RequirePermission('audit:read')
  auditCount(@Param('chatbotId') chatbotId: string, @Param('versionId') versionId: string): Promise<VersionAuditCount> {
    return this.versionService.auditCount(chatbotId, versionId);
  }

  @Post(':versionId/restore/preview')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('dialogue:write', 'chatbot:write')
  restorePreview(@Param('chatbotId') chatbotId: string, @Param('versionId') versionId: string): Promise<RestorePreviewResponse> {
    return this.restoreService.preview(chatbotId, versionId);
  }

  @Post(':versionId/restore')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('dialogue:write', 'chatbot:write')
  restore(
    @Param('chatbotId') chatbotId: string,
    @Param('versionId') versionId: string,
    @Body(new ZodValidationPipe(RestoreRequestSchema)) dto: RestoreRequestDto,
  ): Promise<RestoreResponse> {
    return this.restoreService.restore(chatbotId, versionId, dto);
  }
}
