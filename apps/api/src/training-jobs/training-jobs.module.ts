import { Module } from '@nestjs/common';
import { ChatbotsModule } from '../chatbots/chatbots.module';
import { TrainingJobsController } from './training-jobs.controller';
import { TrainingJobService } from './training-job.service';
import { TrainingJobQueue } from './training-job.queue';

/**
 * 비동기 작업 상태(생성·학습) 모듈(ADR-0027 §4). ⚠ **`IntentsModule`·`KeywordsModule`·`LearningModule`을
 * import하지 않는다**(DD-96 L1) — "Job 완료 시 자동 승인" 코드가 컴파일조차 되지 않게 하는 구조적 봉인의
 * 절반이다(나머지 절반은 `augmentation.module.ts`가 `IntentsModule`을 import하는 **그 1곳으로 한정**하는 것).
 */
@Module({
  imports: [ChatbotsModule],
  controllers: [TrainingJobsController],
  providers: [TrainingJobService, TrainingJobQueue],
  exports: [TrainingJobService, TrainingJobQueue],
})
export class TrainingJobsModule {}
