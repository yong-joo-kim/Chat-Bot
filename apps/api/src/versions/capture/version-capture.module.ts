import { Module } from '@nestjs/common';
import { DialogueCommonModule } from '../../dialogue-common/dialogue-common.module';
import { VersionCaptureService } from './version-capture.service';
import { VersionRetentionService } from './version-retention.service';

/**
 * 캡처 모듈(§2.1) — `VersionCaptureService`(자산 모듈 5곳이 소비) + `VersionRetentionService`
 * (`versions.module.ts`의 `version.service.ts`가 단건 삭제·보존정리에 재사용, §16 V-7)를 export한다.
 * 복원(대화 자산 쓰기)은 이 모듈에 존재하지 않는다(§16 V-6 정적 검사 — `versions/restore/**` 심볼 0건).
 */
@Module({
  imports: [DialogueCommonModule],
  providers: [VersionCaptureService, VersionRetentionService],
  exports: [VersionCaptureService, VersionRetentionService],
})
export class VersionCaptureModule {}
