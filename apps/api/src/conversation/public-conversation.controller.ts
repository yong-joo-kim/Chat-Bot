import { Body, Controller, Get, Header, Headers, HttpCode, HttpStatus, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import {
  HANDOFF_SESSION_HEADER,
  HANDOFF_TOKEN_HEADER,
  IDENTITY_TOKEN_HEADER,
  HandoffPollQuery,
  HandoffPollQuerySchema,
  HandoffPollResponse,
  PendingAnswerPollResponse,
  PublicChatbotConfig,
  PublicFeedbackRequestDto,
  PublicFeedbackRequestSchema,
  PublicFeedbackResponse,
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
import { PublicFeedbackService } from './public-feedback.service';
import { HandoffPublicPollService } from '../handoff/handoff-public-poll.service';
import { ApiException } from '../common/api.exception';
import { isUuid } from './lib/is-uuid';

/**
 * 공개 대화 API(No.11, 인증 없음). 관리자 API와 컨트롤러·DTO·오류 메시지를 공유하지 않는다(FR-0-17).
 * 가드 순서는 레이트리밋 → Origin이다 — Origin 판정의 DB 조회 전에 폭주 트래픽을 자른다(§8.3).
 * `@Public()`은 핸들러 단위로 **8곳**에 각각 부착한다(No.12부터 전역 인증 가드가 opt-out을 요구,
 * DD-45. 답변 평가(No.44)가 8번째로 추가됐다 — ADR-0038 §2, `@Public()` 전체 개수는 7→8).
 */
@UseGuards(PublicRateLimitGuard, PublicOriginGuard)
@Controller('public/chatbots/:slug')
export class PublicConversationController {
  constructor(
    private readonly publicConversationService: PublicConversationService,
    private readonly handoffPoll: HandoffPublicPollService,
    private readonly publicFeedbackService: PublicFeedbackService,
  ) {}

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
    @Headers(HANDOFF_TOKEN_HEADER) handoffToken?: string,
    // [신규 No.42] 선택 헤더 — 값이 없으면 opts에 키 자체가 없다(바이트 동일, §5.2).
    @Headers(IDENTITY_TOKEN_HEADER) identityToken?: string,
  ): Promise<PublicMessageResponse> {
    return this.publicConversationService.sendMessage(slug, dto, { handoffToken, ...(identityToken ? { identityToken } : {}) });
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

  /**
   * 상담 전용 짧은 폴링(`@Public()` 7번째, ADR-0036 §2·§7) — 세션·토큰은 헤더로만 받는다(URL·본문
   * 금지). 폴링 전용 버킷(`poll-ip` 600/분 + `poll-key:handoff:{sessionId}` 40/분)만 소비한다.
   */
  @Get('handoff')
  @Public()
  @Header('Cache-Control', 'no-store')
  @PublicRateBucket({
    kind: 'POLL',
    key: { from: 'header', name: HANDOFF_SESSION_HEADER, ns: 'handoff' },
    perKeyLimit: { env: 'PUBLIC_HANDOFF_POLL_RATE_LIMIT_SESSION_PER_MIN', fallback: 40 },
  })
  pollHandoff(
    @Param('slug') slug: string,
    @Headers(HANDOFF_SESSION_HEADER) sessionId: string | undefined,
    @Headers(HANDOFF_TOKEN_HEADER) token: string | undefined,
    @Query(new ZodValidationPipe(HandoffPollQuerySchema)) query: HandoffPollQuery,
  ): Promise<HandoffPollResponse> {
    if (!sessionId) {
      throw new ApiException('VALIDATION_FAILED', 400, `${HANDOFF_SESSION_HEADER} 헤더가 필요합니다.`);
    }
    // [코드리뷰 1회차 Low] 헤더는 zod 파이프를 타지 않으므로 형식을 직접 검증한다(본문 sessionId는
    // PublicMessageRequestSchema.uuid()가 이미 검증한다).
    if (!isUuid(sessionId)) {
      throw new ApiException('VALIDATION_FAILED', 400, `${HANDOFF_SESSION_HEADER} 헤더는 UUID 형식이어야 합니다.`);
    }
    return this.handoffPoll.poll(slug, sessionId, token, query);
  }

  /**
   * [신규 No.44] 답변 평가 — `PUT`인 이유: "이 메시지의 내 평가를 이 값으로 둔다"는 멱등 설정이다
   * (`@Public()` 8번째, ADR-0038 §2). 토큰 없음 — 결합 검증(슬러그·messageId·sessionId)만으로 판정한다.
   * 평가 전용 버킷(`fb-ip` + `fb-key:msg:{messageId}`)만 소비한다 — 대화 `ip`/`session` 버킷 비소비.
   */
  @Put('messages/:messageId/feedback')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @PublicRateBucket({
    kind: 'FEEDBACK',
    key: { from: 'param', name: 'messageId', ns: 'msg' },
    perKeyLimit: { env: 'PUBLIC_FEEDBACK_RATE_LIMIT_MESSAGE_PER_MIN', fallback: 10 },
  })
  submitFeedback(
    @Param('slug') slug: string,
    @Param('messageId') messageId: string,
    @Body(new ZodValidationPipe(PublicFeedbackRequestSchema)) dto: PublicFeedbackRequestDto,
  ): Promise<PublicFeedbackResponse> {
    return this.publicFeedbackService.submitFeedback(slug, messageId, dto);
  }
}
