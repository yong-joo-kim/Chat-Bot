import { Module } from '@nestjs/common';
import { ChatbotsModule } from '../chatbots/chatbots.module';
import { DialogueCommonModule } from '../dialogue-common/dialogue-common.module';
import { ContextsController } from './contexts.controller';
import { ContextsService } from './contexts.service';

@Module({
  imports: [ChatbotsModule, DialogueCommonModule],
  controllers: [ContextsController],
  providers: [ContextsService],
})
export class ContextsModule {}
