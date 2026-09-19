import { Module } from '@nestjs/common';
import { ChatbotsController } from './chatbots.controller';
import { ChatbotsService } from './chatbots.service';
import { EmbedCodeService } from './embed-code.service';
import { ChatbotScopeService } from './chatbot-scope.service';

@Module({
  controllers: [ChatbotsController],
  providers: [ChatbotsService, EmbedCodeService, ChatbotScopeService],
  // StatsModule이 챗봇 존재 검증(existsById)에 ChatbotsService를 재사용한다(설계서 §6).
  // 대화 설계(No.5~9) 6개 모듈은 ChatbotScopeService를 재사용한다(dialogue-design-설계.md §6).
  exports: [ChatbotsService, ChatbotScopeService],
})
export class ChatbotsModule {}
