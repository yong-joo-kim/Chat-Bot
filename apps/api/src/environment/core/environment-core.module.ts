import { Module } from '@nestjs/common';
import { VersionReadModule } from '../../versions/read/version-read.module';
import { EmbeddingModule } from '../../embedding/embedding.module';
import { AuditLogsModule } from '../../audit-logs/audit-logs.module';
import { EnvironmentPointerWriter } from './environment-pointer.writer';
import { ProdSwitchService } from './prod-switch.service';
import { EnvironmentReadService } from './environment-read.service';

/**
 * [신규 No.40] §2.2 — export는 `ProdSwitchService`·`EnvironmentReadService` 2개뿐이다. 포인터 쓰기
 * 유일 파일 `EnvironmentPointerWriter`는 export하지 않는다(주입 불가 — 구조적 봉인).
 * `deploy-schedules` import 0(순환 없음).
 */
@Module({
  imports: [VersionReadModule, EmbeddingModule, AuditLogsModule],
  providers: [EnvironmentPointerWriter, ProdSwitchService, EnvironmentReadService],
  exports: [ProdSwitchService, EnvironmentReadService],
})
export class EnvironmentCoreModule {}
