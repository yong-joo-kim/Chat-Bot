import { Module } from '@nestjs/common';
import { ChatbotsModule } from '../chatbots/chatbots.module';
import { ChannelsController } from './channels.controller';
import { ChannelsService } from './channels.service';
import { ChatbotPublicationService } from './publication.service';

@Module({
  imports: [ChatbotsModule],
  controllers: [ChannelsController],
  providers: [ChannelsService, ChatbotPublicationService],
  // [신규 2026-09-23 No.28] 운영 예약 배포 모듈이 ChatbotPublicationService를 재사용한다(§2.2).
  exports: [ChannelsService, ChatbotPublicationService],
})
export class ChannelsModule {}
