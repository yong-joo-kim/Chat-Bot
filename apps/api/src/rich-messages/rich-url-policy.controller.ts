import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { UpdateRichUrlPolicySchema } from '@chat-bot/shared-types';
import type { RichUrlPolicyResponse, UpdateRichUrlPolicyDto } from '@chat-bot/shared-types';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RequirePermission } from '../common/auth/require-permission.decorator';
import { RichUrlPolicyService } from './rich-url-policy.service';

/** [신규 No.46] 챗봇별 리치 메시지 허용 도메인 목록(§9.3 — 2 핸들러). 조회는 `ARCHIVED`에서도 허용. */
@Controller('chatbots/:chatbotId/rich-url-policy')
export class RichUrlPolicyController {
  constructor(private readonly service: RichUrlPolicyService) {}

  @Get()
  @RequirePermission('chatbot:read')
  get(@Param('chatbotId') chatbotId: string): Promise<RichUrlPolicyResponse> {
    return this.service.get(chatbotId);
  }

  @Put()
  @RequirePermission('chatbot:write')
  update(@Param('chatbotId') chatbotId: string, @Body(new ZodValidationPipe(UpdateRichUrlPolicySchema)) dto: UpdateRichUrlPolicyDto): Promise<RichUrlPolicyResponse> {
    return this.service.update(chatbotId, dto);
  }
}
