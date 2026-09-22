import { Module } from '@nestjs/common';
import { ChatbotsModule } from '../chatbots/chatbots.module';
import { EmbeddingModule } from '../embedding/embedding.module';
import { TrainingJobsModule } from '../training-jobs/training-jobs.module';
import { ClassifierController } from './classifier.controller';
import { ClassifierTrainingService } from './classifier-training.service';
import { ClassifierPredictService } from './classifier-predict.service';
import { ClassifierModelRepository } from './classifier-model.repository';

/**
 * No.23 (B) 경량 의도 분류기 모듈(ADR-0027). 의존 방향(설계서 §9.2):
 * `classifier → embedding(코덱·포트) / training-jobs`. **`IntentsModule`·`KeywordsModule`을 import하지
 * 않는다** — 이 모듈의 모든 Prisma 접근은 읽기 전용이며 `intents`/`keywords` 서비스를 주입받지 않는다.
 * `learning` 모듈이 `ClassifierPredictService`를 **읽기 전용·단방향**으로 주입받는다(역방향 의존 없음).
 */
@Module({
  imports: [ChatbotsModule, EmbeddingModule, TrainingJobsModule],
  controllers: [ClassifierController],
  providers: [ClassifierTrainingService, ClassifierPredictService, ClassifierModelRepository],
  exports: [ClassifierPredictService],
})
export class ClassifierModule {}
