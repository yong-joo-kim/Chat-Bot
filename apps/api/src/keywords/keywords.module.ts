import { Module } from '@nestjs/common';
import { ChatbotsModule } from '../chatbots/chatbots.module';
import { DialogueCommonModule } from '../dialogue-common/dialogue-common.module';
import { VersionCaptureModule } from '../versions/capture/version-capture.module';
import { KeywordsController } from './keywords.controller';
import { KeywordsService } from './keywords.service';

@Module({
  imports: [ChatbotsModule, DialogueCommonModule, VersionCaptureModule],
  controllers: [KeywordsController],
  providers: [KeywordsService],
  // [2026-09-22 학습 고도화] `learning` 모듈(`DecomposedResolveService`)이 엔티티 반영에
  // `KeywordsService`의 공용 경로(동의어 추가/신규 생성)를 재사용한다(FR-L2-7, `IntentsModule`의
  // `applyLearningExample()` export와 동일한 판단).
  exports: [KeywordsService],
})
export class KeywordsModule {}
