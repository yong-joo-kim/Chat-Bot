import { Global, Module } from '@nestjs/common';
import { AuditLogsController } from './audit-logs.controller';
import { AuditLogsService } from './audit-logs.service';
import { AuditLogService } from './audit-log.service';

/**
 * 이력 기록·조회(No.13, ADR-0016). `AuditLogService`(기록)는 9개 기존 도메인 모듈 +
 * `users`/`banned-words`/`auth`/`common/auth` 12곳 이상이 소비하므로 전역이다(`PrismaModule` 선례).
 */
@Global()
@Module({
  controllers: [AuditLogsController],
  providers: [AuditLogsService, AuditLogService],
  exports: [AuditLogService],
})
export class AuditLogsModule {}
