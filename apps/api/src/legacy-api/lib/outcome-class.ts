import type { ApiCallOutcome } from '@chat-bot/shared-types';

/**
 * [No.26] 결과 코드 → 회로 분류(§7.6). DB·Nest 무의존 순수 함수(NFR-LM1).
 * ★ 4xx는 실패로 세지 않는다 — 익명 사용자가 잘못된 입력을 반복해 회로를 열고 다른 사용자의
 * 조회를 막는 것을 방지한다(§21 D-19).
 */
export type CircuitClass = 'INFRA_FAILURE' | 'ALIVE' | 'NEUTRAL';

const INFRA_FAILURE_OUTCOMES = new Set<ApiCallOutcome>(['TIMEOUT', 'NETWORK_ERROR', 'INVALID_RESPONSE', 'RESPONSE_TOO_LARGE']);
const NEUTRAL_OUTCOMES = new Set<ApiCallOutcome>(['BLOCKED_ADDRESS', 'BLOCKED_URL', 'REDIRECT_NOT_ALLOWED']);

export function classifyOutcome(outcome: ApiCallOutcome, httpStatus?: number): CircuitClass {
  if (outcome === 'HTTP_ERROR') {
    return httpStatus !== undefined && httpStatus >= 500 ? 'INFRA_FAILURE' : 'ALIVE';
  }
  if (outcome === 'SUCCESS') return 'ALIVE';
  if (INFRA_FAILURE_OUTCOMES.has(outcome)) return 'INFRA_FAILURE';
  if (NEUTRAL_OUTCOMES.has(outcome)) return 'NEUTRAL';
  return 'NEUTRAL';
}
