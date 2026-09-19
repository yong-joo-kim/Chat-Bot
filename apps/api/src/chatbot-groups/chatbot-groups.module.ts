import { Module } from '@nestjs/common';
import { ChatbotGroupsController } from './chatbot-groups.controller';
import { ChatbotGroupsService } from './chatbot-groups.service';

@Module({
  controllers: [ChatbotGroupsController],
  providers: [ChatbotGroupsService],
})
export class ChatbotGroupsModule {}
