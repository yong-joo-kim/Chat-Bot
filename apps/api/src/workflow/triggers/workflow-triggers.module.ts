import { Module } from '@nestjs/common';
import { WorkflowCatalogModule } from '../catalog/workflow-catalog.module';
import { WORKFLOW_EVENT_SINK } from '../../common/workflow/workflow-event.port';
import { WorkflowTriggerService } from './workflow-trigger.service';
import { WorkflowRunEnqueueWriter } from './workflow-run-enqueue.writer';

/**
 * [신규 No.41] 적재(쓰기 = create만) 모듈 — `workflow/catalog`만 가져다 쓴다(도메인 모듈 import 0).
 * export = `WorkflowTriggerService`(직접 주입용) + `WORKFLOW_EVENT_SINK`(포트 토큰, `useExisting`).
 * 원천 4곳(상담·설문·평가·대화 로그)이 이 모듈을 import한다.
 */
@Module({
  imports: [WorkflowCatalogModule],
  providers: [WorkflowTriggerService, WorkflowRunEnqueueWriter, { provide: WORKFLOW_EVENT_SINK, useExisting: WorkflowTriggerService }],
  exports: [WorkflowTriggerService, WORKFLOW_EVENT_SINK],
})
export class WorkflowTriggersModule {}
