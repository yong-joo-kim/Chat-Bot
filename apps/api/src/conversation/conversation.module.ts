import { Module } from '@nestjs/common';
import { DialogueCommonModule } from '../dialogue-common/dialogue-common.module';
import { PublicConversationController } from './public-conversation.controller';
import { PublicConversationService } from './public-conversation.service';
import { PublicAccessService } from './public-access.service';
import { ConversationLogService } from './conversation-log.service';
import { WebChannelAdapter } from './adapters/web-channel.adapter';
import { ChannelAdapterFactory } from './adapters/channel-adapter.factory';
import { PublicRateLimitGuard } from './guards/public-rate-limit.guard';
import { PublicOriginGuard } from './guards/public-origin.guard';
import { InMemoryRateLimitStore } from './rate-limit.store';

/** No.11 공개 대화 파이프라인(채널 무관 코어 + WEB 어댑터 + 로그 적재). */
@Module({
  imports: [DialogueCommonModule],
  controllers: [PublicConversationController],
  providers: [
    PublicConversationService,
    PublicAccessService,
    ConversationLogService,
    WebChannelAdapter,
    ChannelAdapterFactory,
    PublicRateLimitGuard,
    PublicOriginGuard,
    { provide: 'RateLimitStore', useClass: InMemoryRateLimitStore },
  ],
})
export class ConversationModule {}
