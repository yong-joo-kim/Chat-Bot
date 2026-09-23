import { Module } from '@nestjs/common';
import { ChatbotsModule } from '../chatbots/chatbots.module';
import { IntentsModule } from '../intents/intents.module';
import { KeywordsModule } from '../keywords/keywords.module';
import { DialogueCommonModule } from '../dialogue-common/dialogue-common.module';
import { ClassifierModule } from '../classifier/classifier.module';
import { UnansweredQuestionsController } from './unanswered-questions.controller';
import { UnansweredQuestionsService } from './unanswered-questions.service';
import { UnansweredCollectorService } from './unanswered-collector.service';
import { LearningApplyService } from './learning-apply.service';
import { DecompositionService } from './decomposition.service';
import { DecomposedResolveService } from './decomposed-resolve.service';
import { MorphAnalyzerFactory } from './morph/morph-analyzer.factory';
import { VersionCaptureModule } from '../versions/capture/version-capture.module';

/**
 * No.15 학습현황(관리자 보조 재학습) + No.23 요소분해/추천 출처 확장(2026-09-22) — 신규 쓰기 모듈(DD-57).
 * 의존 방향은 단방향이다: `conversation → learning(UnansweredCollectorService)`,
 * `learning → intents/keywords/dialogue-common/chatbots`(자산 반영) · `classifier`(추천 확률,
 * **읽기 전용·단방향** — `learning`이 `classifier`를 소비할 뿐 역방향은 없다).
 * `learning`은 대화 파이프라인을 호출하지 않는다(역방향 의존 금지, code-reviewer 점검 항목).
 */
@Module({
  imports: [ChatbotsModule, IntentsModule, KeywordsModule, DialogueCommonModule, ClassifierModule, VersionCaptureModule],
  controllers: [UnansweredQuestionsController],
  providers: [
    UnansweredQuestionsService,
    LearningApplyService,
    UnansweredCollectorService,
    DecompositionService,
    DecomposedResolveService,
    MorphAnalyzerFactory,
  ],
  // `ConversationModule`이 수집 단일 진입점을 주입받는다(DD-51).
  exports: [UnansweredCollectorService],
})
export class LearningModule {}
