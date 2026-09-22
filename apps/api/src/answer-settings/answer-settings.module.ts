import { Module } from '@nestjs/common';
import { ChatbotsModule } from '../chatbots/chatbots.module';
import { DialogueCommonModule } from '../dialogue-common/dialogue-common.module';
import { EmbeddingModule } from '../embedding/embedding.module';
import { RagModule } from '../rag/rag.module';
import { AnswerSettingsController } from './answer-settings.controller';
import { AnswerSettingsService } from './answer-settings.service';
import { AnswerSettingsCacheService } from './answer-settings-cache.service';

/** AI 답변 설정 모듈(§7.1) — `embedding`(미리보기)·`rag`(연결 점검)를 함께 소비한다. */
@Module({
  imports: [ChatbotsModule, DialogueCommonModule, EmbeddingModule, RagModule],
  controllers: [AnswerSettingsController],
  providers: [AnswerSettingsService, AnswerSettingsCacheService],
  exports: [AnswerSettingsCacheService],
})
export class AnswerSettingsModule {}
