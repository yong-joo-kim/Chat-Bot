import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from './prisma/prisma.module';
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
import { RequestContextModule } from './common/request-context/request-context.module';
import { RateLimitModule } from './common/rate-limit/rate-limit.module';
import { CommonAuthModule } from './common/auth/auth.module';
import { PermissionGuard } from './common/auth/permission.guard';
import { AuditLogsModule } from './audit-logs/audit-logs.module';
import { BannedWordsModule } from './banned-words/banned-words.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { validate } from './config/env.validation';

// NOTE: 보안/이력(No.12~13) — `PermissionGuard`를 `APP_GUARD`로 전역 등록해 fail-closed로
// 전환한다(FR-0-24, ADR-0015). 횡단 모듈 4종(`RequestContextModule`·`RateLimitModule`·
// `CommonAuthModule`·`AuditLogsModule`)은 전부 `@Global()`이며, `PrismaModule`과 같은 이유로
// 여기 한 번만 import한다(개발명세서 §2.1).
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate }),
    PrismaModule,
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
    AuthModule,
    UsersModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: PermissionGuard }],
})
export class AppModule {}
