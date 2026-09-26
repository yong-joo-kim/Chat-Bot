import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import { ChatbotInboxIdentityUpdateSchema, ChatbotInboxSettingsUpdateSchema } from '@chat-bot/shared-types';
import type { ChatbotInboxIdentityUpdateDto, ChatbotInboxSettingsResponse, ChatbotInboxSettingsUpdateDto } from '@chat-bot/shared-types';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { RequirePermission } from '../../common/auth/require-permission.decorator';
import { InboxEnabledGuard } from '../guards/inbox-enabled.guard';
import { ChatbotInboxSettingsService } from '../manage/chatbot-inbox-settings.service';

/** [신규 No.42] 챗봇별 통합 인박스 설정(§14.1 — 3 핸들러). 조회는 `ARCHIVED`에서도 허용. */
@UseGuards(InboxEnabledGuard)
@Controller('chatbots/:chatbotId/inbox-settings')
export class ChatbotInboxSettingsController {
  constructor(private readonly service: ChatbotInboxSettingsService) {}

  @Get()
  @RequirePermission('chatbot:read')
  get(@Param('chatbotId') chatbotId: string): Promise<ChatbotInboxSettingsResponse> {
    return this.service.get(chatbotId);
  }

  @Put()
  @RequirePermission('chatbot:write')
  update(@Param('chatbotId') chatbotId: string, @Body(new ZodValidationPipe(ChatbotInboxSettingsUpdateSchema)) dto: ChatbotInboxSettingsUpdateDto): Promise<ChatbotInboxSettingsResponse> {
    return this.service.update(chatbotId, dto);
  }

  @Put('identity')
  @RequirePermission('security:write')
  updateIdentity(@Param('chatbotId') chatbotId: string, @Body(new ZodValidationPipe(ChatbotInboxIdentityUpdateSchema)) dto: ChatbotInboxIdentityUpdateDto): Promise<ChatbotInboxSettingsResponse> {
    return this.service.updateIdentity(chatbotId, dto);
  }
}
