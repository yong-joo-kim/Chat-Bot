import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { HandoffSettings, UpdateHandoffSettingsDto, UpdateHandoffSettingsSchema } from '@chat-bot/shared-types';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RequirePermission } from '../common/auth/require-permission.decorator';
import { HandoffSettingsService } from './handoff-settings.service';

/** 상담 연계 설정(§17.1 ⑱⑲) — 조회 `chatbot:read`, 저장 `chatbot:write`(답변 설정과 동일 규약). */
@Controller('chatbots/:chatbotId/handoff-settings')
export class HandoffSettingsController {
  constructor(private readonly service: HandoffSettingsService) {}

  @Get()
  @RequirePermission('chatbot:read')
  get(@Param('chatbotId') chatbotId: string): Promise<HandoffSettings> {
    return this.service.getSettings(chatbotId);
  }

  @Put()
  @RequirePermission('chatbot:write')
  update(@Param('chatbotId') chatbotId: string, @Body(new ZodValidationPipe(UpdateHandoffSettingsSchema)) dto: UpdateHandoffSettingsDto): Promise<HandoffSettings> {
    return this.service.updateSettings(chatbotId, dto);
  }
}
