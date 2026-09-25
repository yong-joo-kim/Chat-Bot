import { Module } from '@nestjs/common';
import { ChatbotsModule } from '../chatbots/chatbots.module';
import { DialogueCommonModule } from '../dialogue-common/dialogue-common.module';
import { VersionCaptureModule } from '../versions/capture/version-capture.module';
import { TopicsModule } from '../topics/topics.module';
import { IntentsController } from './intents.controller';
import { IntentsService } from './intents.service';

@Module({
  imports: [ChatbotsModule, DialogueCommonModule, VersionCaptureModule, TopicsModule],
  controllers: [IntentsController],
  providers: [IntentsService],
  // `learning` 모듈이 `applyLearningExample()`을 호출한다(DD-62, ADR-0018).
  exports: [IntentsService],
})
export class IntentsModule {}
