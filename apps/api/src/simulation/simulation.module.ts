import { Module } from '@nestjs/common';
import { ChatbotsModule } from '../chatbots/chatbots.module';
import { DialogueCommonModule } from '../dialogue-common/dialogue-common.module';
import { EmbeddingModule } from '../embedding/embedding.module';
import { AnswerSettingsModule } from '../answer-settings/answer-settings.module';
import { RagModule } from '../rag/rag.module';
import { LegacyApiModule } from '../legacy-api/legacy-api.module';
import { ApiConnectionCatalogModule } from '../api-connections/catalog/api-connection-catalog.module';
import { TopicsModule } from '../topics/topics.module';
import { EnvironmentCoreModule } from '../environment/core/environment-core.module';
import { EnvironmentServingModule } from '../environment/serving/environment-serving.module';
import { WorkflowCatalogModule } from '../workflow/catalog/workflow-catalog.module';
import { SimulationController } from './simulation.controller';
import { SimulationService } from './simulation.service';

/**
 * FAQ/의도 매칭 고도화 그룹부터 `EmbeddingModule`(1단계 미리보기 점수)·`AnswerSettingsModule`
 * (설정 캐시)·`RagModule`(`useRag: true`일 때만 직접 호출)을 추가로 import한다. 여전히
 * `ConversationLogService`는 주입하지 않는다(FR-0-21, AC-N2-25 — 시뮬레이션은 절대 로그를 남기지 않는다).
 * [신규 No.40 — §12.1] `EnvironmentCoreModule`(읽기 전용 `EnvironmentReadService` — 포인터 쓰기
 * 경로 없음)·`EnvironmentServingModule`(`VersionBundleService`)을 추가한다.
 */
@Module({
  imports: [
    ChatbotsModule,
    DialogueCommonModule,
    EmbeddingModule,
    AnswerSettingsModule,
    RagModule,
    LegacyApiModule,
    ApiConnectionCatalogModule,
    TopicsModule,
    EnvironmentCoreModule,
    EnvironmentServingModule,
    WorkflowCatalogModule,
  ],
  controllers: [SimulationController],
  providers: [SimulationService],
})
export class SimulationModule {}
