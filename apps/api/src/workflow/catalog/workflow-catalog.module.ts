import { Module } from '@nestjs/common';
import { WorkflowCatalogService } from './workflow-catalog.service';
import { WorkflowSecretResolver } from '../secrets/workflow-secret.resolver';

/**
 * [신규 No.41] 읽기 전용 잎(leaf) 모듈 — `prisma`만 의존한다(No.26 `ApiConnectionCatalogModule` 선례).
 * `dialog-nodes`·`simulation`이 이 모듈만 가져다 쓴다(도메인 모듈 import 0 — 순환 없음).
 */
@Module({
  providers: [WorkflowCatalogService, WorkflowSecretResolver],
  exports: [WorkflowCatalogService],
})
export class WorkflowCatalogModule {}
