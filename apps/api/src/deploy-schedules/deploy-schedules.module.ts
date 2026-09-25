import { Module } from '@nestjs/common';
import { VersionsModule } from '../versions/versions.module';
import { VersionCaptureModule } from '../versions/capture/version-capture.module';
import { ChannelsModule } from '../channels/channels.module';
import { ChatbotsModule } from '../chatbots/chatbots.module';
import { ValidationModule } from '../validation/validation.module';
import { EmbeddingModule } from '../embedding/embedding.module';
import { CLOCK, SystemClock } from '../common/polling/clock';
import { DeploySchedulesController } from './deploy-schedules.controller';
import { DeploySchedulesGlobalController } from './deploy-schedules-global.controller';
import { DeployScheduleService } from './deploy-schedule.service';
import { DeployScheduleQueryService } from './deploy-schedule.query.service';
import { DeploySchedulePreviewService } from './preview/deploy-schedule-preview.service';
import { ReadinessWarningsService } from './readiness/readiness-warnings.service';
import { DeploySchedulesEngine } from './engine/deploy-schedule.engine';
import { DeployScheduleRepository } from './engine/deploy-schedule.repository';
import { CreatorVerifier } from './engine/creator-verifier';
import { ExecutorRegistry } from './executors/executor.registry';
import { RestoreVersionExecutor } from './executors/restore-version.executor';
import { PublishExecutor } from './executors/publish.executor';
import { SetWebChannelExecutor } from './executors/set-web-channel.executor';
import { SwitchProdVersionExecutor } from './executors/switch-prod-version.executor';
import { PostRunTestStarter } from './post-run/post-run-test.starter';
import { EnvironmentCoreModule } from '../environment/core/environment-core.module';
import { EnvironmentScheduleHooks } from './env-hooks/environment-schedule.hooks';

/**
 * [신규 2026-09-23 No.28] 운영 예약 배포(ADR-0032, §2.1). 자산·상태·채널을 **직접 쓰지 않는다** —
 * `VersionRestoreService`·`ChatbotPublicationService`·`TestRunService` 3개 재사용 서비스 뒤에 있다.
 * 자산 모듈(Intents/Keywords/Faqs/DialogNodes/Contexts/Homonyms)·AnswerSettingsModule·
 * AugmentationModule·LearningModule·ClassifierModule·TrainingJobsModule·ConversationModule은
 * import하지 않는다(§2.2 봉인 — §16 D-2).
 */
@Module({
  imports: [VersionsModule, VersionCaptureModule, ChannelsModule, ChatbotsModule, ValidationModule, EmbeddingModule, EnvironmentCoreModule],
  controllers: [DeploySchedulesController, DeploySchedulesGlobalController],
  providers: [
    { provide: CLOCK, useClass: SystemClock },
    DeployScheduleService,
    DeployScheduleQueryService,
    DeploySchedulePreviewService,
    ReadinessWarningsService,
    DeploySchedulesEngine,
    DeployScheduleRepository,
    CreatorVerifier,
    ExecutorRegistry,
    RestoreVersionExecutor,
    PublishExecutor,
    SetWebChannelExecutor,
    SwitchProdVersionExecutor,
    PostRunTestStarter,
    EnvironmentScheduleHooks,
  ],
  // [신규 No.40] `environment.module.ts`(모드 켜기/끄기)가 재사용한다(§11.6, C-4).
  exports: [EnvironmentScheduleHooks],
})
export class DeploySchedulesModule {}
