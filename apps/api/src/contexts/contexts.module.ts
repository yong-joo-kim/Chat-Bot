import { Module } from '@nestjs/common';
import { ChatbotsModule } from '../chatbots/chatbots.module';
import { DialogueCommonModule } from '../dialogue-common/dialogue-common.module';
import { TopicsModule } from '../topics/topics.module';
import { ContextsController } from './contexts.controller';
import { ContextsService } from './contexts.service';

@Module({
  imports: [ChatbotsModule, DialogueCommonModule, TopicsModule],
  controllers: [ContextsController],
  providers: [ContextsService],
})
export class ContextsModule {}
