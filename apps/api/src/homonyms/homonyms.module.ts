import { Module } from '@nestjs/common';
import { ChatbotsModule } from '../chatbots/chatbots.module';
import { DialogueCommonModule } from '../dialogue-common/dialogue-common.module';
import { TopicsModule } from '../topics/topics.module';
import { HomonymsController } from './homonyms.controller';
import { HomonymsService } from './homonyms.service';

@Module({
  imports: [ChatbotsModule, DialogueCommonModule, TopicsModule],
  controllers: [HomonymsController],
  providers: [HomonymsService],
})
export class HomonymsModule {}
