import type { HandoffEndReason } from '@chat-bot/shared-types';

/**
 * [신규 No.41] 업무 자동화 이벤트 발행 포트(ADR-0041 §3) — 순수 파일(Nest 모듈 아님). 원천 서비스
 * 4곳(`handoff-thread`·`survey-response`·`message-feedback`·`conversation-log`)이 `@Optional()`로
 * 주입한다. `emit()`은 동기 반환·예외 없음 — 내부에서 비동기 적재(fire-and-forget)한다.
 * `docs/02-spec/workflow-automation-설계.md` §6.2 근거.
 */

export const WORKFLOW_EVENT_SINK = 'WORKFLOW_EVENT_SINK';

export type WorkflowSourceEvent =
  | {
      kind: 'HANDOFF_STARTED';
      chatbotId: string;
      handoffId: string;
      sessionRef: string;
      channelType: string;
      alertLevelAtStart: string;
      consecutiveUnansweredAtStart: number;
      occurredAt: Date;
    }
  | { kind: 'HANDOFF_ENDED'; chatbotId: string; handoffId: string; reason: HandoffEndReason; occurredAt: Date }
  | {
      kind: 'SURVEY_COMPLETED';
      chatbotId: string;
      sessionId: string;
      channelType: string;
      surveyId: string;
      surveyName: string;
      responseId: string;
      isDuplicate: boolean;
      missingRequiredCount: number;
      occurredAt: Date;
    }
  | {
      kind: 'FEEDBACK_NEGATIVE';
      chatbotId: string;
      sessionId: string;
      channelType: string;
      feedbackId: string;
      messageId: string;
      targetKind: string;
      targetId: string | null;
      answeredByRag: boolean;
      occurredAt: Date;
    }
  | {
      kind: 'TURN_LOGGED';
      chatbotId: string;
      sessionId: string;
      channelType: string;
      messageId?: string;
      isAnswered: boolean;
      blockedByFilter: boolean;
      surveyTurn: boolean;
      handoffTurn: boolean;
      apiNotice: boolean;
      occurredAt: Date;
    };

/** 동기 반환 · 예외 없음 · 내부에서 비동기 적재(fire-and-forget). `sessionId`는 프로세스 안에서만 쓰이고 저장되지 않는다. */
export interface WorkflowEventSink {
  emit(event: WorkflowSourceEvent): void;
}
