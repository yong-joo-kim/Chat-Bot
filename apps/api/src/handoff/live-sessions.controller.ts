import { Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import {
  HintResponse,
  InterveneHandoffResponse,
  LiveSessionListQuery,
  LiveSessionListQuerySchema,
  LiveSessionListResponse,
  TranscriptQuery,
  TranscriptQuerySchema,
  TranscriptResponse,
} from '@chat-bot/shared-types';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RequirePermission } from '../common/auth/require-permission.decorator';
import { CurrentUser } from '../common/auth/current-user.decorator';
import type { SessionUser } from '../common/auth/session-context';
import { LiveSessionsService } from './live-sessions.service';
import { HandoffTranscriptService } from './handoff-transcript.service';
import { HandoffHintsService } from './handoff-hints.service';
import { HandoffActionsService } from './handoff-actions.service';

/** 진행 중 목록·대화 보기·힌트·개입(FR-CS2/3/4, §17.1 ①~④). */
@Controller('chatbots/:chatbotId/live-sessions')
export class LiveSessionsController {
  constructor(
    private readonly liveSessions: LiveSessionsService,
    private readonly transcript: HandoffTranscriptService,
    private readonly hints: HandoffHintsService,
    private readonly actions: HandoffActionsService,
  ) {}

  @Get()
  @RequirePermission('cs:read')
  list(
    @Param('chatbotId') chatbotId: string,
    @Query(new ZodValidationPipe(LiveSessionListQuerySchema)) query: LiveSessionListQuery,
    @CurrentUser() user: SessionUser,
  ): Promise<LiveSessionListResponse> {
    return this.liveSessions.list(chatbotId, user.id, query);
  }

  @Get(':sessionRef/transcript')
  @RequirePermission('cs:read')
  getTranscript(
    @Param('chatbotId') chatbotId: string,
    @Param('sessionRef') sessionRef: string,
    @Query(new ZodValidationPipe(TranscriptQuerySchema)) query: TranscriptQuery,
    @CurrentUser() user: SessionUser,
  ): Promise<TranscriptResponse> {
    return this.transcript.getTranscript(chatbotId, sessionRef, user, query);
  }

  @Get(':sessionRef/hints')
  @RequirePermission('cs:read')
  getHints(@Param('chatbotId') chatbotId: string, @Param('sessionRef') sessionRef: string): Promise<HintResponse> {
    return this.hints.getHints(chatbotId, sessionRef);
  }

  @Post(':sessionRef/handoff')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('cs:write')
  intervene(@Param('chatbotId') chatbotId: string, @Param('sessionRef') sessionRef: string, @CurrentUser() user: SessionUser): Promise<InterveneHandoffResponse> {
    return this.actions.intervene(chatbotId, sessionRef, user);
  }
}
