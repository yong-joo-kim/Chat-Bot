import { Body, Controller, Get, Header, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import {
  PublicChatbotConfig,
  PublicMessageRequestDto,
  PublicMessageRequestSchema,
  PublicMessageResponse,
} from '@chat-bot/shared-types';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { Public } from '../common/auth/public.decorator';
import { PublicRateLimitGuard } from './guards/public-rate-limit.guard';
import { PublicOriginGuard } from './guards/public-origin.guard';
import { PublicConversationService } from './public-conversation.service';

/**
 * 공개 대화 API(No.11, 인증 없음). 관리자 API와 컨트롤러·DTO·오류 메시지를 공유하지 않는다(FR-0-17).
 * 가드 순서는 레이트리밋 → Origin이다 — Origin 판정의 DB 조회 전에 폭주 트래픽을 자른다(§8.3).
 * `@Public()`은 핸들러 단위로 2곳에 각각 부착한다(No.12부터 전역 인증 가드가 opt-out을 요구, DD-45).
 */
@UseGuards(PublicRateLimitGuard, PublicOriginGuard)
@Controller('public/chatbots/:slug')
export class PublicConversationController {
  constructor(private readonly publicConversationService: PublicConversationService) {}

  @Get('config')
  @Public()
  @Header('Cache-Control', 'no-store')
  getConfig(@Param('slug') slug: string): Promise<PublicChatbotConfig> {
    return this.publicConversationService.getConfig(slug);
  }

  @Post('messages')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  sendMessage(
    @Param('slug') slug: string,
    @Body(new ZodValidationPipe(PublicMessageRequestSchema)) dto: PublicMessageRequestDto,
  ): Promise<PublicMessageResponse> {
    return this.publicConversationService.sendMessage(slug, dto);
  }
}
