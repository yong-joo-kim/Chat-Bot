import { Module } from '@nestjs/common';
import { ChatbotsModule } from '../chatbots/chatbots.module';
import { DialogueCommonModule } from '../dialogue-common/dialogue-common.module';
import { EmbeddingModule } from '../embedding/embedding.module';
import { IntentsModule } from '../intents/intents.module';
import { TrainingJobsModule } from '../training-jobs/training-jobs.module';
import { AugmentationController } from './augmentation.controller';
import { AugmentationService } from './augmentation.service';
import { AugmentationAcceptService } from './augmentation-accept.service';
import { AugmentationJobRunner } from './augmentation-job.runner';
import { AugmentationProviderFactory } from './providers/augmentation-provider.factory';
import { LearningApplyService } from '../learning/learning-apply.service';

/**
 * No.16 예문 증강 모듈(ADR-0025/0026). 의존 방향(설계서 §9.2):
 * `augmentation → embedding(포트·코덱·벡터캐시) / training-jobs / chatbots / intents★`
 *
 * ★ `IntentsModule`은 이 모듈에서만 import한다 — `training-jobs`는 절대 import하지 않는다(DD-96 L1/S-4).
 * `IntentsService`를 생성자에 주입하는 파일은 `augmentation-accept.service.ts` 1곳뿐이다(S-2/S-3).
 * `LearningApplyService`는 `learning` 모듈을 통째로 import하지 않고 이 모듈에서 직접 provide한다
 * (상태 없는 얇은 래퍼 — `DialogueCommonModule`의 `DialogueBundleService`만 필요).
 */
@Module({
  imports: [ChatbotsModule, DialogueCommonModule, EmbeddingModule, TrainingJobsModule, IntentsModule],
  controllers: [AugmentationController],
  providers: [AugmentationService, AugmentationAcceptService, AugmentationJobRunner, AugmentationProviderFactory, LearningApplyService],
})
export class AugmentationModule {}
