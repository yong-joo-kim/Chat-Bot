import { Module } from '@nestjs/common';
import { ChatbotsModule } from '../chatbots/chatbots.module';
import { VersionCaptureModule } from '../versions/capture/version-capture.module';
import { VersionReadModule } from '../versions/read/version-read.module';
import { RestoreLockModule } from '../versions/restore/restore-lock.module';
import { EmbeddingModule } from '../embedding/embedding.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { DeploySchedulesModule } from '../deploy-schedules/deploy-schedules.module';
import { EnvironmentCoreModule } from './core/environment-core.module';
import { EnvironmentServingModule } from './serving/environment-serving.module';
import { EnvironmentPointerWriter } from './core/environment-pointer.writer';
import { EnvironmentController } from './environment.controller';
import { EnvironmentModeService } from './environment-mode.service';
import { StagingPromotionService } from './staging-promotion.service';
import { EnvironmentHistoryService } from './environment-history.service';

/**
 * [신규 No.40] 관리 API(`environment`) — `environment-separation-설계.md` §2.1.
 * imports: core · serving · version-capture · versions/read · deploy-schedules
 * (`EnvironmentScheduleHooks`) · embedding · chatbots · audit-logs.
 * `EnvironmentPointerWriter`는 `EnvironmentCoreModule`이 export하지 않으므로 이 모듈이 별도 인스턴스를
 * 제공한다(§2.2 — 포인터 쓰기는 여전히 `environment-pointer.writer.ts` 1개 파일에서만 일어난다).
 */
@Module({
  imports: [
    EnvironmentCoreModule,
    EnvironmentServingModule,
    VersionCaptureModule,
    VersionReadModule,
    // [신규 No.40 R1 — M-2] `EnvironmentModeService.enable()` 진입부의 `restoreLock.isLocked` 검사용
    // (§5.3 ① — `VersionRestoreService`와 같은 `RestoreLockRegistry` 인스턴스를 공유한다).
    RestoreLockModule,
    EmbeddingModule,
    ChatbotsModule,
    AuditLogsModule,
    DeploySchedulesModule,
  ],
  controllers: [EnvironmentController],
  providers: [EnvironmentPointerWriter, EnvironmentModeService, StagingPromotionService, EnvironmentHistoryService],
})
export class EnvironmentModule {}
