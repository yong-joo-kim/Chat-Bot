import { Module } from '@nestjs/common';
import { CLOCK, SystemClock } from '../common/polling/clock';
import { NodeHttpTransport } from '../legacy-api/transport/node-http.transport';
import { NodeDnsResolver } from '../legacy-api/transport/node-dns.resolver';
import { DialogueCommonModule } from '../dialogue-common/dialogue-common.module';
import { ChatbotsModule } from '../chatbots/chatbots.module';
import { WorkflowCatalogModule } from './catalog/workflow-catalog.module';
import { WorkflowTriggersModule } from './triggers/workflow-triggers.module';
import { WorkflowRunEnqueueWriter } from './triggers/workflow-run-enqueue.writer';
import { WorkflowSecretResolver } from './secrets/workflow-secret.resolver';
import { WorkflowRunStore } from './core/workflow-run.store';
import { WorkflowHttpSender, WORKFLOW_DNS_RESOLVER, WORKFLOW_TRANSPORT } from './dispatch/workflow-http.sender';
import { WorkflowDispatchJob, WORKFLOW_RANDOM } from './dispatch/workflow-dispatch.job';
import { WorkflowTargetsController } from './targets/workflow-targets.controller';
import { WorkflowTargetsService } from './targets/workflow-targets.service';
import { WorkflowTestSendService } from './targets/workflow-test-send.service';
import { WorkflowSubscriptionsService } from './subscriptions/workflow-subscriptions.service';
import { ChatbotWorkflowController } from './chatbot-workflow.controller';
import { WorkflowRunsController } from './runs/workflow-runs.controller';
import { WorkflowRunsQueryService } from './runs/workflow-runs-query.service';
import { WorkflowRunOpsService } from './runs/workflow-run-ops.service';
import { WorkflowSummaryService } from './runs/workflow-summary.service';

/**
 * [신규 No.41] 관리·발송 모듈(§2.1) — export 0개. 발송기·전송·비밀 리졸버·발송함 store는 모듈 밖에서
 * 주입할 수 없다. `AppModule` imports **끝**(`GovernanceModule` 뒤)에 둔다.
 */
@Module({
  imports: [WorkflowCatalogModule, WorkflowTriggersModule, DialogueCommonModule, ChatbotsModule],
  controllers: [WorkflowTargetsController, WorkflowRunsController, ChatbotWorkflowController],
  providers: [
    WorkflowSecretResolver,
    WorkflowRunStore,
    // ★ 테스트 발송(`WorkflowTestSendService`)이 `createTerminal()`을 쓰기 위한 별도 인스턴스 —
    // `WorkflowTriggersModule`의 export 목록(W-15: WorkflowTriggerService · WORKFLOW_EVENT_SINK만)은
    // 바꾸지 않는다(무상태 writer라 인스턴스 2개가 공존해도 동작에 영향이 없다).
    WorkflowRunEnqueueWriter,
    { provide: WORKFLOW_TRANSPORT, useClass: NodeHttpTransport },
    { provide: WORKFLOW_DNS_RESOLVER, useClass: NodeDnsResolver },
    { provide: CLOCK, useClass: SystemClock },
    // [코드 리뷰 R1 M-2] 운영 기본값 — 시험만 오버라이드한다(CLOCK과 같은 패턴).
    { provide: WORKFLOW_RANDOM, useValue: Math.random },
    WorkflowHttpSender,
    WorkflowDispatchJob,
    WorkflowTargetsService,
    WorkflowTestSendService,
    WorkflowSubscriptionsService,
    WorkflowRunsQueryService,
    WorkflowRunOpsService,
    WorkflowSummaryService,
  ],
  exports: [],
})
export class WorkflowModule {}
