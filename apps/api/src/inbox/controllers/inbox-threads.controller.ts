import { Body, Controller, Get, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import {
  AssignThreadSchema,
  CreateNoteSchema,
  CreateRecordSchema,
  InboxMaskPreviewSchema,
  InboxThreadDetailQuerySchema,
  InboxThreadListQuerySchema,
  OpenThreadFromSessionSchema,
  ReleaseThreadSchema,
  SetThreadTagsSchema,
  UpdateNoteSchema,
  UpdateThreadStateSchema,
} from '@chat-bot/shared-types';
import type {
  AssignThreadDto,
  CreateNoteDto,
  CreateRecordDto,
  InboxAssigneeListResponse,
  InboxMaskPreviewDto,
  InboxMaskPreviewResponse,
  InboxSummaryResponse,
  InboxThreadDetail,
  InboxThreadDetailQuery,
  InboxThreadListItem,
  InboxThreadListQuery,
  InboxThreadListResponse,
  OpenThreadFromSessionDto,
  OpenThreadFromSessionResponse,
  ReleaseThreadDto,
  SetThreadTagsDto,
  UpdateNoteDto,
  UpdateThreadStateDto,
} from '@chat-bot/shared-types';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { RequirePermission } from '../../common/auth/require-permission.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { SessionUser } from '../../common/auth/session-context';
import { AuditView } from '../../audit-logs/access/audit-view.decorator';
import { InboxEnabledGuard } from '../guards/inbox-enabled.guard';
import { InboxQueryService } from '../read/inbox-query.service';
import { InboxThreadDetailService } from '../read/inbox-thread-detail.service';
import { InboxThreadsService } from '../manage/inbox-threads.service';

/**
 * [신규 No.42] 통합 인박스 스레드(§14.1 — 14 핸들러). ⚠ 목록·요약·담당 후보·직접 열기·마스킹
 * 미리보기는 `:threadId`보다 **먼저** 선언한다(경로 충돌 방지).
 */
@UseGuards(InboxEnabledGuard)
@Controller('inbox')
export class InboxThreadsController {
  constructor(
    private readonly query: InboxQueryService,
    private readonly detail: InboxThreadDetailService,
    private readonly threads: InboxThreadsService,
  ) {}

  @Get('threads')
  @RequirePermission('cs:read')
  @AuditView({ targetType: 'InboxThread' })
  list(@Query(new ZodValidationPipe(InboxThreadListQuerySchema)) query: InboxThreadListQuery, @CurrentUser() actor: SessionUser): Promise<InboxThreadListResponse> {
    return this.query.list(query, actor.id);
  }

  @Get('threads/summary')
  @RequirePermission('cs:read')
  summary(@CurrentUser() actor: SessionUser): Promise<InboxSummaryResponse> {
    return this.query.summary(actor.id);
  }

  @Get('assignees')
  @RequirePermission('cs:read')
  assignees(): Promise<InboxAssigneeListResponse> {
    return this.query.assignees();
  }

  @Post('threads/open')
  @RequirePermission('cs:write')
  openFromSession(@Body(new ZodValidationPipe(OpenThreadFromSessionSchema)) dto: OpenThreadFromSessionDto, @CurrentUser() actor: SessionUser): Promise<OpenThreadFromSessionResponse> {
    return this.threads.openFromSession(dto, actor);
  }

  @Post('mask-preview')
  @RequirePermission('cs:write')
  maskPreview(@Body(new ZodValidationPipe(InboxMaskPreviewSchema)) dto: InboxMaskPreviewDto): Promise<InboxMaskPreviewResponse> {
    return this.threads.maskPreview(dto.text);
  }

  @Get('threads/:threadId')
  @RequirePermission('cs:read')
  @AuditView({ targetType: 'InboxThread', idParam: 'threadId' })
  getDetail(@Param('threadId') threadId: string, @Query(new ZodValidationPipe(InboxThreadDetailQuerySchema)) query: InboxThreadDetailQuery): Promise<InboxThreadDetail> {
    return this.detail.detail(threadId, query.cursor);
  }

  @Patch('threads/:threadId')
  @RequirePermission('cs:write')
  updateState(@Param('threadId') threadId: string, @Body(new ZodValidationPipe(UpdateThreadStateSchema)) dto: UpdateThreadStateDto, @CurrentUser() actor: SessionUser): Promise<InboxThreadListItem> {
    return this.threads.updateState(threadId, dto, actor);
  }

  @Post('threads/:threadId/claim')
  @RequirePermission('cs:write')
  claim(@Param('threadId') threadId: string, @CurrentUser() actor: SessionUser): Promise<InboxThreadListItem> {
    return this.threads.claim(threadId, actor);
  }

  @Post('threads/:threadId/assign')
  @RequirePermission('cs:write')
  assign(@Param('threadId') threadId: string, @Body(new ZodValidationPipe(AssignThreadSchema)) dto: AssignThreadDto, @CurrentUser() actor: SessionUser): Promise<InboxThreadListItem> {
    return this.threads.assign(threadId, dto, actor);
  }

  @Post('threads/:threadId/release')
  @RequirePermission('cs:write')
  release(@Param('threadId') threadId: string, @Body(new ZodValidationPipe(ReleaseThreadSchema)) dto: ReleaseThreadDto, @CurrentUser() actor: SessionUser): Promise<InboxThreadListItem> {
    return this.threads.release(threadId, dto, actor);
  }

  @Put('threads/:threadId/tags')
  @RequirePermission('cs:write')
  setTags(@Param('threadId') threadId: string, @Body(new ZodValidationPipe(SetThreadTagsSchema)) dto: SetThreadTagsDto, @CurrentUser() actor: SessionUser): Promise<InboxThreadListItem> {
    return this.threads.setTags(threadId, dto, actor);
  }

  @Post('threads/:threadId/notes')
  @RequirePermission('cs:write')
  createNote(@Param('threadId') threadId: string, @Body(new ZodValidationPipe(CreateNoteSchema)) dto: CreateNoteDto, @CurrentUser() actor: SessionUser): Promise<InboxThreadListItem> {
    return this.threads.createNote(threadId, dto, actor);
  }

  @Patch('threads/:threadId/notes/:entryId')
  @RequirePermission('cs:write')
  updateNote(
    @Param('threadId') threadId: string,
    @Param('entryId') entryId: string,
    @Body(new ZodValidationPipe(UpdateNoteSchema)) dto: UpdateNoteDto,
    @CurrentUser() actor: SessionUser,
  ): Promise<InboxThreadListItem> {
    return this.threads.updateNote(threadId, entryId, dto, actor);
  }

  @Post('threads/:threadId/records')
  @RequirePermission('cs:write')
  createRecord(@Param('threadId') threadId: string, @Body(new ZodValidationPipe(CreateRecordSchema)) dto: CreateRecordDto, @CurrentUser() actor: SessionUser): Promise<InboxThreadListItem> {
    return this.threads.createRecord(threadId, dto, actor);
  }
}
