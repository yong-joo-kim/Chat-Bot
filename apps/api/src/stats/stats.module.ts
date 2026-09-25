import { Module } from '@nestjs/common';
import { ChatbotsModule } from '../chatbots/chatbots.module';
import { StatsController } from './stats.controller';
import { StatsService } from './stats.service';
import { IntegratedStatsController } from './integrated/integrated-stats.controller';
import { IntegratedStatsService } from './integrated/integrated-stats.service';
import { IntegratedSessionQuery } from './integrated/integrated-session.query';
import { IntentStatsService } from './intents/intent-stats.service';
import { SurveyResultsController } from './surveys/survey-results.controller';
import { SurveyStatsService } from './surveys/survey-stats.service';
import { SurveyResultsService } from './surveys/survey-results.service';
import { FeedbackStatsService } from './feedback/feedback-stats.service';

// [No.29] ChatbotGroupsModule·ConversationModule·LearningModule은 import하지 않는다(설계서 §2.2) —
// 그룹 행은 Prisma로 직접 읽고(보관 포함), 통계의 Prisma 쓰기 대상은 0개다.
// [No.27] `stats/surveys/`도 같은 규약 — `surveys/`·`survey-responses/`를 import하지 않는다(읽기는 Prisma 직접, §14 S-6/S-10).
@Module({
  imports: [ChatbotsModule],
  controllers: [StatsController, IntegratedStatsController, SurveyResultsController],
  providers: [StatsService, IntegratedStatsService, IntegratedSessionQuery, IntentStatsService, SurveyStatsService, SurveyResultsService, FeedbackStatsService],
})
export class StatsModule {}
