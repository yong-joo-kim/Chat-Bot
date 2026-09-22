import { Module } from '@nestjs/common';
import { DialogueCommonModule } from '../dialogue-common/dialogue-common.module';
import { BannedWordsModule } from '../banned-words/banned-words.module';
import { PublicConversationController } from './public-conversation.controller';
import { PublicConversationService } from './public-conversation.service';
import { PublicAccessService } from './public-access.service';
import { ConversationLogService } from './conversation-log.service';
import { WebChannelAdapter } from './adapters/web-channel.adapter';
import { ChannelAdapterFactory } from './adapters/channel-adapter.factory';
import { PublicRateLimitGuard } from './guards/public-rate-limit.guard';
import { PublicOriginGuard } from './guards/public-origin.guard';

/**
 * No.11 공개 대화 파이프라인(채널 무관 코어 + WEB 어댑터 + 로그 적재).
 * `RateLimitStore`는 No.12부터 `common/rate-limit`(`@Global()`)이 제공한다(DD-43) — 이 모듈에서 등록하지 않는다.
 * `BannedWordsModule`을 명시 import해 `BannedWordFilterService`를 주입받는다(입구/출구 필터 2지점, DD-44).
 */
@Module({
  imports: [DialogueCommonModule, BannedWordsModule],
  controllers: [PublicConversationController],
  providers: [
    PublicConversationService,
    PublicAccessService,
    ConversationLogService,
    WebChannelAdapter,
    ChannelAdapterFactory,
    PublicRateLimitGuard,
    PublicOriginGuard,
  ],
})
export class ConversationModule {}
