import { Module } from '@nestjs/common';
import { DialogueCommonModule } from '../dialogue-common/dialogue-common.module';
import { BannedWordsModule } from '../banned-words/banned-words.module';
import { LearningModule } from '../learning/learning.module';
import { EmbeddingModule } from '../embedding/embedding.module';
import { AnswerSettingsModule } from '../answer-settings/answer-settings.module';
import { RagModule } from '../rag/rag.module';
import { LegacyApiModule } from '../legacy-api/legacy-api.module';
import { SurveyResponsesModule } from '../survey-responses/survey-responses.module';
import { HandoffModule } from '../handoff/handoff.module';
import { FeedbackModule } from '../feedback/feedback.module';
import { EnvironmentServingModule } from '../environment/serving/environment-serving.module';
import { WorkflowTriggersModule } from '../workflow/triggers/workflow-triggers.module';
import { PublicConversationController } from './public-conversation.controller';
import { PublicConversationService } from './public-conversation.service';
import { PublicFeedbackService } from './public-feedback.service';
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
 * No.14~15부터 `LearningModule`을 명시 import해 `UnansweredCollectorService`를 주입받는다(DD-51).
 * 의존 방향은 `conversation → learning` 단방향이며 역방향(`learning → conversation`)은 만들지 않는다.
 * FAQ/의도 매칭 고도화 그룹부터 `EmbeddingModule`(1단계 점수)·`AnswerSettingsModule`(설정 캐시)·
 * `RagModule`(2단계 폴백)을 추가로 import한다. `RagModule`은 `conversation`을 모른다 — 로그 적재는
 * `ConversationLogPort` 인터페이스로 호출 시점에 전달한다(DD-85, 순환 참조 회피).
 */
@Module({
  imports: [
    DialogueCommonModule,
    BannedWordsModule,
    LearningModule,
    EmbeddingModule,
    AnswerSettingsModule,
    RagModule,
    LegacyApiModule,
    SurveyResponsesModule,
    HandoffModule,
    FeedbackModule,
    EnvironmentServingModule,
    WorkflowTriggersModule,
  ],
  controllers: [PublicConversationController],
  providers: [
    PublicConversationService,
    PublicFeedbackService,
    PublicAccessService,
    ConversationLogService,
    WebChannelAdapter,
    ChannelAdapterFactory,
    PublicRateLimitGuard,
    PublicOriginGuard,
  ],
})
export class ConversationModule {}
