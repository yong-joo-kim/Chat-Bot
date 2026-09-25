/**
 * 답변 평가(No.44) 재시도·표시 판정 순수 로직 — DOM·fetch 무의존(`feedback-loop-설계.md` §13.5,
 * `core/` → `ui/` 원칙, `core/pending-poll.ts` 선례). `ui/feedback-bar.ts`가 이 값을 참고해 실제
 * `setTimeout`/`fetch` 부수효과를 수행한다.
 */

// ADR-0012(allowTypeImports) — `@chat-bot/shared-types` 루트에서 값 import는 금지되지만 타입
// import는 번들에 남지 않으므로 허용된다. 리터럴을 여기 중복 선언하지 않고 서버 계약과 같은
// 타입을 그대로 재사용한다(code-reviewer R1 Low).
export type { FeedbackRating } from '@chat-bot/shared-types';

/** `ui/feedback-bar.ts`가 `PublicApiError`를 이 유형으로 분류해 넘긴다(성공은 `'OK'`). */
export type FeedbackAttemptResult = 'OK' | 'NOT_FOUND' | 'CLOSED' | 'RATE_LIMITED' | 'NETWORK' | 'SERVER' | 'DISABLED';

export type FeedbackAttemptPlan =
  | { action: 'DONE_OK' }
  | { action: 'RETRY'; delayMs: 1000 }
  | { action: 'DONE_FAIL'; notice: 'SAVE_FAILED' | 'UNAVAILABLE' | 'LOCKED' | 'SILENT'; disable: boolean };

/**
 * 서버 결과 → 재시도/표시 결정(`feedback-loop-설계.md` §13.5 표). `404`(보류 RAG READY 직후 로그
 * 적재 경쟁 C-1 흡수)와 네트워크·5xx만 1초 뒤 1회 재시도한다. `409`·`429`·`403`은 재시도하지 않는다.
 */
export function planFeedbackAttempt(result: FeedbackAttemptResult, attempt: 1 | 2): FeedbackAttemptPlan {
  switch (result) {
    case 'OK':
      return { action: 'DONE_OK' };
    case 'NOT_FOUND':
      return attempt === 1 ? { action: 'RETRY', delayMs: 1000 } : { action: 'DONE_FAIL', notice: 'UNAVAILABLE', disable: true };
    case 'NETWORK':
    case 'SERVER':
      return attempt === 1 ? { action: 'RETRY', delayMs: 1000 } : { action: 'DONE_FAIL', notice: 'SAVE_FAILED', disable: false };
    case 'CLOSED':
      return { action: 'DONE_FAIL', notice: 'LOCKED', disable: true };
    case 'RATE_LIMITED':
      return { action: 'DONE_FAIL', notice: 'SILENT', disable: false };
    case 'DISABLED':
      return { action: 'DONE_FAIL', notice: 'UNAVAILABLE', disable: true };
    default:
      return { action: 'DONE_FAIL', notice: 'SAVE_FAILED', disable: false };
  }
}
