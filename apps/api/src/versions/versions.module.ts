import { Module } from '@nestjs/common';
import { ChatbotsModule } from '../chatbots/chatbots.module';
import { DialogueCommonModule } from '../dialogue-common/dialogue-common.module';
import { AnswerSettingsModule } from '../answer-settings/answer-settings.module';
import { EmbeddingModule } from '../embedding/embedding.module';
import { BannedWordsModule } from '../banned-words/banned-words.module';
import { VersionCaptureModule } from './capture/version-capture.module';
import { VersionsController } from './versions.controller';
import { VersionService } from './version.service';
import { VersionPayloadReader } from './read/version-payload.reader';
import { VersionDiffService } from './diff/version-diff.service';
import { VersionRestoreService } from './restore/version-restore.service';
import { VersionRestoreApplier } from './restore/version-restore.applier';
import { RestoreWarningsService } from './restore/restore-warnings.service';
import { RestoreLockRegistry } from './restore/restore-lock.registry';

/**
 * 컨트롤러·조회·차이·복원(§2.1). `VersionCaptureModule`을 import한다(캡처는 재사용, 대화 자산 쓰기는
 * 이 모듈 전용). **자산 모듈(intents/keywords/faqs/dialog-nodes/contexts/homonyms)·`AugmentationModule`·
 * `ValidationModule`·`TrainingJobsModule`·`ClassifierModule`·`LearningModule`·`ConversationModule`은
 * import하지 않는다**(§2.2 봉인 — §16 V-5).
 */
@Module({
  imports: [ChatbotsModule, DialogueCommonModule, AnswerSettingsModule, EmbeddingModule, BannedWordsModule, VersionCaptureModule],
  controllers: [VersionsController],
  providers: [VersionService, VersionPayloadReader, VersionDiffService, VersionRestoreService, VersionRestoreApplier, RestoreWarningsService, RestoreLockRegistry],
  // [신규 2026-09-23 No.28] 운영 예약 배포 모듈이 재사용한다(§2.2). applier는 export하지 않는다
  // (구조적 봉인 — §9.4 #1, §16 D-15).
  exports: [VersionRestoreService, VersionDiffService],
})
export class VersionsModule {}
