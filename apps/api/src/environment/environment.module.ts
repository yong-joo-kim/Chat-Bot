import { Module } from '@nestjs/common';
import { ChatbotsModule } from '../chatbots/chatbots.module';
import { VersionCaptureModule } from '../versions/capture/version-capture.module';
import { VersionReadModule } from '../versions/read/version-read.module';
import { RestoreLockModule } from '../versions/restore/restore-lock.module';
import { EmbeddingModule } from '../embedding/embedding.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { DeploySchedulesModule } from '../deploy-schedules/deploy-schedules.module';
import { BannedWordsModule } from '../banned-words/banned-words.module';
import { CLOCK, SystemClock } from '../common/polling/clock';
import { EnvironmentCoreModule } from './core/environment-core.module';
import { EnvironmentServingModule } from './serving/environment-serving.module';
import { EnvironmentPointerWriter } from './core/environment-pointer.writer';
import { EnvironmentController } from './environment.controller';
import { EnvironmentModeService } from './environment-mode.service';
import { StagingPromotionService } from './staging-promotion.service';
import { EnvironmentHistoryService } from './environment-history.service';
import { SwitchApprovalService } from './approval/switch-approval.service';
import { SwitchApprovalStore } from './approval/switch-approval.store';
import { SwitchApprovalMapper } from './approval/switch-approval.mapper';
import { SwitchApprovalsController } from './approval/switch-approvals.controller';
import { EnvironmentApprovalsGlobalController } from './approval/environment-approvals-global.controller';

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
    // [신규 No.36] 승인 사유·반려 메모의 금지어 마스킹(`BannedWordFilterService`).
    BannedWordsModule,
  ],
  // [신규 No.36] 운영 전환 2인 승인 컨트롤러 2개(챗봇 스코프 7 + 전역 2 핸들러) — 강제 지점은 `ProdSwitchService.switch()` 1곳이다.
  controllers: [EnvironmentController, SwitchApprovalsController, EnvironmentApprovalsGlobalController],
  providers: [
    EnvironmentPointerWriter,
    EnvironmentModeService,
    StagingPromotionService,
    EnvironmentHistoryService,
    SwitchApprovalService,
    SwitchApprovalStore,
    SwitchApprovalMapper,
    // 승인 만료·예약 판정의 시계 포트(운영 = 시스템 시계 · 시험 = `CLOCK` 오버라이드).
    { provide: CLOCK, useClass: SystemClock },
  ],
})
export class EnvironmentModule {}
