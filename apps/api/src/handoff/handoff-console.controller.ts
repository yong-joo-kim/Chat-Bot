import { Controller, Get } from '@nestjs/common';
import type { HandoffConsoleResponse } from '@chat-bot/shared-types';
import { RequirePermission } from '../common/auth/require-permission.decorator';
import { CurrentUser } from '../common/auth/current-user.decorator';
import type { SessionUser } from '../common/auth/session-context';
import { HandoffConsoleService } from './handoff-console.service';

/** 상담 콘솔 챗봇 선택기(§17.1 ⑳) — 전역 경로(챗봇 스코프 아님). */
@Controller('handoff-console')
export class HandoffConsoleController {
  constructor(private readonly service: HandoffConsoleService) {}

  @Get('chatbots')
  @RequirePermission('cs:read')
  listChatbots(@CurrentUser() user: SessionUser): Promise<HandoffConsoleResponse> {
    return this.service.listChatbots(user.id);
  }
}
