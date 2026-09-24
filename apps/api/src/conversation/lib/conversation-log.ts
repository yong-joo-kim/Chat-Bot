import type { TraceStep } from '@chat-bot/shared-types';
import { outputsToPlainText } from '@chat-bot/shared-types';
import type { DialogOutput } from '@chat-bot/shared-types';

const FALLBACK_TRACE_CODES = new Set(['FALLBACK_NODE', 'FALLBACK_FAQ', 'FALLBACK_DEFAULT', 'EMPTY_INPUT', 'API_FIXED_NOTICE']);

const BOT_RESPONSE_MAX_LENGTH = 2000;

/**
 * `isAnswered` 판정(FR-11-21, **DD-31로 수정된 규칙**). 요구사항 원문의 "trace 마지막 단계" 규칙은
 * 현행 엔진에서 성립하지 않는다 — 폴백 노드 실행 trace가 `FALLBACK_NODE` 뒤에 이어 붙으므로 마지막
 * 코드가 `BROKEN_REFERENCE`/`UNSUPPORTED_OUTPUT` 등이 될 수 있어 폴백을 성공으로 오판한다.
 * 대신 "폴백 코드가 trace에 하나라도 존재하는가"로 판정한다.
 */
export function judgeAnswered(trace: TraceStep[]): boolean {
  return !trace.some((step) => FALLBACK_TRACE_CODES.has(step.code));
}

/** 로그 저장용 봇 응답 텍스트화(FR-11-22). 2,000자 초과 시 절단한다. */
export function buildBotResponseText(outputs: DialogOutput[]): string {
  return outputsToPlainText(outputs, BOT_RESPONSE_MAX_LENGTH);
}
