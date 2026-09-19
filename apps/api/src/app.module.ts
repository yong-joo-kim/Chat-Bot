import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { HealthModule } from './health/health.module';
import { ChatbotGroupsModule } from './chatbot-groups/chatbot-groups.module';
import { ChatbotsModule } from './chatbots/chatbots.module';
import { StatsModule } from './stats/stats.module';
import { validate } from './config/env.validation';

// NOTE: 챗봇 운영관리(No.1~4) 모듈 등록 완료. 후속 도메인 모듈(dialog-nodes/intents/entities/
// homonyms/contexts/faqs/channels/auth/audit-logs)은 각 기능그룹 Phase에서 추가된다
// (docs/02-spec/개발명세서.md §2, docs/02-spec/chatbot-operations-설계.md §6).
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate }),
    PrismaModule,
    HealthModule,
    ChatbotGroupsModule,
    ChatbotsModule,
    StatsModule,
  ],
})
export class AppModule {}
