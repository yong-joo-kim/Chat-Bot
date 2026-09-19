import { Module } from '@nestjs/common';
import { ChatbotsController } from './chatbots.controller';
import { ChatbotsService } from './chatbots.service';
import { EmbedCodeService } from './embed-code.service';

@Module({
  controllers: [ChatbotsController],
  providers: [ChatbotsService, EmbedCodeService],
  // StatsModule이 챗봇 존재 검증(existsById)에 ChatbotsService를 재사용한다(설계서 §6).
  exports: [ChatbotsService],
})
export class ChatbotsModule {}
