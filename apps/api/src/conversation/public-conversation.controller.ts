import { Body, Controller, Get, Header, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import {
  PendingAnswerPollResponse,
  PublicChatbotConfig,
  PublicMessageRequestDto,
  PublicMessageRequestSchema,
  PublicMessageResponse,
} from '@chat-bot/shared-types';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { Public } from '../common/auth/public.decorator';
import { PublicRateBucket } from '../common/rate-limit/public-rate-bucket.decorator';
import { PublicRateLimitGuard } from './guards/public-rate-limit.guard';
import { PublicOriginGuard } from './guards/public-origin.guard';
import { PublicConversationService } from './public-conversation.service';

/**
 * 공개 대화 API(No.11, 인증 없음). 관리자 API와 컨트롤러·DTO·오류 메시지를 공유하지 않는다(FR-0-17).
 * 가드 순서는 레이트리밋 → Origin이다 — Origin 판정의 DB 조회 전에 폭주 트래픽을 자른다(§8.3).
 * `@Public()`은 핸들러 단위로 **3곳**에 각각 부착한다(No.12부터 전역 인증 가드가 opt-out을 요구,
 * DD-45. 보류 답변 폴링이 3번째로 추가됐다 — ADR-0023 §2, `@Public()` 전체 개수는 5→6).
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

  /**
   * 보류 답변 폴링(FR-N2-35, ADR-0023 §2) — 방금 자신이 보낸 질문의 답을 받는 동작이라 공개
   * 대화 API와 같은 신뢰 경계에 있다. 보상 통제는 `PendingAnswerStore`(UUID v4·슬러그 일치·TTL·
   * 단발 조회+유예)가 담당한다.
   *
   * [K-1, §2.6] 폴링 전용 버킷(`poll-ip` 600/분 + `poll-key:msg:{messageId}` 60/분)만 소비한다 —
   * 기존 `ip`/`session` 버킷은 더 이상 소비하지 않는다(같은 NAT 뒤 폴링이 일반 전송을 429로 만들던
   * 결함 해소).
   */
  @Get('messages/:messageId')
  @Public()
  @Header('Cache-Control', 'no-store')
  @PublicRateBucket({ kind: 'POLL', key: { from: 'param', name: 'messageId', ns: 'msg' }, perKeyLimit: 60 })
  pollMessage(@Param('slug') slug: string, @Param('messageId') messageId: string): Promise<PendingAnswerPollResponse> {
    return this.publicConversationService.pollMessage(slug, messageId);
  }
}
