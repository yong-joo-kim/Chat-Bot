/**
 * [신규 No.42] 통합 인박스 신호 포트(ADR-0042 §5) — 순수 파일(Nest 모듈 아님). No.41
 * `WORKFLOW_EVENT_SINK`와 분리한 별도 포트다(그 이벤트에는 `sessionId`가 없다 — 설계서 제약 ⑤).
 * 원천 2곳(`handoff-thread.service.ts`의 개입 성공 · `conversation-log.service.ts`의 적재 성공)이
 * `@Optional()`로 주입한다. `signal()`은 동기 반환·예외 없음 — 내부에서 비동기 처리(fire-and-forget)한다.
 */

export const INBOX_SIGNAL_SINK = 'INBOX_SIGNAL_SINK';

export type InboxSignal =
  | {
      signal: 'HANDOFF_OPENED';
      chatbotId: string;
      sessionId: string;
      sessionRef: string;
      channelType: string;
      handoffId: string;
      agentUserId: string;
      agentUserName: string;
      occurredAt: Date;
    }
  | {
      signal: 'TURN_RECORDED';
      chatbotId: string;
      sessionId: string;
      channelType: string;
      isAnswered: boolean;
      blockedByFilter: boolean;
      surveyTurn: boolean;
      handoffTurn: boolean;
      occurredAt: Date;
    };

/** 동기 반환 · 예외 없음 · 내부 비동기. `sessionId`는 프로세스 안에서만 쓰인다(저장되지 않는다). */
export interface InboxSignalSink {
  signal(s: InboxSignal): void;
}
