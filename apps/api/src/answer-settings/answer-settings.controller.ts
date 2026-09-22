import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Put } from '@nestjs/common';
import {
  ChatbotAnswerSetting,
  RagConnectionCheckResult,
  ThresholdPreviewRequestDto,
  ThresholdPreviewRequestSchema,
  ThresholdPreviewResponse,
  UpdateAnswerSettingDto,
  UpdateAnswerSettingSchema,
} from '@chat-bot/shared-types';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RequirePermission } from '../common/auth/require-permission.decorator';
import { AnswerSettingsService } from './answer-settings.service';

/**
 * AI 답변 설정(1단계 임계값 + 2단계 RAG 스코프) API(§10.1). 신규 권한을 만들지 않는다
 * (DD-87) — 조회 `chatbot:read`, 저장·점검 `chatbot:write`.
 */
@Controller('chatbots/:chatbotId/answer-settings')
export class AnswerSettingsController {
  constructor(private readonly service: AnswerSettingsService) {}

  @Get()
  @RequirePermission('chatbot:read')
  get(@Param('chatbotId') chatbotId: string): Promise<ChatbotAnswerSetting> {
    return this.service.getSettings(chatbotId);
  }

  @Put()
  @RequirePermission('chatbot:write')
  update(
    @Param('chatbotId') chatbotId: string,
    @Body(new ZodValidationPipe(UpdateAnswerSettingSchema)) dto: UpdateAnswerSettingDto,
  ): Promise<ChatbotAnswerSetting> {
    return this.service.updateSettings(chatbotId, dto);
  }

  @Post('preview')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('chatbot:read')
  preview(
    @Param('chatbotId') chatbotId: string,
    @Body(new ZodValidationPipe(ThresholdPreviewRequestSchema)) dto: ThresholdPreviewRequestDto,
  ): Promise<ThresholdPreviewResponse> {
    return this.service.preview(chatbotId, dto);
  }

  /** 연결 점검(FR-N3-6) — 조회처럼 보이지만 §10.1 표는 `chatbot:write`로 못 박는다(부작용 없는 외부 호출이지만 관리자 액션이다). */
  @Post('test')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('chatbot:write')
  test(@Param('chatbotId') chatbotId: string): Promise<RagConnectionCheckResult> {
    return this.service.testConnection(chatbotId);
  }
}
