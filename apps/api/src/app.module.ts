import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from './prisma/prisma.module';
import { EnvironmentCacheEventsModule } from './common/events/environment-cache-events.module';
import { HealthModule } from './health/health.module';
import { ChatbotGroupsModule } from './chatbot-groups/chatbot-groups.module';
import { ChatbotsModule } from './chatbots/chatbots.module';
import { StatsModule } from './stats/stats.module';
import { DialogueCommonModule } from './dialogue-common/dialogue-common.module';
import { IntentsModule } from './intents/intents.module';
import { KeywordsModule } from './keywords/keywords.module';
import { HomonymsModule } from './homonyms/homonyms.module';
import { ContextsModule } from './contexts/contexts.module';
import { DialogNodesModule } from './dialog-nodes/dialog-nodes.module';
import { FaqsModule } from './faqs/faqs.module';
import { ChannelsModule } from './channels/channels.module';
import { SimulationModule } from './simulation/simulation.module';
import { ConversationModule } from './conversation/conversation.module';
import { LearningModule } from './learning/learning.module';
import { RequestContextModule } from './common/request-context/request-context.module';
import { RateLimitModule } from './common/rate-limit/rate-limit.module';
import { CommonAuthModule } from './common/auth/auth.module';
import { PermissionGuard } from './common/auth/permission.guard';
import { AuditLogsModule } from './audit-logs/audit-logs.module';
import { BannedWordsModule } from './banned-words/banned-words.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { EmbeddingModule } from './embedding/embedding.module';
import { RagModule } from './rag/rag.module';
import { AnswerSettingsModule } from './answer-settings/answer-settings.module';
import { TrainingJobsModule } from './training-jobs/training-jobs.module';
import { AugmentationModule } from './augmentation/augmentation.module';
import { ClassifierModule } from './classifier/classifier.module';
import { ValidationModule } from './validation/validation.module';
import { VersionsModule } from './versions/versions.module';
import { DeploySchedulesModule } from './deploy-schedules/deploy-schedules.module';
import { ApiConnectionsModule } from './api-connections/api-connections.module';
import { LegacyApiModule } from './legacy-api/legacy-api.module';
import { SurveysModule } from './surveys/surveys.module';
import { TopicsModule } from './topics/topics.module';
import { AssetTransferModule } from './asset-transfer/asset-transfer.module';
import { EnvironmentModule } from './environment/environment.module';
import { GovernanceModule } from './governance/governance.module';
import { WorkflowModule } from './workflow/workflow.module';
import { InboxModule } from './inbox/inbox.module';
import { RichMessagesModule } from './rich-messages/rich-messages.module';
import { KbSyncModule } from './kb-sync/kb-sync.module';
import { ProactiveModule } from './proactive/proactive.module';
import { UtteranceAnalysisModule } from './utterance-analysis/utterance-analysis.module';
import { GuardrailsModule } from './guardrails/guardrails.module';
import { validate } from './config/env.validation';

// NOTE: 보안/이력(No.12~13) — `PermissionGuard`를 `APP_GUARD`로 전역 등록해 fail-closed로
// 전환한다(FR-0-24, ADR-0015). 횡단 모듈 4종(`RequestContextModule`·`RateLimitModule`·
// `CommonAuthModule`·`AuditLogsModule`)은 전부 `@Global()`이며, `PrismaModule`과 같은 이유로
// 여기 한 번만 import한다(개발명세서 §2.1).
@Module({
  imports: [
    // 시험(jest.isolate-env.js)은 `.env` 자동 로드를 끈다 — 로컬 시연용 값이 spec 설정을 덮지 않게.
    ConfigModule.forRoot({ isGlobal: true, validate, ignoreEnvFile: process.env.CHATBOT_API_IGNORE_ENV_FILE === '1' }),
    PrismaModule,
    EnvironmentCacheEventsModule,
    RequestContextModule,
    RateLimitModule,
    CommonAuthModule,
    AuditLogsModule,
    HealthModule,
    ChatbotGroupsModule,
    ChatbotsModule,
    StatsModule,
    DialogueCommonModule,
    IntentsModule,
    KeywordsModule,
    HomonymsModule,
    ContextsModule,
    DialogNodesModule,
    FaqsModule,
    ChannelsModule,
    SimulationModule,
    BannedWordsModule,
    ConversationModule,
    LearningModule,
    AuthModule,
    UsersModule,
    EmbeddingModule,
    RagModule,
    AnswerSettingsModule,
    TrainingJobsModule,
    AugmentationModule,
    ClassifierModule,
    ValidationModule,
    VersionsModule,
    DeploySchedulesModule,
    ApiConnectionsModule,
    LegacyApiModule,
    SurveysModule,
    AssetTransferModule,
    TopicsModule,
    EnvironmentModule,
    // [신규 No.45] imports 맨 끝 — onModuleInit 순서상 Prisma 연결 뒤에 기동 검증이 돈다(§2.2).
    GovernanceModule,
    // [신규 No.41] imports 맨 끝 — 발송 루프 onApplicationBootstrap이 거버넌스 런타임 설치 뒤에 시작한다(§2.2).
    WorkflowModule,
    // [신규 No.42] imports 맨 끝 — 루프·타이머가 없어 순서 의존은 없다(§2.2).
    InboxModule,
    // [신규 No.46] imports 맨 끝 — 루프·타이머가 없어 순서 의존은 없다(§2.2).
    RichMessagesModule,
    // [신규 No.43] imports 맨 끝 — 루프(`KbSyncJob`) onApplicationBootstrap이 거버넌스 런타임 설치
    // 뒤에 시작한다(§2.2, ADR-0044).
    KbSyncModule,
    // [신규 No.35] imports 맨 끝 — 새 백그라운드 루프 0이라 순서 의존은 없다(§2.2). `ConversationModule`
    // 도 `ProactiveModule`을 import한다(중복 무해 — Nest가 단일 인스턴스로 공유).
    ProactiveModule,
    // [신규 No.21] imports 맨 끝 — 새 백그라운드 루프 0이라 순서 의존은 없다(deep-clustering-설계.md §2.1).
    UtteranceAnalysisModule,
    // [신규 No.36] imports 맨 끝 — 새 백그라운드 루프 0이라 순서 의존은 없다(ai-guardrails-설계.md §2.1). 런타임은
    // `ConversationModule`·`RagModule`·`SimulationModule`이 `GuardrailRuntimeModule`로 따로 import한다.
    GuardrailsModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: PermissionGuard }],
})
export class AppModule {}
