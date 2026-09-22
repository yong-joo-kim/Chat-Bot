import { Module } from '@nestjs/common';
import { ChatbotsModule } from '../chatbots/chatbots.module';
import { DialogueCommonModule } from '../dialogue-common/dialogue-common.module';
import { EmbeddingModule } from '../embedding/embedding.module';
import { AnswerSettingsModule } from '../answer-settings/answer-settings.module';
import { RagModule } from '../rag/rag.module';
import { SimulationController } from './simulation.controller';
import { SimulationService } from './simulation.service';

/**
 * FAQ/의도 매칭 고도화 그룹부터 `EmbeddingModule`(1단계 미리보기 점수)·`AnswerSettingsModule`
 * (설정 캐시)·`RagModule`(`useRag: true`일 때만 직접 호출)을 추가로 import한다. 여전히
 * `ConversationLogService`는 주입하지 않는다(FR-0-21, AC-N2-25 — 시뮬레이션은 절대 로그를 남기지 않는다).
 */
@Module({
  imports: [ChatbotsModule, DialogueCommonModule, EmbeddingModule, AnswerSettingsModule, RagModule],
  controllers: [SimulationController],
  providers: [SimulationService],
})
export class SimulationModule {}
