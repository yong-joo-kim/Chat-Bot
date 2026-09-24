/** 엔진 전역 상수(ADR-0008 §6). */

export const HOP_LIMIT = 10; // FR-5-18
export const MAX_INPUT_LENGTH = 1000; // EX-D-8
/** 되묻기 대기(`pendingClarify`) 기본 TTL(FR-E2-2, §7.3/§7.4). */
export const CLARIFY_TTL_MS = 10 * 60 * 1000;
/** 대화 상태 봉투 최대 수명(FR-10-4, §7.4). */
export const STATE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** 봉투 크기 상한(FR-10-4, §7.4) — 직렬화 바이트/필드 개수/필드 값 길이. */
export const STATE_MAX_BYTES = 16 * 1024;
export const STATE_MAX_FILLED_VALUE_KEYS = 20;
export const STATE_MAX_FILLED_VALUE_LENGTH = 1000;
export const STATE_FUTURE_TOLERANCE_MS = 5 * 60 * 1000;
export const DEFAULT_FALLBACK_RESPONSE = '죄송해요, 잘 이해하지 못했어요. 다른 방식으로 질문해 주시겠어요?';
export const EMPTY_INPUT_RESPONSE = '메시지를 입력해 주세요.';
export const UNSUPPORTED_OUTPUT_NOTICE = '죄송해요, 이 응답은 아직 지원하지 않아요. 다른 방식으로 문의해 주세요.';
export const SESSION_CANCEL_MESSAGE = '요청을 취소했어요.';
export const SESSION_RETRY_LIMIT_MESSAGE = '입력 횟수를 초과해 진행을 중단할게요.';
export const SESSION_EXPIRED_MESSAGE = '오랜 시간 응답이 없어 이전 진행이 만료됐어요.';
export const SESSION_SWITCH_MESSAGE = '진행 중이던 이전 요청은 취소하고 새 요청으로 안내할게요.';
export const SKIP_TOKENS = ['건너뛰기', '스킵', 'skip'];

/** [No.26] 외부 API 실패/불일치 고정 문구(§5.6, FR-N2-24 내부 용어 금지 규약 준수). */
export const API_FAILURE_NOTICE = '지금은 요청하신 정보를 확인할 수 없어요. 잠시 후 다시 시도해 주세요.';
export const API_NO_MATCH_NOTICE = '확인한 결과에 맞는 안내를 찾지 못했어요. 다른 방법으로 문의해 주세요.';

/** [No.27] 설문관리 고정 문구 6종 + 재시도 상한(§5.10, FR-0-116 — 내부 용어 금지). */
export const SURVEY_ALREADY_RESPONDED_NOTICE = '이미 설문에 참여해 주셨어요. 감사합니다.';
export const SURVEY_UNAVAILABLE_NOTICE = '지금은 참여할 수 있는 설문이 없어요.';
export const SURVEY_CANCEL_MESSAGE = '설문을 마칠게요. 참여해 주셔서 감사합니다.';
export const SURVEY_RETRY_LIMIT_MESSAGE = '입력 횟수를 초과해 설문을 마칠게요. 궁금한 점을 입력해 주세요.';
export const SURVEY_TIMEOUT_NOTICE = '설문 참여 시간이 지나 설문을 마쳤어요.';
export const SURVEY_CHANGED_NOTICE = '설문이 변경(종료)되어 진행을 마쳤어요.';
export const SURVEY_REQUIRED_PROMPT = '이 질문은 꼭 답해 주세요.';
export const SURVEY_MAX_RETRY = 2;

/** 기존 `simulate`의 의도 단독 매칭 문구를 글자 그대로 재현하기 위한 상수 함수(ADR-0008 §5). */
export function intentOnlyResponse(intentId: string, matchedExample: string): string {
  return `[${intentId}] 의도로 매칭되었습니다 (예문: "${matchedExample}")`;
}
