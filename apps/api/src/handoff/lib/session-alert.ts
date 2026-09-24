import type { AlertLevel, UnansweredReason } from '@chat-bot/shared-types';

/** `evaluateSessionAlert()`가 읽는 로그 행 — 오름차순(createdAt asc)으로 전달해야 한다. */
export interface SessionAlertLogRow {
  isAnswered: boolean;
  blockedByFilter: boolean;
  surveyTurn: boolean;
  handoffTurn: boolean;
  apiNotice: boolean;
}

export interface SessionAlertResult {
  consecutiveUnanswered: number;
  windowUnanswered: number;
  blockedCount: number;
  alertLevel: AlertLevel;
  lastUnansweredReason?: UnansweredReason;
}

/**
 * 세션 경고 판정(순수 함수, P-6, §10.1). `isAnswered` 재판정 금지(ADR-0019) — 적재된 값만 읽는다.
 * ① BLOCK·설문·상담 구간 턴 = 중립(연속 카운트를 끊지도 늘리지도 않음) · BLOCK만 별도 집계.
 * ② 미응답 → 연속 +1 · 창 내 +1 · 사유(연동 실패 | 답변 못함). ③ 그 외 → 연속 0.
 */
export function evaluateSessionAlert(rows: readonly SessionAlertLogRow[], thresholds: { caution: number; warning: number }): SessionAlertResult {
  let consecutiveUnanswered = 0;
  let windowUnanswered = 0;
  let blockedCount = 0;
  let lastUnansweredReason: UnansweredReason | undefined;

  for (const row of rows) {
    if (row.blockedByFilter) {
      blockedCount += 1;
      continue; // 중립 — 세지도 끊지도 않는다.
    }
    if (row.surveyTurn || row.handoffTurn) continue; // 중립.

    if (!row.isAnswered) {
      consecutiveUnanswered += 1;
      windowUnanswered += 1;
      lastUnansweredReason = row.apiNotice ? 'API_NOTICE' : 'FALLBACK';
    } else {
      consecutiveUnanswered = 0;
    }
  }

  const alertLevel: AlertLevel = consecutiveUnanswered >= thresholds.warning ? 'WARNING' : consecutiveUnanswered >= thresholds.caution ? 'CAUTION' : 'NORMAL';

  return { consecutiveUnanswered, windowUnanswered, blockedCount, alertLevel, lastUnansweredReason };
}
