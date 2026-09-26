import { Module } from '@nestjs/common';
import { LearningModule } from '../learning/learning.module';
import { WorkflowTriggersModule } from '../workflow/triggers/workflow-triggers.module';
import { MessageFeedbackService } from './message-feedback.service';

/**
 * 피드백 기반 개선 루프(No.44) — 원장 쓰기 모듈(ADR-0038). export는 `MessageFeedbackService` 1개뿐이며
 * import처는 `ConversationModule` 1곳이다(§2.1·§2.2). `feedback → learning(UnansweredCollectorService)`
 * 단방향 — `learning`은 `feedback/**`를 import하지 않는다(순환 방지).
 */
@Module({
  imports: [LearningModule, WorkflowTriggersModule],
  providers: [MessageFeedbackService],
  exports: [MessageFeedbackService],
})
export class FeedbackModule {}
