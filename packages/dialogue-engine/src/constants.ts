/** 엔진 전역 상수(ADR-0008 §6). */

export const HOP_LIMIT = 10; // FR-5-18
export const MAX_INPUT_LENGTH = 1000; // EX-D-8
export const DEFAULT_FALLBACK_RESPONSE = '죄송해요, 잘 이해하지 못했어요. 다른 방식으로 질문해 주시겠어요?';
export const EMPTY_INPUT_RESPONSE = '메시지를 입력해 주세요.';
export const UNSUPPORTED_OUTPUT_NOTICE = '죄송해요, 이 응답은 아직 지원하지 않아요. 다른 방식으로 문의해 주세요.';
export const SESSION_CANCEL_MESSAGE = '요청을 취소했어요.';
export const SESSION_RETRY_LIMIT_MESSAGE = '입력 횟수를 초과해 진행을 중단할게요.';
export const SESSION_EXPIRED_MESSAGE = '오랜 시간 응답이 없어 이전 진행이 만료됐어요.';
export const SESSION_SWITCH_MESSAGE = '진행 중이던 이전 요청은 취소하고 새 요청으로 안내할게요.';
export const SKIP_TOKENS = ['건너뛰기', '스킵', 'skip'];

/** 기존 `simulate`의 의도 단독 매칭 문구를 글자 그대로 재현하기 위한 상수 함수(ADR-0008 §5). */
export function intentOnlyResponse(intentId: string, matchedExample: string): string {
  return `[${intentId}] 의도로 매칭되었습니다 (예문: "${matchedExample}")`;
}
