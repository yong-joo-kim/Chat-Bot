import { Module } from '@nestjs/common';
import { ChatbotsModule } from '../chatbots/chatbots.module';
import { DialogueCommonModule } from '../dialogue-common/dialogue-common.module';
import { EmbeddingModule } from '../embedding/embedding.module';
import { AnswerSettingsModule } from '../answer-settings/answer-settings.module';
import { EnvironmentServingModule } from '../environment/serving/environment-serving.module';
import { TrainingJobsModule } from '../training-jobs/training-jobs.module';
import { IntentsModule } from '../intents/intents.module';
import { VersionCaptureModule } from '../versions/capture/version-capture.module';
import { BannedWordsModule } from '../banned-words/banned-words.module';
import { MorphAnalyzerModule } from '../learning/morph/morph-analyzer.module';
import { LearningApplyService } from '../learning/learning-apply.service';
import { UtteranceAnalysesController } from './utterance-analyses.controller';
import { UtteranceAnalysisService } from './utterance-analysis.service';
import { UtteranceAnalysisStore } from './core/utterance-analysis.store';
import { UtteranceUploadParser } from './upload/utterance-upload.parser';
import { UtteranceAnalysisJobRunner } from './run/utterance-analysis-job.runner';
import { UtteranceAnalysisStatusSink } from './run/utterance-analysis-status.sink';
import { UtteranceAnalysisCancelRegistry } from './run/utterance-analysis-cancel.registry';
import { AnalysisEmbeddingSource } from './run/analysis-embedding.source';
import { UtteranceProbeService } from './run/utterance-probe.service';
import { ClusterNameSuggesterFactory } from './naming/cluster-name-suggester.factory';
import { UtteranceApplyService } from './apply/utterance-apply.service';
import { UtteranceAnalysisExportService } from './export/utterance-analysis-export.service';
import { UtteranceAnalysisEnabledGuard } from './utterance-analysis-enabled.guard';

/**
 * 발화 묶음 분석(No.21 딥러닝 군집분석) 모듈(deep-clustering-설계.md §2.3, ADR-0047). 의존 방향은 단방향이다 —
 * 이 모듈은 대화 파이프라인·엔진·위젯·채널 어댑터를 알지 못하고, 그쪽이 이 모듈을 import하지 않는다(DC-1).
 *
 * ⚠ **봉인(DC-3 · 정적 검사 `utterance-analysis-sealing.spec.ts` UA-3)** — 아래 모듈은 절대 import하지 않는다:
 * 대화·로그(`ConversationModule`) · 자산 쓰기(`KeywordsModule`·`FaqsModule`·`DialogNodesModule`) · 증강(`AugmentationModule`) ·
 * 검증(`ValidationModule`) · 외부 연동(`RagModule`·`LegacyApiModule`·`WorkflowModule`·`InboxModule`) · 토픽
 * (`TopicsModule`) · 미응답 수집기가 딸린 `LearningModule` · `GovernanceModule`. `IntentsModule`은 예문 반영 1파일
 * (`apply/utterance-apply.service.ts`)만을 위해 들어온다. `LearningApplyService`는 모듈 import 없이 providers에 직접
 * 둔다(상태 없는 얇은 래퍼 — 증강 모듈 선례). 형태소 분석기는 작은 `MorphAnalyzerModule`로 분리해 `LearningModule`과
 * 공유한다(garu 적재 1회 · 미응답 수집기는 이 모듈의 DI 그래프 밖 — C-10).
 */
@Module({
  imports: [
    ChatbotsModule,
    DialogueCommonModule,
    EmbeddingModule,
    AnswerSettingsModule,
    EnvironmentServingModule,
    TrainingJobsModule,
    IntentsModule,
    VersionCaptureModule,
    BannedWordsModule,
    MorphAnalyzerModule,
  ],
  controllers: [UtteranceAnalysesController],
  providers: [
    UtteranceAnalysisService,
    UtteranceAnalysisStore,
    UtteranceUploadParser,
    UtteranceAnalysisJobRunner,
    UtteranceAnalysisStatusSink,
    UtteranceAnalysisCancelRegistry,
    AnalysisEmbeddingSource,
    UtteranceProbeService,
    ClusterNameSuggesterFactory,
    UtteranceApplyService,
    UtteranceAnalysisExportService,
    UtteranceAnalysisEnabledGuard,
    LearningApplyService,
  ],
})
export class UtteranceAnalysisModule {}
