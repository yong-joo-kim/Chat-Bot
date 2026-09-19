import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
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
import { validate } from './config/env.validation';

// NOTE: 챗봇 운영관리(No.1~4) + 대화 설계(No.5~9) 모듈 등록 완료.
// 후속 도메인 모듈(channels/auth/audit-logs 등)은 각 기능그룹 Phase에서 추가된다
// (docs/02-spec/개발명세서.md §2, docs/02-spec/dialogue-design-설계.md §6).
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate }),
    PrismaModule,
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
  ],
})
export class AppModule {}
