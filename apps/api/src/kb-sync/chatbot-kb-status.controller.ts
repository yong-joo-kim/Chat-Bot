import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import type { ChatbotKbStatusResponse } from '@chat-bot/shared-types';
import { RequirePermission } from '../common/auth/require-permission.decorator';
import { KbSyncEnabledGuard } from './kb-sync-enabled.guard';
import { KbStatusService } from './kb-status.service';

/** [신규 No.43] 챗봇 답변 설정의 지식베이스 카드(§11) — URL·호스트 미노출. */
@Controller('chatbots/:chatbotId/kb-status')
@UseGuards(KbSyncEnabledGuard)
export class ChatbotKbStatusController {
  constructor(private readonly statusService: KbStatusService) {}

  @Get()
  @RequirePermission('chatbot:read')
  async get(@Param('chatbotId') chatbotId: string): Promise<ChatbotKbStatusResponse> {
    return this.statusService.chatbotStatus(chatbotId);
  }
}
