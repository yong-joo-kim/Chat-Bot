import { Module } from '@nestjs/common';
import { ChatbotsModule } from '../chatbots/chatbots.module';
import { DialogueCommonModule } from '../dialogue-common/dialogue-common.module';
import { FaqsController } from './faqs.controller';
import { FaqsService } from './faqs.service';

@Module({
  imports: [ChatbotsModule, DialogueCommonModule],
  controllers: [FaqsController],
  providers: [FaqsService],
})
export class FaqsModule {}
