import { Module } from '@nestjs/common';
import { GovernanceController } from './governance.controller';
import { ChatbotRetentionController } from './chatbot-retention.controller';
import { GovernanceMapService } from './governance-map.service';
import { RetentionPolicyService } from './retention-policy.service';
import { RetentionRunQueryService } from './retention-run-query.service';
import { GovernanceBootstrapService } from './bootstrap/governance-bootstrap.service';
import { GovernanceJobLease } from './jobs/job-lease';
import { RetentionJob } from './jobs/retention.job';
import { FieldCryptoJob } from './jobs/field-crypto.job';
import { GovernanceDataWriter } from './writer/governance-data.writer';

/**
 * ★ 데이터 거버넌스 모듈(No.45, `data-governance-설계.md` §2.1) — export 0개. 어떤 도메인 모듈도
 * `governance/**`를 import하지 않는다(정적 검사 G-10). `AppModule` imports 맨 끝에 둔다(§2.2 —
 * Prisma 연결 뒤에 기동 검증이 돈다).
 */
@Module({
  controllers: [GovernanceController, ChatbotRetentionController],
  providers: [
    GovernanceMapService,
    RetentionPolicyService,
    RetentionRunQueryService,
    GovernanceBootstrapService,
    GovernanceJobLease,
    RetentionJob,
    FieldCryptoJob,
    GovernanceDataWriter,
  ],
  exports: [],
})
export class GovernanceModule {}
