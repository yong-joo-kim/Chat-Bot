import { Module } from '@nestjs/common';
import { ChatbotsModule } from '../chatbots/chatbots.module';
import { DialogueCommonModule } from '../dialogue-common/dialogue-common.module';
import { VersionCaptureModule } from '../versions/capture/version-capture.module';
import { TopicsModule } from '../topics/topics.module';
import { FaqsController } from './faqs.controller';
import { FaqsService } from './faqs.service';

@Module({
  imports: [ChatbotsModule, DialogueCommonModule, VersionCaptureModule, TopicsModule],
  controllers: [FaqsController],
  providers: [FaqsService],
})
export class FaqsModule {}
