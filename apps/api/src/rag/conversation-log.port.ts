import type { InputKind } from '../learning/lib/collect-decision';

/**
 * `rag → conversation` 역방향 의존을 만들지 않기 위한 인터페이스(DD-85, §7.1). `RagAnswerService`는
 * `ConversationLogService`를 직접 모르며, 이 계약만 안다. 실제 구현(`ConversationLogService`)은
 * `PublicConversationService`가 `RagAnswerService.run()` 호출 시 인자로 넘긴다(생성자 DI가 아니라
 * 호출 시점 전달 — `rag` 모듈이 `conversation` 모듈을 import할 필요가 없어진다).
 */
export interface ConversationLogPort {
  record(params: {
    id: string;
    chatbotId: string;
    /** [신규 No.29] 대화 당시 챗봇 소속 그룹 스냅샷(ADR-0033 §4) — 필수, 추가 조회 0. */
    groupId: string;
    channelType: 'WEB';
    sessionId: string;
    rawUserMessage: string;
    rawBotResponse: string;
    isAnswered: boolean;
    /** 2단계(외부 RAG) 응답 여부(J-10, DD-82). */
    answeredByRag: boolean;
    inputKind: InputKind;
  }): Promise<void>;
}
