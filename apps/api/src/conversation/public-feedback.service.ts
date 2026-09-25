import { Injectable } from '@nestjs/common';
import type { FeedbackRating, PublicFeedbackResponse } from '@chat-bot/shared-types';
import { PublicAccessService } from './public-access.service';
import { MessageFeedbackService } from '../feedback/message-feedback.service';
import { readFeedbackEnabled } from '../feedback/lib/feedback-offer';
import { ApiException } from '../common/api.exception';
import { isUuid } from './lib/is-uuid';

const NOT_FOUND_MESSAGE = '지금은 의견을 받을 수 없어요.';

/**
 * 공개 평가 진입점(ADR-0038 §2) — 접근 판정 → 스위치 → 형식 판정 후 `MessageFeedbackService`에
 * 위임한다. 원장 쓰기는 하지 않는다(F-2). `conversation → feedback(MessageFeedbackService)` 단방향.
 */
@Injectable()
export class PublicFeedbackService {
  constructor(
    private readonly access: PublicAccessService,
    private readonly messageFeedback: MessageFeedbackService,
  ) {}

  async submitFeedback(slug: string, messageId: string, dto: { sessionId: string; rating: FeedbackRating }): Promise<PublicFeedbackResponse> {
    const { chatbot, channel } = await this.access.resolve(slug);

    // ③④ 기능 꺼짐·비UUID는 DB 조회 없이 같은 404로 수렴한다(§7.2).
    if (!readFeedbackEnabled(channel.config) || !isUuid(messageId)) {
      throw new ApiException('FEEDBACK_TARGET_NOT_FOUND', 404, NOT_FOUND_MESSAGE);
    }

    return this.messageFeedback.submit({ chatbotId: chatbot.id, messageId, sessionId: dto.sessionId, rating: dto.rating });
  }
}
