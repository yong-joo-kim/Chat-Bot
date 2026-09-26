import { evaluateSessionAlert } from '../../../handoff/lib/session-alert';
import type { SessionAlertLogRow } from '../../../handoff/lib/session-alert';

/**
 * [신규 No.41] 연속 미응답 판정(§6.4 · R-5) — No.24 `evaluateSessionAlert()` 1벌 재사용(API 고정
 * 문구 턴 산입 — 화면·웹훅 수치 일치). `rowsDesc`는 `createdAt desc`로 조회한 최근 N행(뒤집어 오름차순으로 넘긴다).
 */
export function computeConsecutiveUnanswered(rowsDesc: readonly SessionAlertLogRow[]): number {
  const ascending = [...rowsDesc].reverse();
  // 경고 레벨은 이 용도에서 쓰지 않는다 — 임계값은 호출부가 구독별로 직접 비교한다.
  return evaluateSessionAlert(ascending, { caution: Number.MAX_SAFE_INTEGER, warning: Number.MAX_SAFE_INTEGER }).consecutiveUnanswered;
}

export type { SessionAlertLogRow };
