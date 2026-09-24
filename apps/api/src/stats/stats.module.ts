import { Module } from '@nestjs/common';
import { ChatbotsModule } from '../chatbots/chatbots.module';
import { StatsController } from './stats.controller';
import { StatsService } from './stats.service';
import { IntegratedStatsController } from './integrated/integrated-stats.controller';
import { IntegratedStatsService } from './integrated/integrated-stats.service';
import { IntegratedSessionQuery } from './integrated/integrated-session.query';
import { IntentStatsService } from './intents/intent-stats.service';

// [No.29] ChatbotGroupsModule·ConversationModule·LearningModule은 import하지 않는다(설계서 §2.2) —
// 그룹 행은 Prisma로 직접 읽고(보관 포함), 통계의 Prisma 쓰기 대상은 0개다.
@Module({
  imports: [ChatbotsModule],
  controllers: [StatsController, IntegratedStatsController],
  providers: [StatsService, IntegratedStatsService, IntegratedSessionQuery, IntentStatsService],
})
export class StatsModule {}
