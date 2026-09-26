import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import type { ChatbotRetentionUpdateDto, RetentionPolicyResponse, RetentionPreviewRequestDto, RetentionPreviewResponse } from '@chat-bot/shared-types';
import { ChatbotRetentionUpdateSchema, RetentionPreviewRequestSchema } from '@chat-bot/shared-types';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RequirePermission } from '../common/auth/require-permission.decorator';
import { RetentionPolicyService } from './retention-policy.service';

/**
 * 챗봇별 보존기간 재정의(No.45 §15.1, 대화 원천 4종만) — `chatbot:read`(조회)·`chatbot:read`+
 * `security:write`(저장·취소)의 AND 조건(`RequirePermission` 복수 인자, ADR-0031 §7 선례).
 * `ARCHIVED` 챗봇도 거버넌스 설정 조회·저장을 허용한다(§8.3 — 자산이 아니다).
 */
@Controller('chatbots/:chatbotId/retention')
export class ChatbotRetentionController {
  constructor(private readonly retentionPolicy: RetentionPolicyService) {}

  @Get()
  @RequirePermission('chatbot:read', 'security:read')
  getRetention(@Param('chatbotId') chatbotId: string): Promise<RetentionPolicyResponse> {
    return this.retentionPolicy.getChatbot(chatbotId);
  }

  @Put()
  @RequirePermission('chatbot:read', 'security:write')
  updateRetention(
    @Param('chatbotId') chatbotId: string,
    @Body(new ZodValidationPipe(ChatbotRetentionUpdateSchema)) dto: ChatbotRetentionUpdateDto,
  ): Promise<RetentionPolicyResponse> {
    return this.retentionPolicy.updateChatbot(chatbotId, dto);
  }

  @Post('preview')
  @RequirePermission('chatbot:read', 'security:read')
  previewRetention(
    @Param('chatbotId') chatbotId: string,
    @Body(new ZodValidationPipe(RetentionPreviewRequestSchema)) dto: RetentionPreviewRequestDto,
  ): Promise<RetentionPreviewResponse> {
    return this.retentionPolicy.previewChatbot(chatbotId, dto);
  }

  @Post('pending/cancel')
  @RequirePermission('chatbot:read', 'security:write')
  cancelPending(@Param('chatbotId') chatbotId: string): Promise<RetentionPolicyResponse> {
    return this.retentionPolicy.cancelChatbotPending(chatbotId);
  }
}
