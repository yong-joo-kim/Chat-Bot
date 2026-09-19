import { Module } from '@nestjs/common';
import { ChatbotsModule } from '../chatbots/chatbots.module';
import { DialogueCommonModule } from '../dialogue-common/dialogue-common.module';
import { IntentsController } from './intents.controller';
import { IntentsService } from './intents.service';

@Module({
  imports: [ChatbotsModule, DialogueCommonModule],
  controllers: [IntentsController],
  providers: [IntentsService],
})
export class IntentsModule {}
