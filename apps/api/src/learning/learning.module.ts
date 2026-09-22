import { Module } from '@nestjs/common';
import { ChatbotsModule } from '../chatbots/chatbots.module';
import { IntentsModule } from '../intents/intents.module';
import { DialogueCommonModule } from '../dialogue-common/dialogue-common.module';
import { UnansweredQuestionsController } from './unanswered-questions.controller';
import { UnansweredQuestionsService } from './unanswered-questions.service';
import { UnansweredCollectorService } from './unanswered-collector.service';
import { LearningApplyService } from './learning-apply.service';

/**
 * No.15 학습현황(관리자 보조 재학습) — 신규 쓰기 모듈(DD-57). 의존 방향은 단방향이다:
 * `conversation → learning(UnansweredCollectorService)`, `learning → intents/dialogue-common/chatbots`.
 * `learning`은 대화 파이프라인을 호출하지 않는다(역방향 의존 금지, code-reviewer 점검 항목).
 */
@Module({
  imports: [ChatbotsModule, IntentsModule, DialogueCommonModule],
  controllers: [UnansweredQuestionsController],
  providers: [UnansweredQuestionsService, LearningApplyService, UnansweredCollectorService],
  // `ConversationModule`이 수집 단일 진입점을 주입받는다(DD-51).
  exports: [UnansweredCollectorService],
})
export class LearningModule {}
