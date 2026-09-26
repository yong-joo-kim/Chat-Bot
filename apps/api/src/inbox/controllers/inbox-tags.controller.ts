import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { InboxTagCreateSchema, InboxTagDeleteQuerySchema, InboxTagUpdateSchema } from '@chat-bot/shared-types';
import type { InboxTagCreateDto, InboxTagDeleteQuery, InboxTagItem, InboxTagListResponse, InboxTagUpdateDto } from '@chat-bot/shared-types';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { RequirePermission } from '../../common/auth/require-permission.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { SessionUser } from '../../common/auth/session-context';
import { InboxEnabledGuard } from '../guards/inbox-enabled.guard';
import { InboxTagsService } from '../manage/inbox-tags.service';

/** [신규 No.42] 전역 태그(§14.1 — 4 핸들러). 조회 `cs:read` · 변경 `cs:write` + 서비스 ADMIN 재검증. */
@UseGuards(InboxEnabledGuard)
@Controller('inbox/tags')
export class InboxTagsController {
  constructor(private readonly service: InboxTagsService) {}

  @Get()
  @RequirePermission('cs:read')
  list(): Promise<InboxTagListResponse> {
    return this.service.list();
  }

  @Post()
  @RequirePermission('cs:write')
  create(@Body(new ZodValidationPipe(InboxTagCreateSchema)) dto: InboxTagCreateDto, @CurrentUser() actor: SessionUser): Promise<InboxTagItem> {
    return this.service.create(dto, actor);
  }

  @Patch(':tagId')
  @RequirePermission('cs:write')
  update(@Param('tagId') tagId: string, @Body(new ZodValidationPipe(InboxTagUpdateSchema)) dto: InboxTagUpdateDto, @CurrentUser() actor: SessionUser): Promise<InboxTagItem> {
    return this.service.update(tagId, dto, actor);
  }

  @Delete(':tagId')
  @RequirePermission('cs:write')
  remove(@Param('tagId') tagId: string, @Query(new ZodValidationPipe(InboxTagDeleteQuerySchema)) query: InboxTagDeleteQuery, @CurrentUser() actor: SessionUser): Promise<void> {
    return this.service.remove(tagId, query.force ?? false, actor);
  }
}
