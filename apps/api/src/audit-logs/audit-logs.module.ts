import { Global, Module } from '@nestjs/common';
import { AuditLogsController } from './audit-logs.controller';
import { AuditLogsService } from './audit-logs.service';
import { AuditLogService } from './audit-log.service';
import { AuditChainVerifier } from './chain/audit-chain-verifier.service';
import { AccessViewInterceptor } from './access/access-view.interceptor';

/**
 * 이력 기록·조회(No.13, ADR-0016). `AuditLogService`(기록)는 9개 기존 도메인 모듈 +
 * `users`/`banned-words`/`auth`/`common/auth` 12곳 이상이 소비하므로 전역이다(`PrismaModule` 선례).
 * [신규 No.45] `AuditChainVerifier`(체인 검증 — governance 잡·컨트롤러가 가져다 쓴다) ·
 * `AccessViewInterceptor`(`@AuditView` 데코레이터가 참조하는 전역 인터셉터) 추가.
 */
@Global()
@Module({
  controllers: [AuditLogsController],
  providers: [AuditLogsService, AuditLogService, AuditChainVerifier, AccessViewInterceptor],
  exports: [AuditLogService, AuditChainVerifier],
})
export class AuditLogsModule {}
